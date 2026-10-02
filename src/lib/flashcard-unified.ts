"use client";

/**
 * flashcard-unified — the hub consumption lane for the account rating
 * trail (T-C57 + T-C61). The device-local Ebbinghaus queue
 * (lib/flashcard-review.ts, tranche 4.8) sees every rating THIS browser
 * made; the account (core, the append-only V47 trail) sees every rating
 * THE ACCOUNT made. Neither is the whole truth alone — this module builds
 * the one queue the deck badges, the deck player and the My State / KG
 * drawer all read, from the best source available:
 *
 *   1. TRAIL (T-C61, ADR-034) — the bounded raw trail (GET
 *      /api/v1/learners/me/flashcard-rating-trail) walks completely, so
 *      each card's history is the TRUE chronological merge of the account
 *      events and this device's events, each flip exactly once, derived
 *      through the frozen ladder. This is strictly better than rung 2: a
 *      card rated on device A and offline on device B shows BOTH.
 *   2. FEED (T-C57) — the derived schedule feed
 *      (GET /api/v1/learners/me/flashcard-review-schedule): newest-
 *      evidence-wins per card. Preserved VERBATIM as the middle rung —
 *      chosen when the trail endpoint is unavailable (old core) or the
 *      walk cannot complete inside the client's page bound (the feed's
 *      server-side derivation covers the full account trail by
 *      construction, so correctness never depends on the walk finishing).
 *   3. DEVICE — the browser-local derivation alone, exactly what the
 *      queue read before T-C57 (off-pilot / signed out / core down).
 *
 * ── The true-merge rule (rung 1; honest by construction) ────────────────
 * Per card: account events + device entries receipted "local" + device
 * entries with NO receipt ONLY when the account has no events for that
 * card, sorted chronologically, capped at TRAIL_CAP (the frozen ladder
 * cannot overstate an interval beyond its cap, and the device keeps the
 * same window). Core stamps `occurred_at` SERVER-side — the same flip
 * cannot be recognized across sides by its timestamp — so the cross-side
 * identity is the SYNC RECEIPT the bridge persisted when the outcome was
 * known (ADR-034): "core" = the account copy exists (drop the device
 * copy), "local" = the account definitively lacks it (keep). A missing
 * receipt is honest history, not a bug: it might be the account's own
 * copy, so it is kept only where no account events exist to duplicate —
 * the conservative direction (a dropped offline event can only make a
 * card due EARLIER: over-practice, never under-practice).
 *
 * ── Scoping (the bridge gate, mirrored) ─────────────────────────────────
 * The account trail is course-agnostic and its cards carry no course
 * slug; the only course that ever syncs ratings to core is the pilot
 * (lib/flashcard-bridge refuses everything else), so the pilot's queue
 * may consume the account whole. Any other course's queue must not: the
 * hook therefore fetches only on the pilot course, exactly the gate the
 * write side uses. If the bridge gate ever widens, this gate widens with
 * it — widen BOTH or neither.
 *
 * ── Honesty pins (inherited, all preserved) ──────────────────────────────
 *   - self-report drives review TIMING only — never the mastery model
 *     (lib/forgetting.ts stays a separate arithmetic over measured attempts;
 *     the KG exposure/evidence paths in kg-learner-state.ts are untouched);
 *   - every core negative (signed out / core down / old core without the
 *     endpoints) degrades down the rungs — the queue never blocks, never
 *     spins, never invents;
 *   - cards never rated anywhere have no schedule at all;
 *   - nothing is persisted: the trail/feed are read on demand (plus a
 *     refetch when the bridge signals a fresh sync), held in hook state
 *     only (ADR-031 — computed at read, persisted nowhere).
 */
import { useEffect, useState } from "react";
import type { CourseProgress, FlashcardRating, FlashcardTrailSync } from "./progress";
import {
  scheduleCards,
  TRAIL_CAP,
  type CardSchedule,
  type CardReviewSummary,
} from "./flashcard-review";
import { api, getToken } from "./api";
import type {
  FlashcardReviewScheduleCard,
  FlashcardRatingTrailEvent,
} from "./types";
import { PILOT_COURSE_SLUG } from "./attempt-bridge";

/** One card of the core feed, shaped for the union (wire vocabulary as the
 *  hub types it; ISO instants parsed to epoch ms at the merge boundary). */
export type CoreScheduleCard = FlashcardReviewScheduleCard;

/** One raw account rating event (T-C61 wire contract, core ADR-034). */
export type CoreTrailEvent = FlashcardRatingTrailEvent;

/** Which source the queue was built from — the hook resolves the best
 *  available rung; every pure entry point accepts it (or a bare feed card
 *  array, the T-C57 call shape, for direct/feed-mode use). */
export type QueueSource =
  | { mode: "device" } // off-pilot / signed out / both endpoints down
  | { mode: "feed"; cards: readonly CoreScheduleCard[] } // T-C57 rung
  | { mode: "trail"; events: readonly CoreTrailEvent[] }; // T-C61 rung

/** A schedule entry that knows which side's evidence produced it.
 *  "device" — derived here from the browser-local trail; "account" —
 *  account evidence only; "merged" — the card's trail drew from both. */
export type UnifiedCardSchedule = CardSchedule & {
  origin: "device" | "account" | "merged";
};

/** The drawer summary with its honest coverage word (everything the drawer
 *  already rendered, plus what the footnote needs to say the truth).
 *  "device+account-merged" — the T-C61 rung: per-card trails truly merged
 *  (each flip once, offline events included). */
export type UnifiedCardReviewSummary = CardReviewSummary & {
  coverage: "device" | "device+account" | "device+account-merged";
};

const DAY_MS = 86_400_000;

/** ISO-8601 instant → epoch ms (NaN-safe: a malformed instant is ignored —
 *  a feed or trail entry without a parseable timestamp cannot enter the
 *  derivation). */
function epochMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
}

/** Wire rating → hub vocabulary (mirrors the T-C57 feed path: an unknown
 *  wire form reads as "still-learning" — due now, the conservative reading). */
function wireRating(raw: string): FlashcardRating {
  return raw === "know" ? "know" : "still-learning";
}

/**
 * The T-C57 rung, byte-preserved: the device-local schedule unioned with
 * the core feed under newest-evidence-wins (ties → device). `coreCards`
 * null (signed out / core unreachable / off-pilot) degrades to exactly the
 * device-local derivation — the same function the queue read before the
 * account entered the picture, so the off-account behavior cannot drift.
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
    // recompute `due` against the hub's now — the feed was derived at
    // core's read instant, this learner is looking at the hub's
    const dueAt = Number.isFinite(dueAtMs) ? dueAtMs : lastRatedMs;
    unified.set(card.cardId, {
      cardId: card.cardId,
      subtopic: card.subtopicCode,
      rating: wireRating(card.rating),
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

// ── the T-C61 rung: the true cross-device merge ──────────────────────────

/** The device trail of one overlay record with its receipts — mirrors
 *  trailOf's legacy fallback exactly (a pre-4.6 record schedules from its
 *  lone rating); kept local so the receipt field survives typing. */
function deviceEntriesOf(record: {
  rating: FlashcardRating;
  at: number;
  trail?: Array<{ rating: FlashcardRating; at: number; sync?: FlashcardTrailSync }>;
}): Array<{ rating: FlashcardRating; at: number; sync?: FlashcardTrailSync }> {
  if (record.trail && record.trail.length > 0) return record.trail;
  return [{ rating: record.rating, at: record.at }];
}

/**
 * The TRUE cross-device merge (rung 1): per card, the account events plus
 * this device's definitively-unsynced entries, chronologically interleaved,
 * capped at TRAIL_CAP, derived through the frozen ladder. `events` null
 * degrades to exactly the device-local derivation. See the header comment
 * for the receipt rule — the one piece that keeps every flip exactly once.
 */
export function mergeTrailCards(
  flashcards: CourseProgress["flashcards"],
  events: readonly CoreTrailEvent[] | null,
  now: number,
): UnifiedCardSchedule[] {
  // account events per card, chronological asc; malformed instants never
  // enter (they cannot be placed in the history without inventing order)
  const account = new Map<string, Array<{ rating: FlashcardRating; at: number }>>();
  if (events) {
    for (const e of events) {
      const at = epochMs(e.occurredAt);
      if (!Number.isFinite(at)) continue;
      const list = account.get(e.cardId) ?? [];
      list.push({ rating: wireRating(e.rating), at });
      account.set(e.cardId, list);
    }
    for (const list of account.values()) list.sort((a, b) => a.at - b.at);
  }

  const cardIds = new Set<string>([...Object.keys(flashcards), ...account.keys()]);
  const synthetic: CourseProgress["flashcards"] = {};
  const origins = new Map<string, "device" | "account" | "merged">();

  for (const cardId of cardIds) {
    const record = flashcards[cardId];
    const device = record ? deviceEntriesOf(record) : [];
    const acc = account.get(cardId);

    // the receipt rule (header comment): drop what the account provably
    // has, keep what it provably lacks, keep unknowns only where they
    // cannot duplicate (no account events for the card at all)
    const deviceKept = device.filter((entry) => {
      if (entry.sync === "core") return false;
      if (entry.sync === "local") return true;
      return acc === undefined || acc.length === 0;
    });

    const hasAccount = acc !== undefined && acc.length > 0;
    const hasDevice = deviceKept.length > 0;
    if (!hasAccount && !hasDevice) continue;

    const merged = [...(acc ?? []), ...deviceKept]
      // stable, deterministic interleave; an exact-ms tie is a coincidence
      // of two distinct flips — device evidence leads (same tie rule as
      // the T-C57 rung's device-favoring posture)
      .sort((a, b) => a.at - b.at || ("sync" in a ? -1 : 0) - ("sync" in b ? -1 : 0))
      .slice(-TRAIL_CAP); // the frozen ladder's interval cannot overstate beyond the cap — same window the device keeps

    const tail = merged[merged.length - 1];
    origins.set(cardId, hasAccount && hasDevice ? "merged" : hasDevice ? "device" : "account");
    synthetic[cardId] = {
      subtopic: record?.subtopic ?? null,
      rating: tail.rating,
      at: tail.at,
      trail: merged.map((entry) => ({ rating: entry.rating, at: entry.at })),
    };
  }

  // a card the account knows but this browser never touched still needs its
  // deck anchor for the badge rows — take the NEWEST event's anchor (the
  // same word the feed rung serves per card; events arrive newest-first,
  // so the first non-null anchor per card wins)
  if (events) {
    const filled = new Set<string>();
    for (const e of events) {
      const record = synthetic[e.cardId];
      if (record && record.subtopic === null && e.subtopicCode && !filled.has(e.cardId)) {
        synthetic[e.cardId] = { ...record, subtopic: e.subtopicCode };
        filled.add(e.cardId);
      }
    }
  }

  return scheduleCards(synthetic, now).map((card) => ({
    ...card,
    origin: origins.get(card.cardId) ?? "device",
  })).sort(byDueAtThenCardId);
}

/**
 * The one queue entry point: route the source to its rung. A bare feed
 * card array (the T-C57 call shape) routes to the feed rung; null routes
 * device-only. Consumers never branch on the rung themselves.
 */
export function unifiedQueue(
  flashcards: CourseProgress["flashcards"],
  source: QueueSource | readonly CoreScheduleCard[] | null,
  now: number,
): UnifiedCardSchedule[] {
  if (source === null) {
    return unifySchedules(flashcards, null, now);
  }
  if (Array.isArray(source)) {
    return unifySchedules(flashcards, source as readonly CoreScheduleCard[], now);
  }
  const rung = source as QueueSource;
  if (rung.mode === "trail") {
    return mergeTrailCards(flashcards, rung.events, now);
  }
  if (rung.mode === "feed") {
    return unifySchedules(flashcards, rung.cards, now);
  }
  return unifySchedules(flashcards, null, now); // device rung
}

/** Due cards, stalest due date first — mixed origins, one queue. */
export function unifiedDueCards(
  flashcards: CourseProgress["flashcards"],
  source: QueueSource | readonly CoreScheduleCard[] | null,
  now: number,
): UnifiedCardSchedule[] {
  return unifiedQueue(flashcards, source, now).filter((c) => c.due);
}

/** Due count per deck (subtopic anchor) — the index-page chips. */
export function unifiedDueCountBySubtopic(
  flashcards: CourseProgress["flashcards"],
  source: QueueSource | readonly CoreScheduleCard[] | null,
  now: number,
): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const card of unifiedQueue(flashcards, source, now)) {
    if (!card.due) continue;
    counts.set(card.subtopic ?? null, (counts.get(card.subtopic ?? null) ?? 0) + 1);
  }
  return counts;
}

/** Drawer-level summary — the CardReviewSummary shape the drawer already
 *  renders, plus an honest coverage word for the footnote: "device" when
 *  only the browser trail is in play; "device+account" when the feed rung
 *  contributed; "device+account-merged" when the true merge ran (per-card
 *  trails, each flip once). Null when nothing was ever rated anywhere —
 *  the section stays hidden. */
export function unifiedSummarize(
  flashcards: CourseProgress["flashcards"],
  source: QueueSource | readonly CoreScheduleCard[] | null,
  now: number,
): UnifiedCardReviewSummary | null {
  const schedules = unifiedQueue(flashcards, source, now);
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
  let coverage: UnifiedCardReviewSummary["coverage"];
  if (source === null) {
    coverage = "device";
  } else if (Array.isArray(source)) {
    coverage = (source as readonly CoreScheduleCard[]).length > 0 ? "device+account" : "device";
  } else {
    const rung = source as QueueSource;
    if (rung.mode === "trail") {
      coverage = rung.events.length > 0 ? "device+account-merged" : "device";
    } else if (rung.mode === "feed") {
      coverage = rung.cards.length > 0 ? "device+account" : "device";
    } else {
      coverage = "device";
    }
  }
  return {
    due: due.length,
    scheduled,
    nextDueAt,
    decks: [...byDeck.entries()]
      .map(([subtopic, n]) => ({ subtopic, due: n }))
      .sort((a, b) => b.due - a.due || a.subtopic.localeCompare(b.subtopic)),
    coverage,
  };
}

// ── the source hook ──────────────────────────────────────────────────────

/** Lifecycle of the account source inside one mounted surface. */
export type CoreFeedState =
  | "off" // off-pilot or signed out — the account is not part of this queue
  | "loading" // eligible, first resolve in flight
  | "ready" // a rung resolved (trail complete, or the feed rung)
  | "unavailable"; // core unreachable / too old for either endpoint

const isBrowser = typeof window !== "undefined";

/** Client-side bound on the trail walk (pages × 200 events): a learner's
 *  trail is a deck count, not a firehose (V47's scale note), so the walk
 *  normally ends on page 1-2; if it ever outgrows the bound, the hook
 *  falls back to the feed rung — correctness never depends on the walk
 *  finishing (the feed's derivation covers the full account trail). */
const TRAIL_PAGE_LIMIT = 200;
const TRAIL_MAX_PAGES = 25;

/**
 * The account source for the unified queue, fetched only where the write
 * side (lib/flashcard-bridge) would have synced: the pilot course, signed
 * in. Resolves the best rung — the raw trail walk (T-C61) when it
 * completes, else the derived feed (T-C57), else "unavailable". Refetches
 * when the bridge fires `syllabai:core-evidence` (a rating just synced —
 * the account may have moved) and re-checks on course change. Never
 * throws, never blocks a consumer: state lands on "off"/"unavailable" and
 * consumers degrade down the rungs.
 */
export function useCoreReviewSchedule(course: string): {
  source: QueueSource;
  state: CoreFeedState;
} {
  const [source, setSource] = useState<QueueSource>({ mode: "device" });
  const [state, setState] = useState<CoreFeedState>("off");

  useEffect(() => {
    if (!isBrowser || course !== PILOT_COURSE_SLUG || !getToken()) {
      // not the account's surface — drop any state from a prior course.
      // Deferred (deck-player's syncMode dance): effect bodies may not
      // setState synchronously; the defaults are already off/device, so
      // the deferred write is a no-op bail-out on the common first mount.
      void Promise.resolve().then(() => {
        setSource({ mode: "device" });
        setState("off");
      });
      return;
    }
    let cancelled = false;
    const load = () => {
      if (cancelled) return;
      setState((s) => (s === "ready" ? "ready" : "loading"));
      resolveSource()
        .then((resolved) => {
          if (!cancelled) {
            setSource(resolved.source);
            setState(resolved.state);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSource({ mode: "device" });
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

  return { source, state };
}

/** Walk the raw trail newest-first until exhausted (rung 1); on any trail
 *  negative (old core, network) or an outgrown walk bound, fall back to
 *  the derived feed (rung 2); on a feed negative, give up (rung 3). */
async function resolveSource(): Promise<{ source: QueueSource; state: CoreFeedState }> {
  try {
    const events: FlashcardRatingTrailEvent[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < TRAIL_MAX_PAGES; pages++) {
      const page = await api.flashcardRatingTrail({
        limit: TRAIL_PAGE_LIMIT,
        cursor,
      });
      events.push(...page.events);
      if (!page.hasMore) {
        // walk complete — the true merge is fully informed
        return { source: { mode: "trail", events }, state: "ready" };
      }
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break; // defensive: hasMore without a cursor cannot walk
    }
    // the bound was hit — the walk cannot promise completeness; the feed
    // rung is correct by construction (derived from the FULL account trail)
  } catch {
    // trail endpoint unavailable (old core / network) — try the feed
  }
  try {
    const feed = await api.flashcardReviewSchedule();
    return { source: { mode: "feed", cards: feed.cards }, state: "ready" };
  } catch {
    return { source: { mode: "device" }, state: "unavailable" };
  }
}
