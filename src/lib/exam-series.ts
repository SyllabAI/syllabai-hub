"use client";

/**
 * Exam-series calendar + targets (T-C79, ADR-035 D1 ruling 2026-10-04):
 * the client side of the IMPORTED reference calendar and the learner's one
 * bounded, optional target-series declaration per enrolled course.
 *
 * Honesty posture (mirrors the account-strip / course-stats pattern):
 *  - signed out → no surface at all (the declaration is account data);
 *  - a core older than V62 (404s) or any failure → `null`, the chip and
 *    the picker vanish without a word — never a fake list, never a dead
 *    control;
 *  - an EMPTY calendar (nothing imported yet, or nothing published for
 *    this qualification) → the honest disabled state with a hint, never a
 *    placeholder row;
 *  - estimated rows render with "≈" (announced but not timetabled) —
 *    provenance (CORE_MEASURED, Pearson key-dates document) rides every
 *    row as sourceUrl + retrievedAt.
 *
 * Countdowns are core-derived at read (ADR-031: recomputed, never stored);
 * this module only presents them. Refreshes on the core-evidence event so
 * a declaration made in the add-course overlay updates every open card.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, getToken } from "@/lib/api";
import type { CourseExamTargetView, ExamSeriesView } from "@/lib/types";

export const EXAM_TARGETS_EVENT = "syllabai:exam-targets-changed";

/**
 * The hub registry level ("IGCSE" | "IAL", content/courses.json) → the
 * core calendar's qualification vocabulary. Both registries are Edexcel
 * lanes only (the overlay's own honest constant).
 */
export function qualForLevel(level: string): string {
  return level === "IAL" ? "IAL" : "INTERNATIONAL_GCSE";
}

// the targets store (the my-subjects pattern: module cache +
// useSyncExternalStore — no setState-in-effect cascades)
let targetsCache: Map<string, CourseExamTargetView> | null = null;
let targetsFetch: Promise<void> | null = null;

function loadTargets(): Promise<void> {
  if (targetsFetch) return targetsFetch;
  targetsFetch = (async () => {
    if (!getToken()) {
      targetsCache = null;
      return;
    }
    try {
      const agenda = await api.learnerAgenda();
      targetsCache = new Map((agenda.examTargets ?? []).map((t) => [t.courseSlug, t]));
    } catch {
      // core behind the contract or down — no chip, no word
      targetsCache = null;
    }
  })().finally(() => {
    targetsFetch = null;
    window.dispatchEvent(new CustomEvent(EXAM_TARGETS_EVENT));
  });
  return targetsFetch;
}

function subscribeTargets(onChange: () => void) {
  // first subscriber kicks the read; later events re-read
  void loadTargets();
  const events = [EXAM_TARGETS_EVENT, "syllabai:core-evidence", "storage"] as const;
  for (const e of events) window.addEventListener(e, onChange);
  return () => {
    for (const e of events) window.removeEventListener(e, onChange);
  };
}

function getTargetsSnapshot(): Map<string, CourseExamTargetView> | null {
  return targetsCache;
}

function getTargetsServerSnapshot(): Map<string, CourseExamTargetView> | null {
  return null;
}

/**
 * The learner's declared targets, keyed by course slug. null = unavailable
 * (signed out / core behind the contract / down) — callers render nothing.
 * A map that simply lacks a slug = no declaration for that course: the
 * honest "add your exam series" state.
 */
export function useExamTargets(): Map<string, CourseExamTargetView> | null {
  return useSyncExternalStore(subscribeTargets, getTargetsSnapshot, getTargetsServerSnapshot);
}

/** fire the refresh so every mounted card re-reads its target */
export function notifyExamTargetsChanged() {
  void loadTargets();
}

/**
 * The published calendar for one qualification. null = unavailable
 * (signed out / core behind the contract); [] = honestly empty — nothing
 * imported yet. The picker renders a disabled hint on [], never a row.
 * One fetch per qualification per page load (module cache) — every card
 * and the add-course overlay share it.
 */
const calendarPromises = new Map<string, Promise<ExamSeriesView[] | null>>();

export function fetchExamCalendar(qualification: string): Promise<ExamSeriesView[] | null> {
  if (!getToken()) return Promise.resolve(null);
  let cached = calendarPromises.get(qualification);
  if (!cached) {
    cached = api
      .learnerExamSeries(qualification)
      .catch(() => null); // core behind the contract or down — no picker, no word
    calendarPromises.set(qualification, cached);
  }
  return cached;
}

export function useExamCalendar(qualification: string): ExamSeriesView[] | null {
  const [calendar, setCalendar] = useState<ExamSeriesView[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchExamCalendar(qualification).then((rows) => alive && setCalendar(rows));
    return () => {
      alive = false;
    };
  }, [qualification]);

  return calendar;
}

/** presentation helper: the chip's countdown text (day granularity, "≈" for estimated) */
export function countdownText(target: CourseExamTargetView): string {
  const mark = target.estimated ? "≈" : "";
  if (target.daysToWindowStart > 0) {
    return `${mark}${target.label}: exams in ${target.daysToWindowStart} day${target.daysToWindowStart === 1 ? "" : "s"}`;
  }
  if (target.daysToWindowEnd >= 0) {
    return `${mark}${target.label}: exams running now`;
  }
  return `${mark}${target.label}: exams finished`;
}
