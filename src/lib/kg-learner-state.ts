"use client";

/**
 * Learner drawer state — KG phase 2 (My State + History).
 *
 * Layers the demo's honest answer to the web workbench's "My State" and
 * "History" surfaces on top of the phase-1 derivation: one derivation pass
 * (lib/learner-state.ts) feeds both the renderer overlay and this module's
 * drawer model, so the graph and the drawer can never disagree.
 *
 * What the drawer shows, and what it refuses to:
 *
 *   - My State: stored → effective mastery per touched spec point
 *     (effective = stored × Ebbinghaus retention, lib/forgetting.ts), the
 *     decay-derived review queue, exposure-only points and the awaiting-marks
 *     count. Bands mirror the renderer's paint (low <55 · developing 55–69 ·
 *     good 70–79 · strong ≥80) — computed on the EFFECTIVE number, like the
 *     web workbench's decayed bands.
 *   - Misconception watch (KG phase 3): the seeded sim learner's active /
 *     watching misconception states over the course's misconception corpus
 *     (SME/mark-scheme provenance). SIMULATED states, labelled as such — the
 *     demo has no distractor→misconception telemetry, so nothing here claims
 *     measured evidence; the corpus content itself is real, the STATE is the
 *     deterministic demo overlay.
 *   - History: the recorded evidence stream, newest first — facts only (what
 *     was answered, how it was marked, where it came from), never advice and
 *     no re-derived mastery. Typed drafts on questions without a self-score
 *     show the honest "awaiting marks" state; once a part is self-scored the
 *     draft is represented by its marked event, not by a stale awaiting row.
 *     Simulated misconception states are NOT history events — history is
 *     what the learner did, not what a model guesses.
 *
 * Everything derives from the browser-local progress store (SIMULATED,
 * browser-local, never written to course data) — the derivation is live, so
 * the drawer reflects the current store rather than a frozen log snapshot.
 */
import { useEffect, useMemo, useState } from "react";
import { useCourseProgress, type CourseProgress } from "./progress";
import { reviewDueAt, effectiveMastery, bandFor, type MasteryBand } from "./forgetting";
import {
  buildOverlay,
  emptyStats,
  fetchBridge,
  normalizeCode,
  type LearnerBridge,
  type LearnerOverlayEntry,
  type LearnerOverlayStats,
  type LearnerModel,
} from "./learner-state";
import { api, getToken } from "./api";
import { summarizeCardReviews, type CardReviewSummary } from "./flashcard-review";
import type {
  LearnerStateView,
  LearnerKnowledgeGraphView,
  AttemptHistoryView,
  CourseStatsView,
} from "./types";
import { fetchPilotInfo } from "./attempt-bridge";

// ── overlay (phase-1 shape, unchanged contract) ─────────────────────────

export interface LearnerOverlayState {
  entries: Record<string, LearnerOverlayEntry>;
  stats: LearnerOverlayStats;
  /** bridge fetch failed — the host chip explains, the graph stays honest */
  bridgeError: boolean;
}

// ── drawer model ────────────────────────────────────────────────────────

export interface PointState {
  pointId: string;
  statement: string | null;
  /** demonstrated mastery from marked attempts — null = exposure only */
  stored: number | null;
  /** stored × Ebbinghaus retention — the honest "where am I now" number */
  effective: number | null;
  band: MasteryBand | null;
  attempts: number;
  exposure: number;
  lastAt: number;
  reviewDue: boolean;
  dueAt: number;
  /** revision notes mapped to this point (deep-linkable) */
  noteIds: string[];
  /** active simulated misconception label — display only, never mastery */
  misconception: string | null;
}

export interface ReviewItem {
  pointId: string;
  statement: string | null;
  stored: number;
  effective: number;
  dueAt: number;
  noteIds: string[];
}

export type LearnerEventKind = "marked" | "awaiting" | "exposure";

/** One TOPIC-level measured mastery (core path): core's assessment evidence
 *  fires at topic granularity (the question's primary topic node), so the
 *  honest core drawer shows these alongside the spec-point table. */
export interface TopicMasteryState {
  title: string;
  stored: number;
  effective: number;
  band: MasteryBand | null;
  attempts: number;
  lastAt: number;
}

/** One sim-learner misconception state for the My State watch card
 *  (KG phase 3). Content = corpus; state = SIMULATED. */
export interface MisconceptionWatchItem {
  id: string;
  title: string;
  label: string;
  summary: string | null;
  /** normalized spec-point ids present in the exported spine */
  points: string[];
  probability: number;
  active: boolean;
  evidenceCount: number;
}

export interface MisconceptionWatch {
  items: MisconceptionWatchItem[];
  /** the seeded sim learner's own disclaimer, verbatim */
  disclaimer: string | null;
}

export interface LearnerEvent {
  id: string;
  at: number;
  kind: LearnerEventKind;
  label: string;
  /** "4/6" style value — null when nothing is measured yet */
  value: string | null;
  detail: string;
  /** normalized spec-point codes the event maps onto (may be empty) */
  points: string[];
  /** deep link when the event itself is revisitable (read notes) */
  href: string | null;
}

export interface LearnerDrawerState {
  /** summary counts (same numbers the host chip and graph legend show) */
  stats: LearnerOverlayStats;
  /** TOPIC-level mastery from core (core's evidence granularity for
   *  attempts) — visible only on the core path; spec points stay the graph's
   *  honest per-point surface */
  topicStates?: TopicMasteryState[];
  /** every touched point, review-due first, then weakest effective first */
  pointStates: PointState[];
  /** decay-derived review queue — due now, stalest first */
  reviewQueue: ReviewItem[];
  /** not due yet, but crossing their threshold within the window — the
   *  decay model made legible (capped) */
  upcoming: ReviewItem[];
  /** misconception watch (KG phase 3) — null when the course has no corpus */
  misconceptionWatch: MisconceptionWatch | null;
  /** tranche 4.6: the Ebbinghaus flashcard review queue, scheduled from the
   *  device-local rating trail (lib/flashcard-review.ts) — null when no card
   *  was ever rated on this browser. Self-report feeds SCHEDULING only; the
   *  attempts reviewQueue above stays the mastery-derived queue. */
  cardReviews?: CardReviewSummary | null;
  /** recorded evidence stream, newest first (capped) */
  events: LearnerEvent[];
  /** number of recorded signals before the display cap */
  eventCount: number;
}

/** History display cap — the store stays small in practice; the footer
 *  reports the uncounted tail honestly. */
const EVENTS_CAP = 300;

/** Upcoming-review horizon — points crossing their threshold within this
 *  window appear as a muted "coming up" list under the queue. */
const UPCOMING_WINDOW_MS = 90 * 86_400_000;
const UPCOMING_CAP = 5;

/** Fetch the exported KG JSON's spec-point statements (module-cached). */
const titlesCache = new Map<string, Promise<Record<string, string>>>();

function fetchTitles(course: string): Promise<Record<string, string>> {
  const hit = titlesCache.get(course);
  if (hit) return hit;
  const promise = fetch(`/kg/data/${encodeURIComponent(course)}.json`)
    .then((res) => (res.ok ? (res.json() as Promise<SpecPointNode[] | KgJson>) : null))
    .then((json) => {
      if (!json) return {};
      const nodes = Array.isArray(json) ? json : (json.nodes ?? []);
      const titles: Record<string, string> = {};
      for (const n of nodes) {
        if (n.type === "SpecificationPoint" && n.pointId) {
          titles[n.pointId] = (n.statement ?? n.label ?? "").trim();
        }
      }
      return titles;
    })
    .catch(() => ({}));
  titlesCache.set(course, promise);
  return promise;
}

interface SpecPointNode {
  type?: string;
  pointId?: string;
  label?: string;
  statement?: string;
}

interface KgJson {
  nodes?: SpecPointNode[];
}

/** raw bundle codes → the point ids the exported spine actually carries
 *  (shared by the sim derivation and the core-state branch — V47 rating
 *  exposure attribution rides the same join, so the two paths cannot drift) */
function toPointIdsOf(bridge: LearnerBridge, rawCodes: string[] | undefined): string[] {
  if (!rawCodes) return [];
  const codeSet = new Set(bridge.pointIds);
  return [...new Set(rawCodes.map((raw) => normalizeCode(raw, bridge.codePrefix)))
    ].filter((c) => codeSet.has(c));
}

// ── derivation ──────────────────────────────────────────────────────────

function buildDrawerState(
  progress: CourseProgress,
  bridge: LearnerBridge,
  model: LearnerModel,
  titles: Record<string, string>,
  now: number,
): LearnerDrawerState {
  const codeSet = new Set(bridge.pointIds);
  const normalize = (raw: string) => normalizeCode(raw, bridge.codePrefix);
  const toPointIds = (rawCodes: string[] | undefined): string[] =>
    toPointIdsOf(bridge, rawCodes);

  // reverse map: point → revision notes covering it (for deep links)
  const notesByPoint = new Map<string, string[]>();
  for (const [noteId, rawCodes] of Object.entries(bridge.noteCodes)) {
    for (const pid of toPointIds(rawCodes)) {
      const list = notesByPoint.get(pid) ?? [];
      list.push(noteId);
      notesByPoint.set(pid, list);
    }
  }

  // ── point states (from the phase-1 accumulators — no second truth) ──
  // decay anchors on the last MARKED attempt (d.lastAttemptAt): reading a
  // note is exposure, not practice — it must not refresh the memory clock
  const pointStates: PointState[] = model.details.map((d) => {
    const stored = d.mastery;
    const effective =
      stored == null ? null : effectiveMastery(stored, d.lastAttemptAt, now);
    return {
      pointId: d.pointId,
      statement: titles[d.pointId] ?? null,
      stored,
      effective,
      band: effective == null ? null : bandFor(effective),
      attempts: d.attempts,
      exposure: d.exposure,
      lastAt: d.lastAt,
      reviewDue: d.reviewDue,
      dueAt: stored == null ? d.lastAt : reviewDueAt(stored, d.lastAttemptAt),
      noteIds: notesByPoint.get(d.pointId) ?? [],
      misconception: d.misconception,
    };
  });
  // review-due first (stalest due date first), then measured rows weakest
  // effective first, exposure-only rows last — the order a learner would
  // work the list in
  pointStates.sort((a, b) => {
    if (a.reviewDue !== b.reviewDue) return a.reviewDue ? -1 : 1;
    const am = a.effective != null;
    const bm = b.effective != null;
    if (am !== bm) return am ? -1 : 1;
    if (am && bm) {
      const d = (a.effective as number) - (b.effective as number);
      if (d !== 0) return d;
    }
    return b.lastAt - a.lastAt;
  });

  const reviewQueue: ReviewItem[] = pointStates
    .filter((p) => p.reviewDue && p.stored != null)
    .map((p) => ({
      pointId: p.pointId,
      statement: p.statement,
      stored: p.stored as number,
      effective: p.effective as number,
      dueAt: p.dueAt,
      noteIds: p.noteIds,
    }))
    .sort((a, b) => a.dueAt - b.dueAt);

  const upcoming = pointStates
    .filter(
      (p) =>
        !p.reviewDue &&
        p.stored != null &&
        p.dueAt > now &&
        p.dueAt - now <= UPCOMING_WINDOW_MS,
    )
    .map((p) => ({
      pointId: p.pointId,
      statement: p.statement,
      stored: p.stored as number,
      effective: p.effective as number,
      dueAt: p.dueAt,
      noteIds: p.noteIds,
    }))
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, UPCOMING_CAP);

  // ── evidence stream (facts only — see header) ───────────────────────
  const events: LearnerEvent[] = [];

  for (const [questionId, ev] of Object.entries(progress.selfScores)) {
    if (ev.max <= 0) continue;
    events.push({
      id: `score:${questionId}`,
      at: ev.at,
      kind: "marked",
      label: "Self-marked written answer",
      value: `${ev.score}/${ev.max}`,
      detail: ev.topicSlug ? `marked against the mark scheme · ${ev.topicSlug}` : "marked against the mark scheme",
      points: toPointIds(bridge.questionCodes[questionId]),
      href: null,
    });
  }

  for (const [questionId, ev] of Object.entries(progress.mcqAnswers)) {
    events.push({
      id: `mcq:${questionId}`,
      at: ev.at,
      kind: "marked",
      label: "MCQ answered",
      value: ev.correct ? "1/1" : "0/1",
      detail: `chose ${ev.chosen ?? "—"} · ${ev.correct ? "correct" : "not correct"}`,
      points: toPointIds(bridge.questionCodes[questionId]),
      href: null,
    });
  }

  // typed drafts: only visible as "awaiting marks" while their question has
  // no self-score — after scoring, the marked event carries the record
  for (const [partId, ev] of Object.entries(progress.typedAnswers)) {
    const parentId = bridge.partParent[partId];
    if (parentId && progress.selfScores[parentId]) continue;
    events.push({
      id: `typed:${partId}`,
      at: ev.at,
      kind: "awaiting",
      label: "Written answer",
      value: null,
      detail: "saved — awaiting marks",
      points: toPointIds(bridge.questionCodes[partId] ?? bridge.questionCodes[parentId ?? ""]),
      href: null,
    });
  }

  for (const [noteId, ev] of Object.entries(progress.notesRead)) {
    events.push({
      id: `note:${noteId}`,
      at: ev.at,
      kind: "exposure",
      label: "Note read",
      value: null,
      detail: ev.helpful === "up" ? "rated helpful" : ev.helpful === "down" ? "rated not helpful" : "exposure only — never mastery",
      points: toPointIds(bridge.noteCodes[noteId]),
      href: `/revision-notes/${encodeURIComponent(noteId)}`,
    });
  }

  for (const [cardId, ev] of Object.entries(progress.flashcards)) {
    events.push({
      id: `card:${cardId}`,
      at: ev.at,
      kind: "exposure",
      label: "Flashcard rated",
      value: null,
      detail: ev.rating === "know" ? 'rated "know"' : 'rated "still-learning"',
      points: toPointIds(bridge.flashcardCodes[cardId]),
      href: null,
    });
  }

  // saved questions are bookmarks, not learning evidence — excluded on
  // purpose so the history stays a record of what actually happened

  events.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));

  // ── misconception watch (KG phase 3) — active first, then probability ──
  const watchItems: MisconceptionWatchItem[] = (bridge.misconceptions ?? [])
    .map((m) => ({
      id: m.id,
      title: m.title,
      label: m.label,
      summary: m.summary,
      points: toPointIds(m.points),
      probability: m.probability,
      active: m.active,
      evidenceCount: m.evidenceCount,
    }))
    .filter((m) => m.points.length > 0)
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        b.probability - a.probability ||
        a.id.localeCompare(b.id),
    );

  return {
    stats: model.stats,
    pointStates,
    reviewQueue,
    upcoming,
    misconceptionWatch: watchItems.length
      ? { items: watchItems, disclaimer: bridge.misconceptionDisclaimer }
      : null,
    events: events.slice(0, EVENTS_CAP),
    eventCount: events.length,
  };
}

// ── react binding ───────────────────────────────────────────────────────

export interface LearnerStateBundle {
  /** phase-1 overlay for the renderer postMessage — null while loading */
  overlay: LearnerOverlayState | null;
  /** phase-2 drawer model — null while the bridge loads or failed */
  drawer: LearnerDrawerState | null;
  /** where the model came from — core (real learner account) or simulated
   *  (browser-local overlay, the demo default). Honest labels ride on it. */
  source: "core" | "simulated";
}

// ── core-backed model (ADR-029 tranche 4: the 4CH1 bridge) ──────────────

interface CoreModelData {
  overlay: LearnerOverlayState;
  drawer: LearnerDrawerState;
}

/** core band label → the demo's band vocabulary (hub paints 4 bands). */
function coreBand(band: string | null | undefined): MasteryBand | null {
  if (band === "LOW") return "low";
  if (band === "DEVELOPING") return "developing";
  if (band === "SECURE") return "strong";
  return null;
}

/**
 * The pilot's REAL learner model, read from the learner's core account:
 * GET /state (skills + misconceptions + review queue), GET /knowledge-graph
 * (per-node codes → the spine join), GET /attempts (history events). When it
 * resolves, it REPLACES the simulated derivation — same overlay contract, same
 * drawer shapes, honest CORE provenance. Any negative (not the pilot, signed
 * out, backend down) falls back to the simulated path without a word of
 * complaint.
 */
function useCoreLearnerModel(course: string): CoreModelData | "off" | "loading" | null {
  const [state, setState] = useState<CoreModelData | "off" | "loading" | null>("loading");

  const load = useMemo(
    () => async (): Promise<CoreModelData | "off" | null> => {
      if (!getToken()) return "off";
      const pilot = await fetchPilotInfo(course);
      if (!pilot) return "off";
      const bridge = await fetchBridge(course);
      if (!bridge) return "off";
      let coreState: LearnerStateView;
      let coreKg: LearnerKnowledgeGraphView;
      let history: AttemptHistoryView;
      // course-stats (tranche 4.11): full-trail coverage aggregates. Tolerant
      // fetch — a core one contract behind must not take the whole core path
      // down; the drawer falls back to its own derivations (deploy-skew safe
      // both directions, the same ruling as the V47/V48 additive view fields).
      const courseStatsP = api.learnerCourseStats().catch(() => null);
      try {
        [coreState, coreKg, history] = await Promise.all([
          api.learnerState(),
          api.learnerKnowledgeGraph(pilot.rootId),
          api.learnerAttempts(50),
        ]);
      } catch {
        return "off"; // core unreachable — simulated path takes over silently
      }

      const now = Date.now();

      // nodeId → spine pointId (SUBTOPIC codes only; concepts/misconceptions
      // have no spine counterpart and are filtered by the pointIds set anyway)
      const pointIdByNodeId = new Map<string, string>();
      for (const n of coreKg.nodes) {
        const id = normalizeCode(n.code, bridge.codePrefix);
        if (bridge.pointIds.includes(id)) pointIdByNodeId.set(n.id, id);
      }
      // spine statements (same source the sim path uses)
      const titles = await fetchTitles(course);
      // spec point → mapped revision notes (inverse of the bridge's noteCodes)
      const noteIdsByPoint = new Map<string, string[]>();
      for (const [noteId, codes] of Object.entries(bridge.noteCodes)) {
        for (const raw of codes) {
          const id = normalizeCode(raw, bridge.codePrefix);
          const list = noteIdsByPoint.get(id) ?? [];
          list.push(noteId);
          noteIdsByPoint.set(id, list);
        }
      }

      // skills → point states + overlay entries (mastery is 0..1 on core).
      // Core's assessment evidence fires at TOPIC granularity (the question's
      // primary topic node), so skills on topic/UNIT nodes are surfaced as
      // topicStates — visible in the drawer, never painted as spec points
      // (that would fabricate per-point precision core does not claim).
      const nodeById = new Map(coreKg.nodes.map((n) => [n.id, n]));
      const topicStates: TopicMasteryState[] = [];
      const skillByPoint = new Map<
        string,
        LearnerStateView["skillStates"][number]
      >();
      for (const s of coreState.skillStates) {
        const pointId = pointIdByNodeId.get(s.nodeId);
        if (pointId) {
          skillByPoint.set(pointId, s);
          continue;
        }
        const node = nodeById.get(s.nodeId);
        if (node && (node.type === "TOPIC" || node.type === "UNIT")) {
          topicStates.push({
            title: s.nodeName ?? node.title,
            stored: Math.round(s.mastery * 100),
            effective: Math.round(s.effectiveMastery * 100),
            band: coreBand(s.band),
            attempts: s.attempts,
            lastAt: s.lastPracticedAt ? Date.parse(s.lastPracticedAt) : 0,
          });
        }
      }
      topicStates.sort((a, b) => b.attempts - a.attempts);
      const reviewByPoint = new Map<string, LearnerStateView["pendingReviews"][number]>();
      for (const r of coreState.pendingReviews) {
        const pointId = pointIdByNodeId.get(r.nodeId);
        if (pointId) reviewByPoint.set(pointId, r);
      }
      const misconceptionPointByNodeId = new Map<string, string>();
      for (const n of coreKg.nodes) {
        if (n.misconceptionActive && pointIdByNodeId.has(n.id)) {
          misconceptionPointByNodeId.set(n.id, pointIdByNodeId.get(n.id)!);
        }
      }
      const activeMisconceptionByPoint = new Map<string, string>();
      for (const [nodeId, pointId] of misconceptionPointByNodeId) {
        const node = coreKg.nodes.find((n) => n.id === nodeId);
        if (node) activeMisconceptionByPoint.set(pointId, node.title);
      }

      // flashcard rating exposure (V47, tranche 4.4): the self-report evidence
      // class. Attribution rides the bridge's flashcardCodes (cardId → spec
      // points via the subtopic-anchor join); ratings ADD exposure and history
      // but NEVER mastery — a rated point without marked attempts stays
      // "Not measured" (the same honesty rule the sim path applies).
      const ratingExposureByPoint = new Map<string, { count: number; lastAt: number }>();
      let ratingEventCount = 0;
      for (const r of coreState.flashcardRatings ?? []) {
        ratingEventCount += 1;
        const at = Date.parse(r.occurredAt);
        for (const pid of toPointIdsOf(bridge, bridge.flashcardCodes[r.cardId])) {
          const cur = ratingExposureByPoint.get(pid);
          ratingExposureByPoint.set(pid, {
            count: (cur?.count ?? 0) + 1,
            lastAt: Math.max(cur?.lastAt ?? 0, at),
          });
        }
      }

      const entries: Record<string, LearnerOverlayEntry> = {};
      const pointStates: PointState[] = [];
      let measured = 0;
      let attemptsTotal = 0;
      let reviewDue = 0;
      let exposureOnly = 0;

      for (const pointId of bridge.pointIds) {
        const s = skillByPoint.get(pointId);
        const r = reviewByPoint.get(pointId);
        const misconception = activeMisconceptionByPoint.get(pointId) ?? null;
        const ratingExposure = ratingExposureByPoint.get(pointId);
        if (!s && !r && !misconception && !ratingExposure) continue; // untouched
        const stored = s?.mastery != null ? Math.round(s.mastery * 100) : null;
        const effective =
          s?.effectiveMastery != null ? Math.round(s.effectiveMastery * 100) : null;
        const dueAt = r?.dueAt ? Date.parse(r.dueAt) : Number.POSITIVE_INFINITY;
        const due = !!r && dueAt <= now;
        if (s) {
          attemptsTotal += s.attempts;
          if (s.attempts > 0) measured += 1;
        } else if (ratingExposure) {
          exposureOnly += 1; // touched by self-report, never measured
        }
        if (due) reviewDue += 1;
        const ratingCount = ratingExposure?.count ?? 0;
        entries[pointId] = {
          mastery: effective,
          confidence: null,
          fluency: null,
          evidence: (s?.attempts ?? 0) + ratingCount,
          reviewDue: due,
          misconception,
        };
        pointStates.push({
          pointId,
          statement: titles[pointId] ?? null,
          stored,
          effective,
          band: coreBand(s?.band) ?? (stored != null ? bandFor(stored) : null),
          attempts: s?.attempts ?? 0,
          // attempts + flashcard rating exposure — self-report counts toward
          // evidence, never toward mastery (stored/effective stay null)
          exposure: (s?.attempts ?? 0) + ratingCount,
          lastAt: Math.max(
            s?.lastPracticedAt ? Date.parse(s.lastPracticedAt) : 0,
            ratingExposure?.lastAt ?? 0,
          ),
          reviewDue: due,
          dueAt: dueAt === Number.POSITIVE_INFINITY ? 0 : dueAt,
          noteIds: noteIdsByPoint.get(pointId) ?? [],
          misconception,
        });
      }
      pointStates.sort((a, b) => {
        if (a.reviewDue !== b.reviewDue) return a.reviewDue ? -1 : b.reviewDue ? 1 : 0;
        return (a.effective ?? 200) - (b.effective ?? 200);
      });

      // review queue — due now first, then upcoming within the window
      const due = pointStates.filter((p) => p.reviewDue && p.stored != null) as ReviewItem[];
      const upcoming = pointStates
        .filter((p) => !p.reviewDue && p.dueAt > now && p.dueAt - now < 90 * 86_400_000)
        .slice(0, 5)
        .map((p) => ({ ...p, stored: p.stored ?? 0 })) as ReviewItem[];

      // misconception watch — core's evidence-gated BDT states (measured,
      // not the seeded demo learner)
      const watch: MisconceptionWatch | null =
        coreState.misconceptionStates.length > 0
          ? {
              items: coreState.misconceptionStates.map((m, i) => ({
                id: m.misconceptionNodeId,
                title: m.misconceptionName ?? `Misconception ${i + 1}`,
                label: (m.misconceptionName ?? "").slice(0, 48),
                summary: null,
                points: [],
                probability: m.probability,
                active: m.active,
                evidenceCount: m.evidenceCount,
              })),
              disclaimer: null,
            }
          : null;

      // history events — the learner's own attempts, newest first
      const events: LearnerEvent[] = [
        ...history.attempts.map((a) => ({
          id: a.attemptId,
          at: Date.parse(a.attemptedAt),
          kind: (a.marksAwarded != null ? "marked" : "awaiting") as LearnerEventKind,
          label: a.topicTitle ?? a.topicCode ?? a.commandWord ?? "Question",
          value: a.marksAwarded != null ? `${a.marksAwarded}/${a.marksTotal}` : null,
          detail:
            a.stemExcerpt?.slice(0, 160) ??
            (a.marksAwarded != null ? "marked" : "awaiting marks"),
          points: [],
          href: null,
        })),
        // V47 (tranche 4.4): the append-only rating trail — every re-rate is
        // its own history event, keyed by card + timestamp
        ...(coreState.flashcardRatings ?? []).map((r) => ({
          id: `card:${r.cardId}:${r.occurredAt}`,
          at: Date.parse(r.occurredAt),
          kind: "exposure" as LearnerEventKind,
          label: "Flashcard rated",
          value: null,
          detail: r.rating === "know" ? 'rated "know"' : 'rated "still-learning"',
          points: toPointIdsOf(bridge, bridge.flashcardCodes[r.cardId]),
          href: null,
        })),
        // V48 (tranche 4.9): the append-only note-vote trail — every vote and
        // vote change is its own history event; the trail is self-report
        // evidence and the note's spec points stay "Not measured" without
        // marked attempts (the honesty rule, same as ratings)
        ...(coreState.noteVotes ?? []).map((v) => ({
          id: `notevote:${v.noteId}:${v.occurredAt}`,
          at: Date.parse(v.occurredAt),
          kind: "exposure" as LearnerEventKind,
          label: "Note voted",
          value: null,
          detail: v.vote === "helpful" ? 'rated helpful' : 'rated not helpful',
          points: toPointIdsOf(bridge, bridge.noteCodes[v.noteId]),
          href: null,
        })),
      ].sort((x, y) => y.at - x.at);

      const awaiting = events.filter((e) => e.kind === "awaiting").length;

      // Course-stats (tranche 4.11): the three coverage stats come from the
      // server-side FULL-trail aggregates when the contract is served — the
      // honest numbers. Fallbacks on deploy skew (core one contract behind)
      // keep the old derivations rather than fabricating zeros:
      //   - attempts: the true attempt-row total (the skill-state sum counts
      //     only point-level skills — TOPIC-granular assessment evidence,
      //     which is what core actually fires, was invisible to it);
      //   - notesRead: note views ARE core evidence (the idempotent view
      //     marker) — previously pinned 0 for want of a contract;
      //   - flashcards: DISTINCT cards rated over the whole trail (the
      //     state view serves only the latest 50 events).
      const courseStats: CourseStatsView | null = await courseStatsP;
      const stats: LearnerOverlayStats = {
        measured,
        touched: measured + exposureOnly,
        total: bridge.totalPoints,
        attempts: courseStats ? courseStats.attempts : attemptsTotal,
        notesRead: courseStats ? courseStats.notesViewed : 0,
        flashcards: courseStats ? courseStats.flashcardsRated : ratingEventCount,
        awaitingMarks: awaiting,
        reviewDue,
        misconceptions: coreState.misconceptionStates.filter((m) => m.active).length,
      };

      return {
        overlay: { entries, stats, bridgeError: false },
        drawer: {
          stats,
          topicStates,
          pointStates,
          reviewQueue: due,
          upcoming,
          misconceptionWatch: watch,
          events: events.slice(0, 300),
          eventCount: events.length,
        },
      };
    },
    [course],
  );

  useEffect(() => {
    let cancelled = false;
    load().then((r) => !cancelled && setState(r));
    // re-read when new core evidence lands anywhere (attempt submitted,
    // smart mark run) — the model is server-derived, it must re-fetch
    const refresh = () => load().then((r) => !cancelled && setState(r));
    window.addEventListener("syllabai:core-evidence", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("syllabai:core-evidence", refresh);
    };
  }, [load]);

  return state;
}

/**
 * Live learner state for one course: the CORE model when the course is the
 * pilot and the learner is signed in (real attempts, real decay, real review
 * queue), else the simulated browser-local derivation. Both feed the same
 * overlay contract and drawer shapes — the graph paint and the drawer can
 * never disagree, and the source label keeps the honesty rule.
 */
export function useLearnerState(course: string): LearnerStateBundle {
  const progress = useCourseProgress(course);
  const core = useCoreLearnerModel(course);
  const [bridge, setBridge] = useState<LearnerBridge | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);

  // reset derived-fetch state on course switch during render (react.dev —
  // "adjusting state when a prop changes"), then fetch below
  const [prevCourse, setPrevCourse] = useState(course);
  if (prevCourse !== course) {
    setPrevCourse(course);
    setBridge(null);
    setTitles({});
    setFailed(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetchBridge(course).then((b) => {
      if (cancelled) return;
      if (b) setBridge(b);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [course]);

  useEffect(() => {
    let cancelled = false;
    fetchTitles(course).then((t) => {
      if (cancelled) return;
      setTitles(t);
    });
    return () => {
      cancelled = true;
    };
  }, [course]);

  // core model wins whenever it resolved (pilot + signed in + reachable)
  const coreResult = useMemo(() => {
    if (core === "off" || core === "loading" || core === null) return null;
    return { overlay: core.overlay, drawer: core.drawer, source: "core" as const };
  }, [core]);

  const simResult = useMemo(() => {
    // decay math uses the derivation moment; the drawer recomputes on every
    // progress change and course switch, which is the honest cadence for a
    // browser-local demo (no nightly job exists to recompute server-side)
    const now = Date.now();
    if (failed) {
      return {
        overlay: { entries: {}, stats: emptyStats, bridgeError: true },
        drawer: null,
        source: "simulated" as const,
      };
    }
    if (!bridge) return null;
    const model = buildOverlay(progress, bridge, now);
    return {
      overlay: { entries: model.entries, stats: model.stats, bridgeError: false },
      drawer: buildDrawerState(progress, bridge, model, titles, now),
      source: "simulated" as const,
    };
  }, [progress, bridge, titles, failed]);

  // tranche 4.6: the flashcard review queue derives from the device-local
  // rating trail in BOTH modes (the core mirror is additive — every rating
  // lands locally first), so it is stamped once here where the paths
  // converge and neither derivation can drift from the other
  const cardReviews = useMemo(
    () => summarizeCardReviews(progress.flashcards, Date.now()),
    [progress],
  );

  if (coreResult) {
    return coreResult.drawer
      ? { ...coreResult, drawer: { ...coreResult.drawer, cardReviews } }
      : coreResult;
  }
  if (simResult) {
    return simResult.drawer
      ? { ...simResult, drawer: { ...simResult.drawer, cardReviews } }
      : simResult;
  }
  return { overlay: null, drawer: null, source: "simulated" };
}

// ── shared formatters ───────────────────────────────────────────────────

/** Coarse relative time for evidence timestamps ("just now" … "3mo ago"). */
export function formatRelative(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 90) return "just now";
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 36) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 45) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

/** Human label for a review due-date ("3d overdue" · "due today" · "due in 12d"). */
export function formatDue(dueAt: number, now: number): string {
  const d = (dueAt - now) / 86_400_000;
  if (d <= -1) return `${Math.floor(-d)}d overdue`;
  if (d <= 0) return "due today";
  return `due in ${Math.max(1, Math.ceil(d))}d`;
}
