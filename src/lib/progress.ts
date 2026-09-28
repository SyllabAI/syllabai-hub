"use client";

import { useSyncExternalStore } from "react";

/**
 * Progress overlay — the demo's honest stand-in for SaveMyExams accounts.
 *
 * Research finding (§8): SME progress = per-sub-topic rings + marks, and
 * writing it needs an account. This demo has no accounts, so ALL progress is
 * a browser-local overlay, namespaced per course, and labelled SIMULATED
 * wherever it is shown. It never writes to canonical content, the learner
 * overlay JSON, or any server — refresh-safe via localStorage only.
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
  flashcards: Record<string, { subtopic: string | null; rating: FlashcardRating; at: number }>;
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
  mutate(course, (p) => ({
    ...p,
    flashcards: { ...p.flashcards, [cardId]: { subtopic, rating, at: Date.now() } },
  }));
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
