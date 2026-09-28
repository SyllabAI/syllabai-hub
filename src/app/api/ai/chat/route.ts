import { NextRequest } from "next/server";
import { z } from "zod";
import {
  coreStreamAuthorized,
  coreFetchAuthorized,
  coreErrorDetail,
} from "@/lib/core-proxy";
import { mapCitation, type CoreCitation } from "@/lib/citation-map";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  question: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(16)
    .default([]),
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
 * Thread transcripts stay client-local (demo threads); bridging them onto
 * core's §22 session store is a recorded follow-up tranche.
 */
export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return Response.json(
      { error: "invalid_body", detail: e instanceof Error ? e.message.slice(0, 200) : "bad request" },
      { status: 400 },
    );
  }

  const token =
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    (req.cookies.get("syllabai.token")?.value ?? null);
  if (!token) {
    return Response.json(
      { error: "unauthorized", detail: "Sign in to use the tutor — it runs on your SyllabAI account." },
      { status: 401 },
    );
  }

  const coreBody = {
    question: parsed.question,
    history: parsed.history.map((h) => ({ role: h.role, text: h.content })),
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
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const lines = frame.split("\n");
            const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
            const dataLine = lines.find((l) => l.startsWith("data: "))?.slice(6);
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
async function legacyBlockingFallback(token: string, coreBody: { question: string; history: { role: string; text: string }[] }): Promise<Response> {
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
