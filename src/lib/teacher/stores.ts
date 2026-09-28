"use client";

/**
 * Teacher-side client stores (TEACHER-2) — versioned localStorage, same
 * pattern family as my-subjects.ts / identity.ts.
 *
 *   syllabai.teachingCoverage.v1 — per-course teaching-coverage overlay
 *     { [courseSlug]: string[] } (taught subtopic codes). TEACHER_ARCHITECTURE
 *     §13.4: coverage is a TEACHER-side overlay, semantically separate from
 *     learner mastery — NOT_TAUGHT means "no coverage recorded", never "weak".
 *
 *   syllabai.savedTests.v1 — Test Builder saves (SME reference: reuse/edit):
 *     { id, name, course, subtopics, targetMarks, maxQuestions, createdAt }
 */

import { useCallback, useSyncExternalStore } from "react";

// ── teaching coverage ─────────────────────────────────────────────────────

const COVERAGE_KEY = "syllabai.teachingCoverage.v1";
const COVERAGE_EVENT = "syllabai:teaching-coverage-changed";

type CoverageMap = Record<string, string[]>;

function readCoverage(): CoverageMap {
  try {
    const raw = window.localStorage.getItem(COVERAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CoverageMap;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: CoverageMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
    }
    return out;
  } catch {
    return {};
  }
}

let coverageSnapshot: CoverageMap = {};
const EMPTY_COVERAGE: string[] = [];

function coverageSnapshotGet(): CoverageMap {
  const next = readCoverage();
  const nextKeys = Object.keys(next);
  const curKeys = Object.keys(coverageSnapshot);
  const same =
    nextKeys.length === curKeys.length &&
    nextKeys.every((k) => {
      const a = next[k];
      const b = coverageSnapshot[k] ?? [];
      return a.length === b.length && a.every((x, i) => x === b[i]);
    });
  if (!same) coverageSnapshot = next;
  return coverageSnapshot;
}

/** Referentially stable per-course list (useSyncExternalStore requires caching). */
function coverageFor(course: string): string[] {
  return coverageSnapshotGet()[course] ?? EMPTY_COVERAGE;
}

function writeCoverage(map: CoverageMap) {
  try {
    window.localStorage.setItem(COVERAGE_KEY, JSON.stringify(map));
  } catch {
    // private mode — coverage just won't persist
  }
  window.dispatchEvent(new CustomEvent(COVERAGE_EVENT));
}

export function useTeachingCoverage(course: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      window.addEventListener(COVERAGE_EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(COVERAGE_EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    [],
  );
  const getSnapshot = useCallback(() => coverageFor(course), [course]);
  const getServerSnapshot = useCallback(() => EMPTY_COVERAGE, []);

  const taught = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(
    (code: string) => {
      const map = readCoverage();
      const cur = new Set(map[course] ?? []);
      if (cur.has(code)) cur.delete(code);
      else cur.add(code);
      map[course] = [...cur].sort();
      writeCoverage(map);
    },
    [course],
  );

  return { taught: new Set(taught), toggle };
}

// ── saved tests ───────────────────────────────────────────────────────────

export interface SavedTest {
  id: string;
  name: string;
  course: string;
  courseCode: string;
  subtopics: string[];
  targetMarks: number | null;
  maxQuestions: number | null;
  /** Explicit question list (builder-era saves). Legacy saves omit it —
   *  they only kept the auto-build controls and must be re-generated. */
  questionIds?: string[];
  createdAt: string;
}

const TESTS_KEY = "syllabai.savedTests.v1";
const TESTS_EVENT = "syllabai:saved-tests-changed";
const TESTS_EMPTY: SavedTest[] = [];

function readTests(): SavedTest[] {
  try {
    const raw = window.localStorage.getItem(TESTS_KEY);
    if (!raw) return TESTS_EMPTY;
    const parsed = JSON.parse(raw) as SavedTest[];
    if (!Array.isArray(parsed)) return TESTS_EMPTY;
    return parsed.filter(
      (t) => t && typeof t.id === "string" && Array.isArray(t.subtopics),
    );
  } catch {
    return TESTS_EMPTY;
  }
}

let testsSnapshot: SavedTest[] = TESTS_EMPTY;

function testsSnapshotGet(): SavedTest[] {
  const next = readTests();
  if (next.length !== testsSnapshot.length || next.some((t, i) => t.id !== testsSnapshot[i]?.id)) {
    testsSnapshot = next;
  }
  return testsSnapshot;
}

function writeTests(tests: SavedTest[]) {
  try {
    window.localStorage.setItem(TESTS_KEY, JSON.stringify(tests));
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(TESTS_EVENT));
}

export function useSavedTests() {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener(TESTS_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(TESTS_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const tests = useSyncExternalStore(subscribe, testsSnapshotGet, () => TESTS_EMPTY);

  const save = useCallback(
    (t: Omit<SavedTest, "id" | "createdAt">): SavedTest => {
      const saved: SavedTest = {
        ...t,
        id: `t_${Date.now().toString(36)}`,
        createdAt: new Date().toISOString(),
      };
      writeTests([saved, ...testsSnapshotGet()].slice(0, 30));
      return saved;
    },
    [],
  );

  const remove = useCallback((id: string) => {
    writeTests(testsSnapshotGet().filter((t) => t.id !== id));
  }, []);

  return { tests, save, remove };
}

// ── content reviews (Phase 2 validation queue, demo-truth) ────────────────
//
// syllabai.contentReviews.v1 — teacher verdicts on AI-authored content
// (TEACHER_MODE_PLAN §4 ContentReview: resourceId, reviewer, verdict,
// comment, createdAt). The pilot pipeline marks AI-authored model solutions
// for teacher validation before they count; the queue demonstrates that step
// on REAL corpus items, verdicts persist locally until the write path exists.

export type ReviewVerdict = "approved" | "edited" | "rejected";

export interface ContentReview {
  resourceId: string;
  courseId: string;
  courseCode: string;
  kind: "solution" | "note" | "flashcard";
  verdict: ReviewVerdict;
  comment: string;
  reviewer: string;
  createdAt: string;
}

const REVIEWS_KEY = "syllabai.contentReviews.v1";
const REVIEWS_EVENT = "syllabai:content-reviews-changed";
const REVIEWS_EMPTY: ContentReview[] = [];

function readReviews(): ContentReview[] {
  try {
    const raw = window.localStorage.getItem(REVIEWS_KEY);
    if (!raw) return REVIEWS_EMPTY;
    const parsed = JSON.parse(raw) as ContentReview[];
    if (!Array.isArray(parsed)) return REVIEWS_EMPTY;
    return parsed.filter(
      (r) =>
        r &&
        typeof r.resourceId === "string" &&
        (r.verdict === "approved" || r.verdict === "edited" || r.verdict === "rejected"),
    );
  } catch {
    return REVIEWS_EMPTY;
  }
}

let reviewsSnapshot: ContentReview[] = REVIEWS_EMPTY;

function reviewsSnapshotGet(): ContentReview[] {
  const next = readReviews();
  if (
    next.length !== reviewsSnapshot.length ||
    next.some((r, i) => r.resourceId !== reviewsSnapshot[i]?.resourceId)
  ) {
    reviewsSnapshot = next;
  }
  return reviewsSnapshot;
}

function writeReviews(list: ContentReview[]) {
  try {
    window.localStorage.setItem(REVIEWS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(REVIEWS_EVENT));
}

export function useContentReviews() {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener(REVIEWS_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(REVIEWS_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const reviews = useSyncExternalStore(subscribe, reviewsSnapshotGet, () => REVIEWS_EMPTY);

  const add = useCallback(
    (input: Omit<ContentReview, "createdAt">): ContentReview => {
      // one verdict per resource — a re-review supersedes the previous one
      const review: ContentReview = { ...input, createdAt: new Date().toISOString() };
      writeReviews([
        review,
        ...reviewsSnapshotGet().filter((r) => r.resourceId !== review.resourceId),
      ].slice(0, 200));
      return review;
    },
    [],
  );

  const remove = useCallback((resourceId: string) => {
    writeReviews(reviewsSnapshotGet().filter((r) => r.resourceId !== resourceId));
  }, []);

  return { reviews, add, remove };
}
