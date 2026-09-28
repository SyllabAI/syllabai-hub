import { NextRequest } from "next/server";
import { loadHubCourse, pilotCourseSlug, listCourses } from "@/lib/courses";
import { rootIdForCourseCode } from "@/lib/core-topics";
import { coreBaseUrl, coreFetchAuthorized } from "@/lib/core-proxy";
import type { QuestionFamilyView } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/core/questions — the 4CH1 question identity bridge (ADR-029
 * tranche 4: the pilot's real learner model).
 *
 * The hub serves question DISPLAY from its SME-parity corpus (the operator's
 * non-negotiable UX), while syllabai-core owns attempts, Smart Mark and the
 * learner model — and core knows its questions by UUID, not by corpus id.
 * This route joins the two once, server-side, so the player can submit real
 * attempts without changing what it renders.
 *
 * Two depths:
 *
 *   ?course=<slug>                     → pilot info: { course, code, rootId }
 *   ?course=<slug>&topicSlug=<set>     → the per-topic join map
 *
 * The join (verified 1:1 against production, 2026-09-28: 28 topics, 524
 * questions, every family found, marks multisets identical):
 *
 *   - family     — corpus topic slug + the question's 0-based page order
 *                  (`sme-eq-<topicSlug>-q<N>`), exactly the external ref
 *                  core's question-bank import stored
 *   - MCQ        — hub multiple_choice parts in order ↔ core MCQ member
 *                  rows in order (marks sanity-checked); option labels (A–D)
 *                  map straight onto core option UUIDs
 *   - structured — hub structured parts in order ↔ the structured member's
 *                  lettered parts in order (marks sanity-checked)
 *
 * Any question whose marks do not line up is returned in `skipped` — the
 * player keeps it fully usable (local rings + self-mark) but submits NOTHING
 * to core. A wrong-id submission would be fabricated evidence; a skipped
 * question is just local practice. IDs and marks only cross this boundary —
 * no question text, no answers.
 *
 * Availability: pilot course only (the ADR-029 boundary — the other 38
 * courses stay read-only), authenticated caller only, core reachable only.
 * Every negative is { available: false, reason } — the client degrades to
 * the honest local experience, it never hangs.
 */

// ── core families cache (per server process; immutable between deploys) ──

const FAMILIES_TTL_MS = 10 * 60_000;
let familiesCache: { at: number; rootId: string; families: QuestionFamilyView[] } | null = null;

async function familiesForRoot(
  rootId: string,
  token: string,
): Promise<QuestionFamilyView[] | null> {
  if (familiesCache && familiesCache.rootId === rootId && Date.now() - familiesCache.at < FAMILIES_TTL_MS) {
    return familiesCache.families;
  }
  const res = await coreFetchAuthorized<QuestionFamilyView[]>(
    `/api/v1/questions/families?rootId=${encodeURIComponent(rootId)}`,
    { method: "GET", token },
  );
  if (!res.ok || !Array.isArray(res.data)) return null;
  familiesCache = { at: Date.now(), rootId, families: res.data };
  return familiesCache.families;
}

// ── the join ─────────────────────────────────────────────────────────────

export interface BridgeMcqPart {
  /** core question row UUID (the attempt's questionId) */
  questionId: string;
  /** hub option label (A–D) → core option UUID (the attempt's chosenOptionId) */
  options: Record<string, string>;
}

export interface BridgeStructuredSubmission {
  /** core structured row UUID — one submission per row */
  questionId: string;
  /** hub part id → core part UUID */
  parts: Record<string, string>;
}

export interface BridgeQuestion {
  familyKey: string;
  /** core's total for the family (informational; the player renders corpus marks) */
  marks: number;
  /** hub MCQ part id → core row + option map */
  mcq: Record<string, BridgeMcqPart>;
  /** structured submissions for this question (usually exactly one) */
  structured: BridgeStructuredSubmission[];
}

interface CoreMember {
  id: string;
  externalRef: string | null;
  type: string;
  marks: number;
  options: { id: string; label: string }[];
  parts: { id: string; label: string; marks: number }[];
}

/** Build the join for one hub question. null = skip (honest local-only). */
function joinQuestion(
  family: QuestionFamilyView,
  question: {
    id: string;
    totalMarks: number;
    parts: {
      id: string;
      questionType: string | null;
      marks: number;
      choices?: { label: string }[] | null;
    }[];
  },
): BridgeQuestion | null {
  const members = family.parts as CoreMember[];

  const coreMcq = members.filter((m) => m.parts.length === 0);
  const coreStructured = members.filter((m) => m.parts.length > 0);

  const hubMcq = question.parts.filter((p) => p.questionType === "multiple_choice");
  const hubStructured = question.parts.filter((p) => p.questionType !== "multiple_choice");

  // count guards — a family that split differently cannot be joined
  if (coreMcq.length !== hubMcq.length) return null;
  const coreStructuredParts = coreStructured.flatMap((m) => m.parts);
  if (coreStructuredParts.length !== hubStructured.length) return null;

  const mcq: Record<string, BridgeMcqPart> = {};
  for (let i = 0; i < hubMcq.length; i++) {
    const hub = hubMcq[i];
    const core = coreMcq[i];
    if (core.marks !== hub.marks) return null;
    const options: Record<string, string> = {};
    for (const o of core.options) options[o.label] = o.id;
    // the hub part's option labels must all resolve — a partial map would
    // submit a wrong or missing option id
    const hubLabels = (hub.choices ?? []).map((c) => c.label);
    if (hubLabels.length > 0 && !hubLabels.every((l) => options[l])) return null;
    mcq[hub.id] = { questionId: core.id, options };
  }

  const structured: BridgeStructuredSubmission[] = [];
  let sIdx = 0;
  for (const core of coreStructured) {
    const parts: Record<string, string> = {};
    for (const corePart of core.parts) {
      const hub = hubStructured[sIdx];
      if (!hub || corePart.marks !== hub.marks) return null;
      parts[hub.id] = corePart.id;
      sIdx += 1;
    }
    structured.push({ questionId: core.id, parts });
  }

  return { familyKey: family.key, marks: family.marks, mcq, structured };
}

// ── route ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const course = req.nextUrl.searchParams.get("course");
  const topicSlugParam = req.nextUrl.searchParams.get("topicSlug");
  if (!course) {
    return Response.json({ available: false, reason: "bad_request" }, { status: 400 });
  }

  const token =
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    (req.cookies.get("syllabai.token")?.value ?? null);
  if (!token) {
    return Response.json({ available: false, reason: "unauthenticated" });
  }
  if (!coreBaseUrl()) {
    return Response.json({ available: false, reason: "core_not_configured" });
  }

  // pilot gate — the one course cleared for real learner-model writes
  let pilotSlug: string | null = null;
  try {
    pilotSlug = await pilotCourseSlug();
  } catch {
    pilotSlug = null;
  }
  if (!pilotSlug || course !== pilotSlug) {
    return Response.json({ available: false, reason: "not_pilot" });
  }

  // course → curriculum code → core subject root
  let code: string | null = null;
  try {
    const courses = await listCourses();
    code = courses.find((c) => c.slug === course)?.code ?? null;
  } catch {
    code = null;
  }
  if (!code) {
    return Response.json({ available: false, reason: "unknown_course" });
  }
  const rootId = await rootIdForCourseCode(code, token);
  if (!rootId) {
    return Response.json({ available: false, reason: "no_subject" });
  }

  // depth 1 — pilot info only
  if (!topicSlugParam) {
    return Response.json({ available: true, course, code, rootId });
  }

  // depth 2 — the per-topic join
  const hub = await loadHubCourse(course);
  const topic = hub?.questionTopics.find((t) => t.slug === topicSlugParam);
  if (!hub || !topic) {
    return Response.json({ available: false, reason: "unknown_topic" });
  }
  const corpusTopicSlug =
    topic.topicSlug ?? topic.slug.replace(/--exam-questions$/, "");

  const families = await familiesForRoot(rootId, token);
  if (!families) {
    return Response.json({ available: false, reason: "core_unreachable" });
  }

  const questions: Record<string, BridgeQuestion> = {};
  const skipped: string[] = [];
  for (const q of topic.questions) {
    const ref = `sme-eq-${corpusTopicSlug}-q${q.order}`;
    const family = families.find((f) => f.ref === ref || f.key === ref);
    if (!family) {
      skipped.push(q.id);
      continue;
    }
    const joined = joinQuestion(family, q);
    if (!joined) {
      skipped.push(q.id);
      continue;
    }
    questions[q.id] = joined;
  }

  return Response.json({
    available: true,
    course,
    code,
    rootId,
    topicSlug: corpusTopicSlug,
    questions,
    skipped,
  });
}
