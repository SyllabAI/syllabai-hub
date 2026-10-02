import { NextRequest } from "next/server";
import { z } from "zod";
import { coreBaseUrl, coreFetchAuthorized, coreErrorDetail } from "@/lib/core-proxy";
import {
  surfaceForCourseSlug,
  mapCitation,
  type CitationSurface,
} from "@/lib/citation-map";
import { listCourses } from "@/lib/courses";
import { rateLimit, rateLimitKey, rateLimitResponse, type RateLimitRule } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const History = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
  .max(12)
  .default([]);

/** note context — the note reader's CLA island (kind omitted ⇒ "note") */
const NoteBody = z.object({
  kind: z.literal("note").default("note"),
  course: z.string().min(1).max(80),
  noteId: z.string().min(1).max(80),
  mode: z.enum(["EXPLAIN", "SUMMARIZE"]),
  question: z.string().min(1).max(600),
  history: History,
  isQuickAction: z.boolean().default(false),
});

/** topic context — the standalone assistant tab (demo twin of KG_TOPIC) */
const TopicBody = z.object({
  kind: z.literal("topic"),
  course: z.string().min(1).max(80),
  topicCode: z.string().min(1).max(40),
  mode: z.enum(["EXPLAIN", "SUMMARIZE"]),
  question: z.string().min(1).max(600),
  history: History,
});

/** question context — HINT/CHECK live here; CHECK is attempt-gated (409) */
const QuestionBody = z.object({
  kind: z.literal("question"),
  course: z.string().min(1).max(80),
  questionId: z.string().min(1).max(80),
  mode: z.enum(["EXPLAIN", "SUMMARIZE", "HINT", "CHECK"]),
  question: z.string().min(1).max(600),
  history: History,
  attempted: z.boolean().default(false),
});

const Body = z.discriminatedUnion("kind", [NoteBody, TopicBody, QuestionBody]);

/**
 * Phase-1 hardening: burst + sustained caps for one learner on the CLA relay
 * (mirrors the tutor limits; per-instance on serverless — see
 * lib/rate-limit.ts for the honesty note; core stays authoritative).
 */
const CLA_LIMITS: RateLimitRule[] = [
  { limit: 10, windowMs: 60_000 },
  { limit: 60, windowMs: 3_600_000 },
];

// ── core anchor resolution — shared with the 4CH1 question bridge ──────────
import {
  rootIdForCourseCode,
  topicNodeIdForCode,
} from "@/lib/core-topics";

// ── route ─────────────────────────────────────────────────────────────────

/**
 * POST /api/ai/cla — the explicitly-anchored CLA ask, PROXIED to core
 * (ADR-029 R3). Context kinds map onto core's CLA contract:
 *
 *   note (course slug + noteId)   → NOTE_SECTION  — forwarded; core's
 *                                   runtime decides (the note-serving lane
 *                                   lights this up when it lands)
 *   topic (course slug + topicCode) → KG_TOPIC   — topicNodeId resolved
 *                                   through core's knowledge tree by code
 *                                   (pilot-gated: only core-served subjects
 *                                   have a tree)
 *   question (course + questionId) → QUESTION_PART needs core question IDs;
 *                                   the hub's SME corpus IDs don't map yet —
 *                                   honest fail-closed guidance until the
 *                                   ID bridge lands
 *
 * Modes pass through 1:1 (EXPLAIN | SUMMARIZE | HINT | CHECK). Core verdicts
 * surface with their status: unknown/unresolvable context → 404
 * context_not_found; HINT/CHECK on a non-question context → 400; CHECK
 * without attempt evidence → 409 attempt_required (the answer-leakage gate
 * — guidance, never error noise).
 */
export async function POST(req: NextRequest) {
  const token =
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    (req.cookies.get("syllabai.token")?.value ?? null);

  // Rate-limit BEFORE any body parsing or core fan-out; anonymous callers
  // key on IP and fall through to the 401 below.
  const limited = rateLimit(rateLimitKey(req, "ai/cla"), CLA_LIMITS);
  if (!limited.ok) return rateLimitResponse(limited);

  let parsed: z.infer<typeof Body>;
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    if (raw && typeof raw === "object" && raw.kind === undefined) raw.kind = "note";
    parsed = Body.parse(raw);
  } catch (e) {
    return Response.json(
      { error: "invalid_body", detail: e instanceof Error ? e.message.slice(0, 200) : "bad request" },
      { status: 400 },
    );
  }

  if (!token) {
    return Response.json(
      { error: "unauthorized", detail: "Sign in to use the assistant — it runs on your SyllabAI account." },
      { status: 401 },
    );
  }

  if (!coreBaseUrl()) {
    return Response.json(
      { error: "core_not_configured", detail: "The SyllabAI backend is not configured for this deployment." },
      { status: 503 },
    );
  }

  // course slug → registry code (fs registry, cached by lib/courses)
  let courseCode: string | null = null;
  let courseLabel = parsed.course;
  try {
    const courses = await listCourses();
    const hit = courses.find((c) => c.slug === parsed.course);
    courseCode = hit?.code ?? null;
    courseLabel = hit?.label ?? parsed.course;
  } catch {
    courseCode = null;
  }
  if (!courseCode) {
    return Response.json(
      { error: "context_not_found", detail: "That course is not in the registry — reload and try again." },
      { status: 404 },
    );
  }

  // the per-ask citation surface: when the ask's course ships a graph,
  // KNOWLEDGE_NODE citations deep-link to its explorer (the bridge in
  // citation-map decides per link — honest nulls otherwise)
  const surface = await surfaceForCourseSlug(parsed.course);

  const rootId = await rootIdForCourseCode(courseCode, token);

  // ── question context: SME question IDs are not core question IDs (yet) ──
  if (parsed.kind === "question") {
    return Response.json(
      {
        error: "context_not_found",
        detail:
          "Question-anchored hints are moving onto the SyllabAI backend — they need core-served questions, which arrive with the pilot's question bridge. Until then: the note and topic assistant, the tutor, and the full mark scheme in the player all work.",
      },
      { status: 404 },
    );
  }

  // ── note context → NOTE_SECTION ──
  if (parsed.kind === "note") {
    if (!rootId) {
      return Response.json(
        {
          error: "context_not_found",
          detail: `The assistant is live on the pilot subject during rollout — ${courseLabel} notes get note-anchored help when their content lands on the backend.`,
        },
        { status: 404 },
      );
    }
    const result = await coreFetchAuthorized<Record<string, unknown>>("/api/v1/learners/me/cla/ask", {
      method: "POST",
      token,
      body: { kind: "NOTE_SECTION", rootId, noteId: parsed.noteId, mode: parsed.mode, question: parsed.question },
    });
    return claResponse(result, parsed.mode, surface);
  }

  // ── topic context → KG_TOPIC ──
  if (!rootId) {
    return Response.json(
      {
        error: "context_not_found",
        detail: `The assistant is live on the pilot subject during rollout — ${courseLabel} topics get anchored help when their curriculum lands on the backend.`,
      },
      { status: 404 },
    );
  }
  const topicNodeId = await topicNodeIdForCode(rootId, parsed.topicCode, token);
  if (!topicNodeId) {
    return Response.json(
      {
        error: "context_not_found",
        detail:
          "The backend could not resolve that topic anchor. Try the AI Tutor — it answers across the whole pilot subject with citations.",
      },
      { status: 404 },
    );
  }
  const result = await coreFetchAuthorized<Record<string, unknown>>("/api/v1/learners/me/cla/ask", {
    method: "POST",
    token,
    body: { kind: "KG_TOPIC", rootId, topicNodeId, mode: parsed.mode, question: parsed.question },
  });
  return claResponse(result, parsed.mode, surface);
}

/** Adapt core's ClaAnswerView → the hub client's expected shape. */
function claResponse(
  result: Awaited<ReturnType<typeof coreFetchAuthorized<Record<string, unknown>>>>,
  mode: string,
  surface: CitationSurface,
): Response {
  if (!result.ok || !result.data) {
    const status = result.status === 401 || result.status === 403 ? 401 : result.status;
    const detail =
      status === 401
        ? "Your session expired — sign in again to continue."
        : result.status === 404
          ? coreErrorDetail(
              result.errorBody,
              "The backend could not resolve this context — it may not be served yet.",
            )
          : result.status === 409
            ? coreErrorDetail(result.errorBody, "Attempt first, then CHECK unlocks full feedback.")
            : coreErrorDetail(result.errorBody, "The assistant call failed on the backend.");
    const code =
      status === 401
        ? "unauthorized"
        : result.status === 409
          ? "attempt_required"
          : result.status === 404
            ? "context_not_found"
            : "core_error";
    return Response.json({ error: code, detail }, { status });
  }
  const d = result.data;
  const citations = Array.isArray(d.citations)
    ? // explicit (c, i) — a bare .map(mapCitation) would hand the ARRAY in
      // as the surface argument
      (d.citations as Parameters<typeof mapCitation>[0][]).map((c, i) => mapCitation(c, i, surface))
    : [];
  return Response.json({
    answer: typeof d.answer === "string" ? d.answer : "",
    mode,
    citations,
    provider: typeof d.provider === "string" ? d.provider : "core",
    model: typeof d.model === "string" ? d.model : null,
    refused: d.refused === true,
    evidenceCount: typeof d.evidenceCount === "number" ? d.evidenceCount : citations.length,
    latencyMs: typeof d.latencyMs === "number" ? d.latencyMs : 0,
  });
}
