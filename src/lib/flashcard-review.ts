"use client";

/**
 * Flashcard review scheduling — the Ebbinghaus queue over the rating trail
 * (ADR-029 tranche 4.6). The consumer the ratings evidence class was built
 * for: every Still learning / Know rating lands in the browser-local overlay
 * (lib/progress.ts), and this module turns that trail into a "due for
 * review" schedule.
 *
 * The model — expanding spacing on binary self-report, the classic Ebbinghaus
 * ladder with plainly-commented demo parameters:
 *
 *   - "still learning"  → due immediately (you said you haven't got it yet)
 *   - "know" streak n   → resurface after REVIEW_INTERVAL_DAYS[n-1] days
 *                         (1, 2, 4, 8, 16, then a capped 32-day maintenance
 *                         cycle — mature cards keep a slow heartbeat)
 *
 * A re-rate resets the clock: rating "know" again extends the interval,
 * rating "still learning" drops the card back to due-now. This is the same
 * append-only trail the core account mirrors (lib/flashcard-bridge.ts) —
 * but the SCHEDULE is derived from the device-local overlay, which holds
 * every rating this browser ever made (core serves the latest 50 events for
 * the learner model, not a scheduling feed).
 *
 * Honesty rules (the tranche-4.5 pin carries over):
 *   - self-report evidence drives REVIEW SCHEDULING only — it never touches
 *     the mastery model (lib/forgetting.ts operates on measured attempts and
 *     stays a separate arithmetic; a rated card can appear here while its
 *     spec points stay "Not measured" in My State);
 *   - unknown history is derived conservatively: a legacy "know" record with
 *     no trail counts as streak 1 (shortest interval — the card resurfaces
 *     sooner rather than never);
 *   - nothing is invented: cards never rated have no schedule at all (the
 *     deck presents them as new, the queue ignores them).
 */
import type { CourseProgress, FlashcardRating } from "./progress";

/** Expanding intervals (days) by consecutive-"know" streak — the classic
 *  Ebbinghaus spacing ladder, capped at a 32-day maintenance cycle. */
export const REVIEW_INTERVAL_DAYS = [1, 2, 4, 8, 16, 32] as const;

/** Trail length kept per card — ≥ the ladder length, so a capped trail can
 *  never understate the interval (streak ≥ 6 all map to the 32d cap). */
export const TRAIL_CAP = 10;

const DAY_MS = 86_400_000;

/** Interval (days) before the next review, given a consecutive-"know" streak.
 *  streak 0 ("still learning") → 0 (due immediately). */
export function intervalDaysFor(streak: number): number {
  if (streak <= 0) return 0;
  return REVIEW_INTERVAL_DAYS[Math.min(streak - 1, REVIEW_INTERVAL_DAYS.length - 1)];
}

/** One recorded rating (the local overlay's bounded per-card trail). */
export interface TrailEntry {
  rating: FlashcardRating;
  at: number;
}

/** Consecutive "know" ratings at the tail of the trail (newest last).
 *  A "still learning" tail means streak 0 — the card is due now. */
export function knowStreak(trail: readonly TrailEntry[]): number {
  let streak = 0;
  for (let i = trail.length - 1; i >= 0; i--) {
    if (trail[i].rating !== "know") break;
    streak += 1;
  }
  return streak;
}

/** The full rating trail of one overlay record — the bounded `trail` when
 *  present, else the legacy single record derived conservatively (a lone
 *  "know" is streak 1: shortest interval, the honest default for unknown
 *  history). Newest last, matching the append order. */
export function trailOf(record: {
  rating: FlashcardRating;
  at: number;
  trail?: Array<{ rating: FlashcardRating; at: number }>;
}): TrailEntry[] {
  if (record.trail && record.trail.length > 0) return record.trail;
  return [{ rating: record.rating, at: record.at }];
}

/** The review schedule of one rated card. */
export interface CardSchedule {
  cardId: string;
  subtopic: string | null;
  /** latest rating (the trail tail) */
  rating: FlashcardRating;
  /** consecutive "know" ratings since the last "still learning" */
  streak: number;
  /** when the latest rating was recorded */
  lastAt: number;
  /** when the card came (or comes) due for its next review */
  dueAt: number;
  /** whether the card is due at `now` */
  due: boolean;
  /** days between this rating and the next review (0 = due immediately) */
  intervalDays: number;
}

/** Schedule every rated card in the overlay record (cards never rated are
 *  absent — no schedule is invented for them). */
export function scheduleCards(
  flashcards: CourseProgress["flashcards"],
  now: number,
): CardSchedule[] {
  const out: CardSchedule[] = [];
  for (const [cardId, record] of Object.entries(flashcards)) {
    const trail = trailOf(record);
    if (trail.length === 0) continue;
    const latest = trail[trail.length - 1];
    const streak = knowStreak(trail);
    const intervalDays = intervalDaysFor(streak);
    const dueAt = latest.at + intervalDays * DAY_MS;
    out.push({
      cardId,
      subtopic: record.subtopic,
      rating: latest.rating,
      streak,
      lastAt: latest.at,
      dueAt,
      due: now >= dueAt,
      intervalDays,
    });
  }
  return out;
}

/** Due cards, stalest due date first — the order a learner should work them. */
export function dueCards(flashcards: CourseProgress["flashcards"], now: number): CardSchedule[] {
  return scheduleCards(flashcards, now)
    .filter((c) => c.due)
    .sort((a, b) => a.dueAt - b.dueAt || a.cardId.localeCompare(b.cardId));
}

/** Due count per deck (subtopic anchor) — the index-page chips. Cards with
 *  a null subtopic bucket under null and are never shown as a deck. */
export function dueCountBySubtopic(
  flashcards: CourseProgress["flashcards"],
  now: number,
): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const card of scheduleCards(flashcards, now)) {
    if (!card.due) continue;
    counts.set(card.subtopic ?? null, (counts.get(card.subtopic ?? null) ?? 0) + 1);
  }
  return counts;
}

/** Drawer-level summary: what My State / the KG drawer show. */
export interface CardReviewSummary {
  /** cards due for review right now */
  due: number;
  /** rated cards on a future schedule (not due yet) */
  scheduled: number;
  /** earliest future due date — null when nothing is scheduled */
  nextDueAt: number | null;
  /** per-deck rows with at least one due card, most due first */
  decks: Array<{ subtopic: string; due: number }>;
}

/** Summarize the queue for the drawer (null when nothing was ever rated —
 *  the section stays hidden rather than showing an empty promise). */
export function summarizeCardReviews(
  flashcards: CourseProgress["flashcards"],
  now: number,
): CardReviewSummary | null {
  const schedules = scheduleCards(flashcards, now);
  if (schedules.length === 0) return null;
  const due = schedules.filter((c) => c.due);
  const scheduled = schedules.length - due.length;
  const nextDueAt =
    scheduled > 0
      ? schedules
          .filter((c) => !c.due)
          .reduce((min, c) => Math.min(min, c.dueAt), Number.POSITIVE_INFINITY)
      : null;
  const byDeck = new Map<string, number>();
  for (const card of due) {
    if (!card.subtopic) continue;
    byDeck.set(card.subtopic, (byDeck.get(card.subtopic) ?? 0) + 1);
  }
  return {
    due: due.length,
    scheduled,
    nextDueAt,
    decks: [...byDeck.entries()]
      .map(([subtopic, n]) => ({ subtopic, due: n }))
      .sort((a, b) => b.due - a.due || a.subtopic.localeCompare(b.subtopic)),
  };
}
