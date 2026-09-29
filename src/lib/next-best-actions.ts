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
 * Action tiers — HUB-DASH-CORE re-ranking (operator trace 1a0ec29c8c8cfb71).
 * On the LOCAL path the learner's own measured evidence always outranks the
 * seeded sim learner's guesses: remediation-before-review-before-retry
 * becomes review before retry before practice before SIMULATED misconception
 * watch before coverage:
 *
 *   0 REVIEW_TOPIC (DUE_REVIEW) — points whose Ebbinghaus-decayed effective
 *     mastery crossed their review threshold
 *   1 RETRY_PROBLEM_QUESTION (PROBLEM_QUESTION) — a marked attempt under 50%
 *   2 PRACTISE_QUESTIONS (LOW_MASTERY) — measured but below the low band
 *   3 REMEDIATE_MISCONCEPTION (MISCONCEPTION_SUSPECTED) — active sim states
 *     from the course misconception corpus (KG phase 3), SIMULATED — demoted
 *     below measured evidence because a deterministic demo overlay must not
 *     outrank what the learner actually did
 *   4 UNCOVERED_NOTE (UNCOVERED_TOPIC) — a note the learner never opened
 *
 * When the core read model is live (lib/dashboard-core.ts), the pilot course's
 * rows come from core's T-033 recommendations instead (coreActionsToDashboard)
 * and keep core's own rank order — there, misconception rows are the
 * account's evidence-gated BDT states (measured, not the sim learner), so
 * their priority is core's call, not this module's.
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
import type { NextBestActionView, NextBestActionsView } from "./types";

export type NbaActionType =
  | "REMEDIATE_MISCONCEPTION"
  | "REVIEW_TOPIC"
  | "RETRY_PROBLEM_QUESTION"
  | "PRACTISE_QUESTIONS"
  | "UNCOVERED_NOTE"
  // core-only action types (HUB-DASH-CORE P1-4) — the local rules never
  // produce these, but core's T-033 read model can; the card gives each a chip
  | "REVIEW_PREREQUISITE"
  | "ASK_TUTOR"
  | "TIMED_EXERCISE";

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
  /** the deterministic rule that produced the row — local reason codes or
   *  core's nba-rules vocabulary (humanized for the policy footer) */
  reasonCode: string;
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

export function daysAgo(now: number, at: number): string {
  const d = Math.floor((now - at) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

/**
 * Full/normalized sub-topic code → the hub question-set slug anchored there
 * (HUB-DASH-CORE P1). Tolerant of both code spellings ("4CH1-S4-d" and
 * "S4-d"); null when the bridge didn't publish the join or the code isn't an
 * anchored sub-topic — callers fall back to the exam-questions index.
 */
export function subtopicSetFor(
  code: string | null | undefined,
  bridge: Pick<LearnerBridge, "codePrefix" | "subtopicSets"> | null | undefined,
): string | null {
  if (!code || !bridge?.subtopicSets) return null;
  const sets = bridge.subtopicSets;
  if (sets[code]) return sets[code];
  const prefix = bridge.codePrefix;
  if (!prefix) return null;
  if (code.startsWith(`${prefix}-`)) return sets[code] ?? null; // already prefixed, miss is a miss
  return sets[`${prefix}-${code}`] ?? null; // bare code → prefixed key
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

  // ── tier 0 — review-due points (forgetting-decay model) ──────────────
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
      tier: 0,
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

  // ── tier 1 — problem question retry (marked attempt under 50%) ───────
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
      tier: 1,
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

  // ── tier 2 — low-mastery practise (measured, below the low band) ────
  const low = model.details
    .filter((d) => d.mastery != null && d.mastery < MASTERY_BANDS.low && d.attempts > 0)
    .sort((a, b) => (a.mastery as number) - (b.mastery as number) || b.attempts - a.attempts);
  const weakest = low[0];
  if (weakest) {
    const title = pointText(weakest.pointId) ?? "Weak topic";
    actions.push({
      ...base,
      key: `${slug}:practise:${weakest.pointId}`,
      tier: 2,
      actionType: "PRACTISE_QUESTIONS",
      reasonCode: "LOW_MASTERY",
      title,
      detail: `Mastery ${weakest.mastery}% across ${plural(weakest.attempts, "marked attempt")} — below the ${MASTERY_BANDS.low} low band`,
      href: practiceHref(slug, bridge, progress, [weakest.pointId]),
      cta: "Practise",
      score: weakest.mastery as number,
    });
  }

  // ── tier 3 — misconception watch (KG phase 3 — SIMULATED, DEMOTED) ──
  // HUB-DASH-CORE (P1-6, operator trace 1a0ec29c8c8cfb71): the sim learner's
  // states are a deterministic demo overlay, not the learner's evidence —
  // they used to outrank review/retry/practise rows derived from the marks
  // the learner actually recorded. On the LOCAL path they now rank below all
  // measured tiers. When the core model is live, misconception rows come
  // from core's evidence-gated BDT states via coreActionsToDashboard and
  // core owns their priority (this branch isn't consulted for the pilot).
  for (const m of bridge.misconceptions) {
    if (!m.active) continue;
    const pts = misPoints(bridge, m.points);
    if (pts.length === 0) continue;
    const noteId = bestNoteFor(bridge, noteMap, pts);
    const pct = Math.round(m.probability * 100);
    actions.push({
      ...base,
      key: `${slug}:mis:${m.id}`,
      tier: 3,
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
    if (actions.filter((a) => a.tier === 3).length >= 2) break;
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
      return a.score > b.score; // most overdue first
    case 1:
      return a.score < b.score; // worst marked ratio first
    case 2:
      return a.score < b.score; // weakest mastery first
    case 3:
      return a.score > b.score; // highest sim likelihood first
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

// ── core read model rows (HUB-DASH-CORE P1-4, trace 1a0ec29c8c8cfb71) ────

export interface CoreActionInput {
  course: string;
  courseLabel: string;
  courseLevel: string;
  /** the pilot's content bridge — codePrefix + subtopicSets deep-link core
   *  target codes into the hub's own question sets; null degrades to the
   *  exam-questions index (the honest, always-correct destination) */
  bridge: LearnerBridge | null;
}

function coreHref(
  raw: NextBestActionView,
  input: CoreActionInput,
): { href: string; cta: string } {
  const base = `/courses/${input.course}`;
  if (raw.actionType === "ASK_TUTOR") return { href: "/tutor", cta: "Ask the AI Tutor" };
  const setSlug = subtopicSetFor(raw.targetCode, input.bridge);
  if (setSlug) {
    const cta =
      raw.actionType === "RETRY_PROBLEM_QUESTION"
        ? "Retry now"
        : raw.actionType === "TIMED_EXERCISE"
          ? "Practise timed"
          : raw.actionType === "REVIEW_TOPIC" || raw.actionType === "REVIEW_PREREQUISITE"
            ? "Revise"
            : "Practise";
    return { href: `${base}/exam-questions/${setSlug}`, cta };
  }
  return { href: `${base}/exam-questions`, cta: "Practise" };
}

/**
 * Map core's T-033 recommendation rows onto the dashboard's action shape.
 * The rows are rendered in core's own rank order — core's ranking IS the
 * audited deterministic read model this card's local rules are a port of,
 * so re-ranking it client-side would only add a second opinion. Every
 * reason line is core's evidence-derived reasonDetail verbatim; nothing is
 * reworded or invented here.
 */
export function coreActionsToDashboard(
  view: NextBestActionsView,
  input: CoreActionInput,
): DashboardAction[] {
  return [...view.actions]
    .sort((a, b) => a.rank - b.rank || a.targetCode.localeCompare(b.targetCode))
    .map((raw) => {
      const { href, cta } = coreHref(raw, input);
      return {
        key: `core:${raw.actionType}:${raw.targetNodeId}:${raw.questionId ?? ""}`,
        course: input.course,
        courseLabel: input.courseLabel,
        courseLevel: input.courseLevel,
        // rank-order flag — the local tier comparator is bypassed for
        // core rows (the card keeps core's order); 0 keeps type sanity
        tier: -1,
        actionType: raw.actionType as NbaActionType,
        reasonCode: raw.reasonCode as string,
        title: raw.targetTitle || "Next step",
        detail:
          raw.servableQuestionCount === 0
            ? `${raw.reasonDetail} — no validated questions are mapped there yet`
            : raw.reasonDetail,
        href,
        cta,
        score: raw.rank,
      };
    });
}
