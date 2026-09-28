"use client";

/**
 * Dashboard "Next best actions" — the demo's client-side port of the web
 * workbench's T-033 recommendation read model (F-092 minimal slice, ADR-017).
 *
 * The web card consumes a backend read model
 * (`/api/v1/learners/me/recommendations?rootId=…`). The demo has no such
 * backend — but every input the backend would use already exists
 * browser-locally, so the same ranking is derived client-side from the demo's
 * own evidence chain (KG phases 1-3):
 *
 *   progress store (lib/progress.ts — SIMULATED, browser-local)
 *     × content bridge (api/kg-learner-bridge — codes only, no content)
 *     × learner overlay (lib/learner-state.ts buildOverlay — measured
 *       mastery, review-due flags, misconception watch)
 *     × forgetting-decay model (lib/forgetting.ts — effective mastery)
 *
 * Action tiers mirror the web read model's priorities — remediation before
 * review before retry before practice before coverage:
 *
 *   0 REMEDIATE_MISCONCEPTION (MISCONCEPTION_SUSPECTED) — active sim states
 *     from the course misconception corpus (KG phase 3)
 *   1 REVIEW_TOPIC (DUE_REVIEW) — points whose Ebbinghaus-decayed effective
 *     mastery crossed their review threshold
 *   2 RETRY_PROBLEM_QUESTION (PROBLEM_QUESTION) — a marked attempt under 50%
 *   3 PRACTISE_QUESTIONS (LOW_MASTERY) — measured but below the low band
 *   4 UNCOVERED_NOTE (UNCOVERED_TOPIC) — a note the learner never opened
 *
 * Honesty rules inherited from the web card: every reason line is derived
 * from the learner's own measured evidence (never invented), misconception
 * states are labelled SIMULATED, and a course without a bridge (import
 * pending) simply contributes no actions. This is RECOMMENDATION output —
 * deliberately distinct from measured-fact panels (My State drawer).
 */
import {
  MASTERY_BANDS,
  effectiveMastery,
  reviewDueAt,
  reviewThresholdFor,
} from "./forgetting";
import { buildOverlay, normalizeCode, type LearnerBridge } from "./learner-state";
import type { CourseProgress } from "./progress";

export type NbaActionType =
  | "REMEDIATE_MISCONCEPTION"
  | "REVIEW_TOPIC"
  | "RETRY_PROBLEM_QUESTION"
  | "PRACTISE_QUESTIONS"
  | "UNCOVERED_NOTE";

export type NbaReasonCode =
  | "MISCONCEPTION_SUSPECTED"
  | "DUE_REVIEW"
  | "PROBLEM_QUESTION"
  | "LOW_MASTERY"
  | "UNCOVERED_TOPIC";

/** One ranked, evidence-backed learning action for the dashboard card. */
export interface DashboardAction {
  key: string;
  course: string;
  courseLabel: string;
  courseLevel: string;
  tier: number;
  actionType: NbaActionType;
  reasonCode: NbaReasonCode;
  title: string;
  /** deterministic, evidence-derived explanation — never an invented claim */
  detail: string;
  href: string;
  cta: string;
  /** within-tier urgency metric (semantics per tier, see tierLess) */
  score: number;
}

export interface NbaCourseInput {
  slug: string;
  subject: string;
  label: string;
  level: string;
  bridge: LearnerBridge | null;
  progress: CourseProgress;
}

const DAY = 86_400_000;
/** Hard cap of rows rendered by the dashboard card (web parity: minimal slice). */
export const NBA_ROW_CAP = 5;
/** Marked attempts under this ratio are "problem questions" worth retrying. */
const PROBLEM_RATIO = 0.5;

function truncate(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

function daysAgo(now: number, at: number): string {
  const d = Math.floor((now - at) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Invert noteCodes (raw curriculum-prefixed codes) into bare point → notes. */
function notesByPoint(bridge: LearnerBridge): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [noteId, codes] of Object.entries(bridge.noteCodes)) {
    for (const raw of codes) {
      const id = normalizeCode(raw, bridge.codePrefix);
      const list = m.get(id);
      if (list) list.push(noteId);
      else m.set(id, [noteId]);
    }
  }
  return m;
}

/**
 * The note covering the most of `pointIds` (deterministic tie-break: fewer
 * mapped codes = more focused note first, then noteId). Returns null when no
 * note covers any of the points.
 */
function bestNoteFor(
  bridge: LearnerBridge,
  noteMap: Map<string, string[]>,
  pointIds: string[],
): string | null {
  const counts = new Map<string, number>();
  for (const p of pointIds) {
    for (const noteId of noteMap.get(p) ?? []) {
      counts.set(noteId, (counts.get(noteId) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  let bestFocus = Number.POSITIVE_INFINITY;
  for (const [noteId, count] of counts) {
    const focus = bridge.noteCodes[noteId]?.length ?? 99;
    if (
      count > bestCount ||
      (count === bestCount && best !== null && (focus < bestFocus || (focus === bestFocus && noteId < best)))
    ) {
      best = noteId;
      bestCount = count;
      bestFocus = focus;
    }
  }
  return best;
}

/** Bare spec-point codes a misconception maps onto (spine-filtered). */
function misPoints(bridge: LearnerBridge, points: string[]): string[] {
  const set = new Set(bridge.pointIds);
  return points
    .map((raw) => normalizeCode(raw, bridge.codePrefix))
    .filter((id) => set.has(id));
}

/**
 * Most recent question-player deep link whose question touches any of
 * `pointIds` — from the learner's own recorded topic slugs. Falls back to
 * the course's exam-questions index when no attempt carries a slug.
 */
function practiceHref(
  course: string,
  bridge: LearnerBridge,
  progress: CourseProgress,
  pointIds: string[],
): string {
  const wanted = new Set(pointIds);
  let bestSlug: string | null = null;
  let bestAt = 0;
  const consider = (questionId: string | undefined, at: number, slug: string | null) => {
    if (!questionId || !slug) return;
    const codes = bridge.questionCodes[questionId] ?? [];
    if (!codes.some((raw) => wanted.has(normalizeCode(raw, bridge.codePrefix)))) return;
    if (at > bestAt) {
      bestAt = at;
      bestSlug = slug;
    }
  };
  for (const [qid, ev] of Object.entries(progress.selfScores)) consider(qid, ev.at, ev.topicSlug);
  for (const [qid, ev] of Object.entries(progress.mcqAnswers)) consider(qid, ev.at, ev.topicSlug);
  return bestSlug
    ? `/courses/${course}/exam-questions/${bestSlug}`
    : `/courses/${course}/exam-questions`;
}

// ── per-course derivation ───────────────────────────────────────────────

function deriveCourseActions(input: NbaCourseInput, now: number): DashboardAction[] {
  const { slug, subject, level, bridge, progress } = input;
  if (!bridge) return [];
  const base = { course: slug, courseLabel: subject, courseLevel: level };
  const actions: DashboardAction[] = [];
  const noteMap = notesByPoint(bridge);
  const pointText = (id: string) =>
    bridge.pointTexts?.[id] ? truncate(bridge.pointTexts[id]) : null;

  // ── tier 0 — misconception remediation (KG phase 3 watch, SIMULATED) ──
  for (const m of bridge.misconceptions) {
    if (!m.active) continue;
    const pts = misPoints(bridge, m.points);
    if (pts.length === 0) continue;
    const noteId = bestNoteFor(bridge, noteMap, pts);
    const pct = Math.round(m.probability * 100);
    actions.push({
      ...base,
      key: `${slug}:mis:${m.id}`,
      tier: 0,
      actionType: "REMEDIATE_MISCONCEPTION",
      reasonCode: "MISCONCEPTION_SUSPECTED",
      title: m.title,
      detail:
        `SIMULATED likelihood ${pct}% · ${plural(m.evidenceCount, "evidence signal")} · ` +
        `mapped to ${plural(pts.length, "spec point")}`,
      href: noteId
        ? `/courses/${slug}/revision-notes/${noteId}`
        : `/knowledge-graph?course=${slug}`,
      cta: noteId ? "Review note" : "Open graph",
      score: m.probability,
    });
    if (actions.filter((a) => a.tier === 0).length >= 2) break;
  }

  // ── tier 1 — review-due points (forgetting-decay model) ──────────────
  const model = buildOverlay(progress, bridge, now);
  const due = model.details.filter((d) => d.reviewDue && d.mastery != null);
  if (due.length > 0) {
    // the note covering the most due points is the single best revision stop
    const noteId = bestNoteFor(bridge, noteMap, due.map((d) => d.pointId));
    const weakest = due.reduce((w, d) =>
      effectiveMastery(d.mastery as number, d.lastAttemptAt, now) <
      effectiveMastery(w.mastery as number, w.lastAttemptAt, now)
        ? d
        : w,
    );
    const eff = effectiveMastery(weakest.mastery as number, weakest.lastAttemptAt, now);
    const threshold = reviewThresholdFor(weakest.mastery as number);
    const overdueDays = Math.max(0, Math.floor((now - reviewDueAt(weakest.mastery as number, weakest.lastAttemptAt)) / DAY));
    const title =
      (noteId && bridge.noteTitles?.[noteId]) || pointText(weakest.pointId) || "Review due";
    actions.push({
      ...base,
      key: `${slug}:review:${noteId ?? weakest.pointId}`,
      tier: 1,
      actionType: "REVIEW_TOPIC",
      reasonCode: "DUE_REVIEW",
      title,
      detail:
        `${plural(due.length, "spec point")} due for review — weakest at ${eff}% effective ` +
        `mastery, up to ${plural(overdueDays, "day")} past the ${threshold} line`,
      href: noteId
        ? `/courses/${slug}/revision-notes/${noteId}`
        : practiceHref(slug, bridge, progress, [weakest.pointId]),
      cta: noteId ? "Revise" : "Practise",
      score: overdueDays,
    });
  }

  // ── tier 2 — problem question retry (marked attempt under 50%) ───────
  let worst: { questionId: string; ratio: number; at: number; score: number; max: number } | null =
    null;
  let wrongMcq: { questionId: string; at: number } | null = null;
  for (const [questionId, ev] of Object.entries(progress.selfScores)) {
    if (ev.max <= 0) continue;
    const ratio = ev.score / ev.max;
    if (ratio >= PROBLEM_RATIO) continue;
    if (!worst || ratio < worst.ratio || (ratio === worst.ratio && ev.at > worst.at)) {
      worst = { questionId, ratio, at: ev.at, score: ev.score, max: ev.max };
    }
  }
  for (const [questionId, ev] of Object.entries(progress.mcqAnswers)) {
    if (ev.correct) continue;
    if (!wrongMcq || ev.at > wrongMcq.at) wrongMcq = { questionId, at: ev.at };
  }
  if (worst || wrongMcq) {
    const q = worst
      ? { questionId: worst.questionId, at: worst.at }
      : { questionId: wrongMcq!.questionId, at: wrongMcq!.at };
    const codes = bridge.questionCodes[q.questionId] ?? [];
    const firstPoint = codes
      .map((raw) => normalizeCode(raw, bridge.codePrefix))
      .map(pointText)
      .find(Boolean) as string | undefined;
    const topicSlug =
      progress.selfScores[q.questionId]?.topicSlug ??
      progress.mcqAnswers[q.questionId]?.topicSlug ??
      null;
    actions.push({
      ...base,
      key: `${slug}:retry:${q.questionId}`,
      tier: 2,
      actionType: "RETRY_PROBLEM_QUESTION",
      reasonCode: "PROBLEM_QUESTION",
      title: firstPoint ?? "Exam question",
      detail: worst
        ? `You scored ${worst.score}/${worst.max} (${Math.round(worst.ratio * 100)}%) · marked ${daysAgo(now, q.at)}`
        : `Answered incorrectly · ${daysAgo(now, q.at)}`,
      href: topicSlug
        ? `/courses/${slug}/exam-questions/${topicSlug}`
        : `/courses/${slug}/exam-questions`,
      cta: "Retry now",
      score: worst ? worst.ratio : 0,
    });
  }

  // ── tier 3 — low-mastery practise (measured, below the low band) ─────
  const low = model.details
    .filter((d) => d.mastery != null && d.mastery < MASTERY_BANDS.low && d.attempts > 0)
    .sort((a, b) => (a.mastery as number) - (b.mastery as number) || b.attempts - a.attempts);
  const weakest = low[0];
  if (weakest) {
    const title = pointText(weakest.pointId) ?? "Weak topic";
    actions.push({
      ...base,
      key: `${slug}:practise:${weakest.pointId}`,
      tier: 3,
      actionType: "PRACTISE_QUESTIONS",
      reasonCode: "LOW_MASTERY",
      title,
      detail: `Mastery ${weakest.mastery}% across ${plural(weakest.attempts, "marked attempt")} — below the ${MASTERY_BANDS.low} low band`,
      href: practiceHref(slug, bridge, progress, [weakest.pointId]),
      cta: "Practise",
      score: weakest.mastery as number,
    });
  }

  // ── tier 4 — coverage: a note the learner never opened ───────────────
  const anyEvidence =
    model.stats.attempts > 0 || model.stats.notesRead > 0 || model.stats.flashcards > 0;
  if (anyEvidence) {
    const candidates = Object.keys(bridge.noteCodes)
      .filter((noteId) => !progress.notesRead[noteId])
      .filter((noteId) => (bridge.noteCodes[noteId] ?? []).some((raw) => {
        const id = normalizeCode(raw, bridge.codePrefix);
        return bridge.pointIds.includes(id);
      }))
      .sort((a, b) => (bridge.noteCodes[a].length - bridge.noteCodes[b].length) || a.localeCompare(b));
    const noteId = candidates[0];
    if (noteId) {
      const k = new Set(
        (bridge.noteCodes[noteId] ?? [])
          .map((raw) => normalizeCode(raw, bridge.codePrefix))
          .filter((id) => bridge.pointIds.includes(id)),
      ).size;
      actions.push({
        ...base,
        key: `${slug}:uncovered:${noteId}`,
        tier: 4,
        actionType: "UNCOVERED_NOTE",
        reasonCode: "UNCOVERED_TOPIC",
        title: bridge.noteTitles?.[noteId] ?? "Revision note",
        detail: `Not started — covers ${plural(k, "spec point")} you have no notes on yet`,
        href: `/courses/${slug}/revision-notes/${noteId}`,
        cta: "Read note",
        score: 0,
      });
    }
  }

  return actions;
}

/** Per-tier comparators — within a tier, "more urgent" sorts first. */
function tierLess(a: DashboardAction, b: DashboardAction): boolean {
  if (a.tier !== b.tier) return a.tier < b.tier;
  switch (a.tier) {
    case 0:
      return a.score > b.score; // highest sim likelihood first
    case 1:
      return a.score > b.score; // most overdue first
    case 2:
      return a.score < b.score; // worst marked ratio first
    case 3:
      return a.score < b.score; // weakest mastery first
    default:
      return false;
  }
}

/**
 * Derive and rank the dashboard's next-best-action rows across all of the
 * learner's subjects. Deterministic: tier, then per-tier urgency, then the
 * course's roster order.
 */
export function deriveDashboardActions(
  inputs: NbaCourseInput[],
  now: number,
  cap = NBA_ROW_CAP,
): DashboardAction[] {
  const all: DashboardAction[] = [];
  for (const input of inputs) all.push(...deriveCourseActions(input, now));
  // stable insertion sort with the tier comparator, then roster order
  const ranked = [...all].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const aIdx = inputs.findIndex((i) => i.slug === a.course);
    const bIdx = inputs.findIndex((i) => i.slug === b.course);
    if (aIdx !== bIdx) return aIdx - bIdx;
    return tierLess(a, b) ? -1 : tierLess(b, a) ? 1 : a.key.localeCompare(b.key);
  });
  return ranked.slice(0, cap);
}

/** Humanized reason codes for the card's policy footer (web parity). */
export function humanizeCode(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
