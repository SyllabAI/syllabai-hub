"use client";

/**
 * flashcard-unified — the hub consumption lane for the core review-schedule
 * feed (T-C57). The device-local Ebbinghaus queue (lib/flashcard-review.ts,
 * tranche 4.8) sees every rating THIS browser made; the core feed (T-C53,
 * GET /api/v1/learners/me/flashcard-review-schedule) sees every rating THE
 * ACCOUNT made. Neither is the whole truth alone — this module unions them
 * into the one queue the deck badges, the deck player and the My State / KG
 * drawer all read.
 *
 * ── The union rule (honest by construction) ─────────────────────────────
 * Per card, the record whose LATEST rating event is newer wins; ties go to
 * the device (it may hold unsynced evidence, and it is the trail the
 * learner's rings are built from). The winner's schedule arithmetic is used
 * verbatim: the device side derives through lib/flashcard-review.ts (the
 * ladder the core mirrored bit-for-bit — registry `learner.flashcard-review`
 * v1-hub-parity), the account side takes the core feed's derived card as-is.
 * `due` is recomputed against the hub's now, because the feed was derived at
 * core's read instant and the learner is looking at the hub's.
 *
 * No trail cross-merge is attempted: the feed serves derived schedules, not
 * raw events, and merging two derived schedules would invent history. The
 * known limit — a card rated on two devices follows its newest evidence, not
 * a super-trail — is the honest default (widening core to serve bounded raw
 * events is a recorded next_safe_action, a core contract change).
 *
 * ── Scoping (the bridge gate, mirrored) ─────────────────────────────────
 * The feed is account-level and its cards carry no course slug; the only
 * course that ever syncs ratings to core is the pilot (lib/flashcard-bridge
 * refuses everything else), so the pilot's queue may consume the feed whole.
 * Any other course's queue must not: the hook therefore fetches only on the
 * pilot course, exactly the gate the write side uses. If the bridge gate
 * ever widens, this gate widens with it — widen BOTH or neither.
 *
 * ── Honesty pins (inherited, all preserved) ──────────────────────────────
 *   - self-report drives review TIMING only — never the mastery model
 *     (lib/forgetting.ts stays a separate arithmetic over measured attempts;
 *     the KG exposure/evidence paths in kg-learner-state.ts are untouched);
 *   - every core negative (signed out / core down / old core without the
 *     feed) degrades to the device-local queue — the union never blocks,
 *     never spins, never invents;
 *   - cards never rated anywhere have no schedule at all;
 *   - nothing is persisted: the feed is read on demand (plus a refetch when
 *     the bridge signals a fresh sync), held in hook state only (ADR-031).
 */
import { useEffect, useState } from "react";
import type { CourseProgress, FlashcardRating } from "./progress";
import { scheduleCards, type CardSchedule, type CardReviewSummary } from "./flashcard-review";
import { api, getToken } from "./api";
import type { FlashcardReviewScheduleCard } from "./types";
import { PILOT_COURSE_SLUG } from "./attempt-bridge";

/** One card of the core feed, shaped for the union (wire vocabulary as the
 *  hub types it; ISO instants parsed to epoch ms at the merge boundary). */
export type CoreScheduleCard = FlashcardReviewScheduleCard;

/** A schedule entry that knows which side's evidence produced it. */
export type UnifiedCardSchedule = CardSchedule & {
  /** "device" — derived here from the browser-local trail;
   *  "account" — taken verbatim from the core feed. */
  origin: "device" | "account";
};

/** The drawer summary with its honest coverage word (everything the drawer
 *  already rendered, plus what the footnote needs to say the truth). */
export type UnifiedCardReviewSummary = CardReviewSummary & {
  coverage: "device" | "device+account";
};

const DAY_MS = 86_400_000;

/** ISO-8601 instant → epoch ms (NaN-safe: a malformed instant is ignored —
 *  a feed entry without a parseable timestamp cannot win the merge). */
function epochMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
}

/**
 * The unified queue: the device-local schedule unioned with the core feed.
 * `coreCards` null (signed out / core unreachable / off-pilot) degrades to
 * exactly the device-local derivation — the same function the queue read
 * before this lane existed, so the off-account behavior cannot drift.
 */
export function unifySchedules(
  flashcards: CourseProgress["flashcards"],
  coreCards: readonly CoreScheduleCard[] | null,
  now: number,
): UnifiedCardSchedule[] {
  const device = new Map<string, UnifiedCardSchedule>();
  for (const card of scheduleCards(flashcards, now)) {
    device.set(card.cardId, { ...card, origin: "device" });
  }
  if (!coreCards || coreCards.length === 0) {
    return [...device.values()].sort(byDueAtThenCardId);
  }

  // account side: a core card wins only when its latest evidence is newer
  // than the device's (ties → device). Malformed timestamps never win.
  const unified = device;
  for (const card of coreCards) {
    const lastRatedMs = epochMs(card.lastRatedAt);
    if (!Number.isFinite(lastRatedMs)) continue;
    const local = unified.get(card.cardId);
    if (local && local.lastAt >= lastRatedMs) continue;

    const dueAtMs = epochMs(card.dueAt);
    const rating = card.rating === "know" ? "know" : "still-learning";
    // recompute `due` against the hub's now — the feed was derived at
    // core's read instant, this learner is looking at the hub's
    const dueAt = Number.isFinite(dueAtMs) ? dueAtMs : lastRatedMs;
    unified.set(card.cardId, {
      cardId: card.cardId,
      subtopic: card.subtopicCode,
      rating: rating satisfies FlashcardRating,
      streak: card.streak,
      lastAt: lastRatedMs,
      dueAt,
      due: now >= dueAt,
      intervalDays: card.intervalDays,
      origin: "account",
    });
  }
  return [...unified.values()].sort(byDueAtThenCardId);
}

function byDueAtThenCardId(a: UnifiedCardSchedule, b: UnifiedCardSchedule): number {
  return a.dueAt - b.dueAt || a.cardId.localeCompare(b.cardId);
}

/** Due cards, stalest due date first — mixed origins, one queue. */
export function unifiedDueCards(
  flashcards: CourseProgress["flashcards"],
  coreCards: readonly CoreScheduleCard[] | null,
  now: number,
): UnifiedCardSchedule[] {
  return unifySchedules(flashcards, coreCards, now).filter((c) => c.due);
}

/** Due count per deck (subtopic anchor) — the index-page chips. */
export function unifiedDueCountBySubtopic(
  flashcards: CourseProgress["flashcards"],
  coreCards: readonly CoreScheduleCard[] | null,
  now: number,
): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const card of unifySchedules(flashcards, coreCards, now)) {
    if (!card.due) continue;
    counts.set(card.subtopic ?? null, (counts.get(card.subtopic ?? null) ?? 0) + 1);
  }
  return counts;
}

/** Drawer-level summary — the CardReviewSummary shape the drawer already
 *  renders, plus an honest coverage word for the footnote: "device" when
 *  only the browser trail is in play, "device+account" when the core feed
 *  contributed (the pilot + signed in + core reachable case). Null when
 *  nothing was ever rated anywhere — the section stays hidden. */
export function unifiedSummarize(
  flashcards: CourseProgress["flashcards"],
  coreCards: readonly CoreScheduleCard[] | null,
  now: number,
): UnifiedCardReviewSummary | null {
  const schedules = unifySchedules(flashcards, coreCards, now);
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
    coverage: coreCards && coreCards.length > 0 ? "device+account" : "device",
  };
}

// ── the feed hook ────────────────────────────────────────────────────────

/** Lifecycle of the account feed inside one mounted surface. */
export type CoreFeedState =
  | "off" // off-pilot or signed out — the feed is not part of this queue
  | "loading" // eligible, first fetch in flight
  | "ready" // feed resolved (possibly empty — nothing synced yet)
  | "unavailable"; // core unreachable / too old for the feed — device-only

const isBrowser = typeof window !== "undefined";

/**
 * The core feed for the unified queue, fetched only where the write side
 * (lib/flashcard-bridge) would have synced: the pilot course, signed in.
 * Refetches when the bridge fires `syllabai:core-evidence` (a rating just
 * synced — the account queue may have moved) and re-checks on course change.
 * Never throws, never blocks a consumer: state lands on "off" or
 * "unavailable" and consumers degrade to the device-local queue.
 */
export function useCoreReviewSchedule(course: string): {
  cards: CoreScheduleCard[] | null;
  state: CoreFeedState;
} {
  const [cards, setCards] = useState<CoreScheduleCard[] | null>(null);
  const [state, setState] = useState<CoreFeedState>("off");

  useEffect(() => {
    if (!isBrowser || course !== PILOT_COURSE_SLUG || !getToken()) {
      // not the feed's surface — drop any feed state from a prior course.
      // Deferred (deck-player's syncMode dance): effect bodies may not
      // setState synchronously; the defaults are already off/null, so the
      // deferred write is a no-op bail-out on the common first mount.
      void Promise.resolve().then(() => {
        setCards(null);
        setState("off");
      });
      return;
    }
    let cancelled = false;
    const load = () => {
      if (cancelled) return;
      setState((s) => (s === "ready" ? "ready" : "loading"));
      api
        .flashcardReviewSchedule()
        .then((feed) => {
          if (!cancelled) {
            setCards(feed.cards);
            setState("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCards(null);
            setState("unavailable");
          }
        });
    };
    void Promise.resolve().then(load);
    // the bridge dispatches this after every successful sync
    const onEvidence = () => load();
    window.addEventListener("syllabai:core-evidence", onEvidence);
    return () => {
      cancelled = true;
      window.removeEventListener("syllabai:core-evidence", onEvidence);
    };
  }, [course]);

  return { cards, state };
}
