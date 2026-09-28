"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Progress overlay — the demo's honest stand-in for SaveMyExams accounts.
 *
 * Research finding (§8): SME progress = per-sub-topic rings + marks, and
 * writing it needs an account. This demo has no accounts, so ALL progress is
 * a browser-local overlay, namespaced per course, and labelled SIMULATED
 * wherever it is shown. It never writes to canonical content or the learner
 * overlay JSON — refresh-safe via localStorage only. (Tranche 4.4 exception:
 * on the pilot course, when signed in, flashcard ratings ALSO mirror to the
 * learner's core account as append-only self-report evidence — lib/
 * flashcard-bridge.ts. The local overlay remains the source of truth for
 * this store's rings; the mirror never mutates it.)
 *
 * Three primitives, mirroring the research:
 *   - note-read      (notes ring)
 *   - self-score/mcq (question ring; SME "How did you do?" + instant MCQ mark)
 *   - flashcard      (flashcard ring: still-learning / know)
 *   - saved          (SME "Saved questions" sidebar entry)
 */

export type FlashcardRating = "still-learning" | "know";

export interface CourseProgress {
  notesRead: Record<string, { subtopic: string | null; at: number; helpful?: "up" | "down" }>;
  /** keyed by questionId — a question counts as attempted once any part is scored */
  selfScores: Record<string, { subtopic: string | null; topicSlug: string | null; score: number; max: number; at: number }>;
  mcqAnswers: Record<string, { subtopic: string | null; topicSlug: string | null; chosen: string | null; correct: boolean; at: number }>;
  flashcards: Record<
    string,
    {
      subtopic: string | null;
      rating: FlashcardRating;
      at: number;
      /** tranche 4.6: bounded rating trail (newest last) — the feed the
       *  Ebbinghaus review scheduler (lib/flashcard-review.ts) consumes.
       *  Optional so pre-4.6 records keep loading; they schedule
       *  conservatively from the latest rating alone. */
      trail?: Array<{ rating: FlashcardRating; at: number }>;
    }
  >;
  saved: Record<string, { subtopic: string | null; topicSlug: string | null; at: number }>;
  /**
   * Typed answer workspace (SME "type your answer" for structured questions),
   * keyed by part id. Draft text only — it never feeds rings or mastery until
   * the learner self-scores (or applies an AI-suggested score).
   */
  typedAnswers: Record<string, { text: string; at: number }>;
}

export const emptyProgress = (): CourseProgress => ({
  notesRead: {},
  selfScores: {},
  mcqAnswers: {},
  flashcards: {},
  saved: {},
  typedAnswers: {},
});

/** Bounded per-card rating trail (tranche 4.6) — see flashcards above and
 *  lib/flashcard-review.ts (the scheduler that reads it). */
export const TRAIL_CAP = 10;

const keyFor = (course: string) => `syllabai-hub:progress:${course}`;
const isBrowser = typeof window !== "undefined";

// module-level cache so every hook instance sees the same object graph
const cache = new Map<string, CourseProgress>();
const listeners = new Map<string, Set<() => void>>();

function load(course: string): CourseProgress {
  if (cache.has(course)) return cache.get(course)!;
  let data = emptyProgress();
  if (isBrowser) {
    try {
      const raw = window.localStorage.getItem(keyFor(course));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CourseProgress>;
        data = { ...emptyProgress(), ...parsed };
      }
    } catch {
      // corrupted state → reset (progress is disposable overlay by design)
    }
  }
  cache.set(course, data);
  return data;
}

function persist(course: string, next: CourseProgress) {
  cache.set(course, next);
  if (isBrowser) {
    try {
      window.localStorage.setItem(keyFor(course), JSON.stringify(next));
    } catch {
      // storage full / private mode — overlay stays in-memory for the session
    }
  }
  listeners.get(course)?.forEach((fn) => fn());
}

function mutate(course: string, fn: (p: CourseProgress) => CourseProgress) {
  persist(course, fn(load(course)));
}

export function subscribeProgress(course: string, fn: () => void): () => void {
  if (!listeners.has(course)) listeners.set(course, new Set());
  listeners.get(course)!.add(fn);
  return () => listeners.get(course)!.delete(fn);
}

export function getProgressSnapshot(course: string): CourseProgress {
  return load(course);
}

// ── react binding ───────────────────────────────────────────────────────

/** Course slug (the registry key, e.g. "igcse-chemistry"). */
export type Course = string;

/** Stable server snapshot (useSyncExternalStore requires a cached value). */
const serverSnapshot = emptyProgress();

/** Reactive per-course progress snapshot for client components. */
export function useCourseProgress(course: Course): CourseProgress {
  return useSyncExternalStore(
    (cb) => subscribeProgress(course, cb),
    () => getProgressSnapshot(course),
    () => serverSnapshot,
  );
}

// ── multi-course binding (dashboard-scale surfaces) ─────────────────────

const EMPTY_ALL: Record<string, CourseProgress> = {};

/**
 * Combined per-key snapshot cache. Entries are REPLACED wholesale (never
 * mutated) so each snapshot object keeps a stable identity until one of the
 * underlying per-course objects actually changes — the same module-level
 * caching shape useSyncExternalStore requires (cf. my-subjects getSnapshot).
 */
interface MultiEntry {
  last: Record<string, CourseProgress>;
  built: Record<string, CourseProgress>;
}
const multiEntries = new Map<string, MultiEntry>();

function getMultiSnapshot(key: string): Record<string, CourseProgress> {
  const prev = multiEntries.get(key);
  const slugs = key ? key.split(",") : [];
  if (prev && Object.keys(prev.last).length === slugs.length) {
    let unchanged = true;
    for (const c of slugs) {
      if (prev.last[c] !== load(c)) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) return prev.built;
  }
  const last: Record<string, CourseProgress> = {};
  const built: Record<string, CourseProgress> = {};
  for (const c of slugs) {
    last[c] = load(c);
    built[c] = last[c];
  }
  multiEntries.set(key, { last, built });
  return built;
}

/**
 * Reactive progress snapshots for several courses at once (the dashboard
 * needs every "my subjects" course, and hooks cannot be called in a loop of
 * varying length). Same-tab reactivity only, exactly like useCourseProgress.
 */
export function useAllCourseProgress(courses: string[]): Record<string, CourseProgress> {
  const key = courses.join(",");
  const subscribe = useCallback(
    (onChange: () => void) => {
      const slugs = key ? key.split(",") : [];
      const unsubs = slugs.map((c) => subscribeProgress(c, onChange));
      return () => unsubs.forEach((u) => u());
    },
    [key],
  );
  const getSnapshot = useCallback(() => getMultiSnapshot(key), [key]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_ALL);
}

// ── events ──────────────────────────────────────────────────────────────

export function markNoteRead(course: string, noteId: string, subtopic: string | null) {
  mutate(course, (p) =>
    p.notesRead[noteId]
      ? p
      : { ...p, notesRead: { ...p.notesRead, [noteId]: { subtopic, at: Date.now() } } },
  );
}

export function rateNoteHelpful(course: string, noteId: string, helpful: "up" | "down") {
  mutate(course, (p) => {
    const cur = p.notesRead[noteId];
    if (!cur) return p;
    return { ...p, notesRead: { ...p.notesRead, [noteId]: { ...cur, helpful } } };
  });
}

export function recordSelfScore(
  course: string,
  questionId: string,
  topicSlug: string,
  subtopic: string | null,
  score: number,
  max: number,
) {
  mutate(course, (p) => ({
    ...p,
    selfScores: {
      ...p.selfScores,
      [questionId]: { subtopic, topicSlug, score, max, at: Date.now() },
    },
  }));
}

export function recordMcqAnswer(
  course: string,
  questionId: string,
  topicSlug: string,
  subtopic: string | null,
  chosen: string | null,
  correct: boolean,
) {
  mutate(course, (p) => ({
    ...p,
    mcqAnswers: {
      ...p.mcqAnswers,
      [questionId]: { subtopic, topicSlug, chosen, correct, at: Date.now() },
    },
  }));
}

/** Persist the typed answer draft for one question part (SME answer workspace). */
export function saveTypedAnswer(course: string, partId: string, text: string) {
  mutate(course, (p) => {
    const typedAnswers = { ...p.typedAnswers };
    if (text.trim() === "") delete typedAnswers[partId];
    else typedAnswers[partId] = { text, at: Date.now() };
    return { ...p, typedAnswers };
  });
}

export function rateFlashcard(
  course: string,
  cardId: string,
  subtopic: string | null,
  rating: FlashcardRating,
) {
  mutate(course, (p) => {
    const prev = p.flashcards[cardId];
    const at = Date.now();
    // tranche 4.6: append to the bounded trail (newest last) — the local
    // overlay stays the COMPLETE per-device trail the scheduler reads;
    // the core mirror (flashcard-bridge) remains the account-side record
    const trail = [
      ...(prev?.trail ?? []),
      { rating, at },
    ].slice(-TRAIL_CAP);
    return {
      ...p,
      flashcards: { ...p.flashcards, [cardId]: { subtopic, rating, at, trail } },
    };
  });
}

export function toggleSavedQuestion(
  course: string,
  questionId: string,
  topicSlug: string,
  subtopic: string | null,
): boolean {
  const wasSaved = !!load(course).saved[questionId];
  mutate(course, (p) => {
    const saved = { ...p.saved };
    if (saved[questionId]) delete saved[questionId];
    else saved[questionId] = { subtopic, topicSlug, at: Date.now() };
    return { ...p, saved };
  });
  return !wasSaved;
}

// ── ring math ───────────────────────────────────────────────────────────

export interface Ring {
  done: number;
  total: number;
  percent: number; // 0..100
}

/**
 * Engagement coverage of one sub-topic across its available resources — the
 * demo analogue of the SME per-sub-topic ring (research §8). A sub-topic with
 * no resources at all reports total 0 (rendered as an empty ring, "not
 * started", never a fake 100%).
 */
export function subtopicRing(
  p: CourseProgress,
  subtopicCode: string,
  counts: { notes: number; questions: number; flashcards: number },
): Ring {
  const total = counts.notes + counts.questions + counts.flashcards;
  if (total === 0) return { done: 0, total: 0, percent: 0 };
  const notes = Object.values(p.notesRead).filter((v) => v.subtopic === subtopicCode).length;
  const questions =
    Object.values(p.selfScores).filter((v) => v.subtopic === subtopicCode).length +
    Object.values(p.mcqAnswers).filter((v) => v.subtopic === subtopicCode).length;
  const cards = Object.values(p.flashcards).filter((v) => v.subtopic === subtopicCode).length;
  const done = Math.min(notes, counts.notes) + Math.min(questions, counts.questions) + Math.min(cards, counts.flashcards);
  return { done, total, percent: Math.round((done / total) * 100) };
}

/** Ring for a whole topic (averages its sub-topics with resources, like SME). */
export function topicRing(
  p: CourseProgress,
  subtopicCodes: string[],
  countsBySubtopic: Map<string, { notes: number; questions: number; flashcards: number }>,
): Ring {
  const active = subtopicCodes.filter((c) => {
    const k = countsBySubtopic.get(c);
    return (k?.notes ?? 0) + (k?.questions ?? 0) + (k?.flashcards ?? 0) > 0;
  });
  if (active.length === 0) return { done: 0, total: 0, percent: 0 };
  let sum = 0;
  for (const c of active) sum += subtopicRing(p, c, countsBySubtopic.get(c)!).percent;
  return { done: 0, total: active.length, percent: Math.round(sum / active.length) };
}
