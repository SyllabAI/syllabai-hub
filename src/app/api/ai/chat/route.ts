import { NextRequest } from "next/server";
import { z } from "zod";
import { coreFetchAuthorized, coreErrorDetail } from "@/lib/core-proxy";
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
 *  stays self-contained against the DTO the proxy actually reads). */
interface CoreTutorAnswer {
  answer: string;
  citations: CoreCitation[];
  evidenceCount: number;
  model: string | null;
  provider: string;
  refused: boolean;
  latencyMs: number;
}

/**
 * POST /api/ai/chat — grounded tutor, PROXIED to syllabai-core (ADR-029 R3).
 *
 * The browser keeps its SSE reader contract (citations → meta → delta →
 * done events); generation now happens in core's LlmProvider chain with the
 * signed-in learner's JWT forwarded — this repo holds no LLM keys. The
 * answer arrives complete and is streamed to the reader in small chunks so
 * the tutor's streaming UX is preserved. Thread transcripts stay
 * client-local (demo threads); bridging them onto core's §22 session store
 * is a recorded follow-up tranche.
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

  let result: Awaited<ReturnType<typeof coreFetchAuthorized<CoreTutorAnswer>>>;
  try {
    result = await coreFetchAuthorized<CoreTutorAnswer>("/api/v1/tutor/ask", {
      method: "POST",
      token,
      body: {
        question: parsed.question,
        history: parsed.history.map((h) => ({ role: h.role, text: h.content })),
      },
    });
  } catch {
    return Response.json(
      { error: "core_unreachable", detail: "The SyllabAI backend is waking up — try again in a few seconds." },
      { status: 503 },
    );
  }

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

  const turn = result.data;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        // 1) evidence first — citations stream before the answer text
        send("citations", {
          citations: turn.citations.map(mapCitation),
          sufficient: turn.evidenceCount > 0,
        });

        // 2) generation meta (provider identity + honest refusal flag)
        send("meta", {
          provider: turn.provider,
          model: turn.model,
          refused: turn.refused,
          evidenceCount: turn.evidenceCount,
        });

        // 3) stream the answer in small chunks (uniform reader UX)
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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
