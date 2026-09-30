import { NextRequest } from "next/server";
import { z } from "zod";
import {
  coreStreamAuthorized,
  coreFetchAuthorized,
  coreErrorDetail,
} from "@/lib/core-proxy";
import { mapCitation, type CoreCitation } from "@/lib/citation-map";
import { rateLimit, rateLimitKey, rateLimitResponse, type RateLimitRule } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  question: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(12)
    .default([]),
  /** §22 session to persist the exchange to (web s140 parity) — optional;
   *  core fails fast with 404 when the id is foreign/unknown, before any
   *  LLM spend. The per-turn 2000-char bound mirrors core's HistoryTurn
   *  validation (the old 4000 cap would 400 any long answer's next ask). */
  sessionId: z.string().uuid().optional(),
  /** V53 (ADR-030): the opaque hub-supplied course reference the ask is
   *  scoped by (the registry's curriculumCode) — optional; core resolves it
   *  fail-closed against its own registry and refuses cross-course asks.
   *  Absent = the legacy course-less ask (pilot behavior unchanged). */
  courseRef: z.string().max(64).optional(),
});

/** Core TutorAnswerView (lib/types.ts mirror — kept local so this route
 *  stays self-contained against the DTO the legacy fallback reads). */
interface CoreTutorAnswer {
  answer: string;
  citations: CoreCitation[];
  evidenceCount: number;
  model: string | null;
  provider: string;
  refused: boolean;
  latencyMs: number;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

/**
 * Phase-1 hardening: burst + sustained caps for one learner on the tutor
 * relay (a real tutor turn takes seconds; nobody legitimate needs more).
 * Per-instance on serverless — see lib/rate-limit.ts for the honesty note;
 * core's own per-JWT limiter stays authoritative.
 */
const CHAT_LIMITS: RateLimitRule[] = [
  { limit: 10, windowMs: 60_000 },
  { limit: 60, windowMs: 3_600_000 },
];

/**
 * POST /api/ai/chat — grounded tutor, PROXIED to syllabai-core (ADR-029 R3).
 *
 * Streaming contract (tutor SSE tranche): core's `/api/v1/tutor/ask/stream`
 * now generates token-incrementally with the signed-in learner's JWT
 * forwarded — this repo holds no LLM keys. The proxy pipes core's SSE
 * through in real time (citations → meta → delta → done), remapping only
 * the citation payloads into the hub's citation shape. The browser keeps
 * the exact same reader contract it always had; the difference is that the
 * deltas now arrive as the model writes them instead of re-chunked after a
 * blocking call.
 *
 * Honest degradation paths:
 * - core answers JSON (deploy skew: an older core without the stream
 *   endpoint returns 404 → we retry the blocking `/ask` and re-chunk) —
 *   the tutor stays up through any deploy order;
 * - core errors before the stream opens → the same JSON error mapping as
 *   before (401/429/503 with client-safe guidance);
 * - core dies mid-stream → its `error` event passes through and the chat
 *   renders the honest error state on the partial answer.
 *
 * Thread transcripts persist to core's §22 session store when the client
 * binds one (HUB-TUTOR-SESSIONS): the sessionId rides the ask, core appends
 * the completed exchange (stream: on the Completed event only; legacy
 * fallback: server-side inside /ask), and the conversations pane reads the
 * same store back. A thread without a binding asks unpersisted, exactly as
 * before.
 */
export async function POST(req: NextRequest) {
  const token =
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    (req.cookies.get("syllabai.token")?.value ?? null);

  // Rate-limit BEFORE any body parsing or core fan-out; anonymous callers
  // key on IP and fall through to the 401 below.
  const limited = rateLimit(rateLimitKey(req, "ai/chat"), CHAT_LIMITS);
  if (!limited.ok) return rateLimitResponse(limited);

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return Response.json(
      { error: "invalid_body", detail: e instanceof Error ? e.message.slice(0, 200) : "bad request" },
      { status: 400 },
    );
  }

  if (!token) {
    return Response.json(
      { error: "unauthorized", detail: "Sign in to use the tutor — it runs on your SyllabAI account." },
      { status: 401 },
    );
  }

  const coreBody = {
    question: parsed.question,
    history: parsed.history.map((h) => ({ role: h.role, text: h.content })),
    ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
    // V53: the ref rides BOTH delivery paths — the stream proxy above and
    // the legacy blocking fallback below — so deploy skew between hub and
    // core can never strand the field
    ...(parsed.courseRef ? { courseRef: parsed.courseRef } : {}),
  };

  let result: Awaited<ReturnType<typeof coreStreamAuthorized>>;
  try {
    result = await coreStreamAuthorized("/api/v1/tutor/ask/stream", {
      method: "POST",
      token,
      body: coreBody,
    });
  } catch {
    return Response.json(
      { error: "core_unreachable", detail: "The SyllabAI backend is waking up — try again in a few seconds." },
      { status: 503 },
    );
  }

  if (!result.ok) {
    const status = result.status === 401 || result.status === 403 ? 401 : result.status;
    // deploy skew / legacy core: the stream endpoint 404s — retry the
    // blocking ask and keep the tutor up with the re-chunked stream
    if (result.status === 404) {
      return legacyBlockingFallback(token, coreBody);
    }
    const detail =
      status === 401
        ? "Your session expired — sign in again to continue."
        : result.status === 429
          ? "The tutor is busy right now — wait a moment and ask again."
          : coreErrorDetail(result.errorBody, "The tutor call failed on the backend.");
    return Response.json({ error: status === 401 ? "unauthorized" : "core_error", detail }, { status });
  }

  const upstream = result.response!;
  if (result.contentType?.includes("application/json")) {
    // legacy core answered the stream path with a JSON body (old build on a
    // warm route) — degrade to the blocking adaptation
    return legacyFromJsonResponse(upstream);
  }

  return pipeSse(upstream);
}

// ── streaming passthrough ────────────────────────────────────────────────

/**
 * Pipe core's SSE through, remapping `citations` payloads into the hub's
 * citation shape and forwarding meta/delta/done/error verbatim. A `: ping`
 * comment every 15s keeps intermediate proxies from closing an idle
 * connection (core's citations arrive fast, but a Render cold start delays
 * the HEADERS — that window is covered by the fetch's AbortSignal, and a
 * cold start that already returned can still trickle slowly).
 */
function pipeSse(upstream: Response): Response {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const reader = upstream.body!.getReader();
      let buffer = "";
      /** spec-compliant SSE field read: ONE optional leading space after the
       *  colon — Spring's SseEmitter writes `event:name` (no space), our own
       *  legacy fallback writes `event: name` (with space) */
      const field = (frame: string, name: string): string | undefined => {
        const line = frame.split("\n").find((l) => l.startsWith(`${name}:`));
        if (line === undefined) return undefined;
        const value = line.slice(name.length + 1);
        return value.startsWith(" ") ? value.slice(1) : value;
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const event = field(frame, "event");
            const dataLine = field(frame, "data");
            if (!event || !dataLine) continue; // comments / heartbeats
            let data: unknown;
            try {
              data = JSON.parse(dataLine);
            } catch {
              continue; // a truncated frame — the next chunk completes it
            }
            if (event === "citations" && data && typeof data === "object") {
              const d = data as { citations?: CoreCitation[]; sufficient?: boolean };
              send("citations", {
                citations: (d.citations ?? []).map(mapCitation),
                sufficient: d.sufficient ?? false,
              });
            } else {
              // meta / delta / done / error — core's shapes ARE the browser contract
              send(event, data);
            }
          }
        }
      } catch {
        // upstream died mid-stream — tell the reader honestly
        if (!closed) {
          send("error", { message: "The tutor stream was interrupted — please ask again." });
        }
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      // client went away — release the upstream stream (and core's LLM call)
      void upstream.body?.cancel().catch(() => {});
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

// ── legacy degradation (deploy skew / old core) ──────────────────────────

/** Blocking `/ask` + re-chunk — the pre-stream adaptation, kept verbatim so
 *  hub deploys never outpace core deploys. */
async function legacyBlockingFallback(
  token: string,
  coreBody: {
    question: string;
    history: { role: string; text: string }[];
    sessionId?: string;
    courseRef?: string;
  },
): Promise<Response> {
  try {
    const result = await coreFetchAuthorized<CoreTutorAnswer>("/api/v1/tutor/ask", {
      method: "POST",
      token,
      body: coreBody,
    });
    if (!result.ok || !result.data) {
      const status = result.status === 401 || result.status === 403 ? 401 : result.status;
      const detail =
        status === 401
          ? "Your session expired — sign in again to continue."
          : result.status === 429
            ? "The tutor is busy right now — wait a moment and ask again."
            : coreErrorDetail(result.errorBody, "The tutor call failed on the backend.");
      return Response.json({ error: status === 401 ? "unauthorized" : "core_error", detail }, { status });
    }
    return chunkedStream(result.data);
  } catch {
    return Response.json(
      { error: "core_unreachable", detail: "The SyllabAI backend is waking up — try again in a few seconds." },
      { status: 503 },
    );
  }
}

/** A 200-JSON response from the stream path (legacy core): same adaptation. */
async function legacyFromJsonResponse(upstream: Response): Promise<Response> {
  try {
    const turn = (await upstream.json()) as CoreTutorAnswer;
    return chunkedStream(turn);
  } catch {
    return Response.json(
      { error: "core_error", detail: "The tutor call failed on the backend." },
      { status: 502 },
    );
  }
}

function chunkedStream(turn: CoreTutorAnswer): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        send("citations", {
          citations: turn.citations.map(mapCitation),
          sufficient: turn.evidenceCount > 0,
        });
        send("meta", {
          provider: turn.provider,
          model: turn.model,
          refused: turn.refused,
          evidenceCount: turn.evidenceCount,
        });
        const chunks = turn.answer.match(/[\s\S]{1,48}/g) ?? [];
        for (const c of chunks) {
          send("delta", { text: c });
          await new Promise((r) => setTimeout(r, 12));
        }
        send("done", { ok: true });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
