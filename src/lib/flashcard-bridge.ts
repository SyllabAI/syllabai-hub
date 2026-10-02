"use client";

/**
 * flashcard-bridge — client half of the flashcard rating evidence class
 * (ADR-029 tranche 4.4). Mirrors the attempt-bridge honesty rules:
 *
 *   - every negative (not a core-sync course / signed out / core down /
 *     unknown anchor) degrades to the local experience — the deck never
 *     blocks, never spins, the rating always lands in the browser-local
 *     overlay;
 *   - ratings go to core ONLY as self-report evidence (append-only trail):
 *     they never touch BKT/SkillState/misconceptions — mastery comes from
 *     marked attempts only (the learner-model honesty rule);
 *   - on success the `syllabai:core-evidence` event fires, so the KG / My
 *     State surfaces re-derive from core promptly.
 *
 * T-C66: the gate is no longer the pilot slug — it is the registry-derived
 * core-sync eligibility predicate (lib/flashcard-sync-eligibility), the
 * SAME predicate the queue hook and the deck player's honesty chip read;
 * today that set is exactly the pilot, so behavior is unchanged — when a
 * newly commissioned course becomes core-anchorable, the manifest flips it
 * on and this side widens with zero code change.
 *
 * No module state: the local overlay (lib/progress.ts) stays the source of
 * truth for rings/queue; this helper is the core-side mirror, best-effort
 * by design. Idempotence is event-level (append-only), not card-level — a
 * re-rate is a new event, exactly what the future review scheduler wants.
 *
 * T-C61 (ADR-034): the outcome is now PERSISTED as a sync receipt on the
 * device trail entry (`sync: "core" | "local"`) — the one fact a true
 * cross-device merge needs, because core stamps `occurred_at` server-side
 * and the same flip cannot be recognized across sides by its timestamp.
 * The receipt is written here (the single choke point every rating flows
 * through), never throws, and is honest history when absent (pre-lane
 * entries). There is deliberately NO retry queue: a failed POST is
 * receipted "local" and stays local-only until the card is re-rated — the
 * recorded boundary; a future sync-repair lane must rewrite receipts.
 */
import { api, getToken } from "./api";
import { isFlashcardSyncCourse } from "./flashcard-sync-eligibility";
import { markFlashcardTrailSync } from "./progress";

export type FlashcardRatingSyncOutcome =
  | { kind: "synced" }
  | { kind: "local-only"; reason: string };

/**
 * Record one rating to the learner's core account when the full preflight
 * passes (a core-sync course + signed in + core reachable), then receipt the
 * device trail entry (`at` — the timestamp `rateFlashcard` returned for
 * this event) with the outcome. Resolves regardless — the caller must
 * never await user-visible consequences from this.
 */
export async function submitFlashcardRating(
  course: string,
  cardId: string,
  rating: "still-learning" | "know",
  subtopicCode: string,
  at?: number,
): Promise<FlashcardRatingSyncOutcome> {
  const outcome = await submitOutcome(course, cardId, rating, subtopicCode);
  if (at !== undefined) {
    // bookkeeping only — must never throw, must never block the caller
    try {
      markFlashcardTrailSync(course, cardId, at, outcome.kind === "synced" ? "core" : "local");
    } catch {
      // receipt lost (storage full / private mode) — the merge degrades
      // conservatively for this entry; the rating itself already landed
    }
  }
  return outcome;
}

async function submitOutcome(
  course: string,
  cardId: string,
  rating: "still-learning" | "know",
  subtopicCode: string,
): Promise<FlashcardRatingSyncOutcome> {
  if (!isFlashcardSyncCourse(course)) {
    return { kind: "local-only", reason: "not a core-sync course" };
  }
  if (!getToken()) {
    return { kind: "local-only", reason: "signed out" };
  }
  try {
    await api.recordFlashcardRating({ cardId, rating, subtopicCode });
    window.dispatchEvent(new CustomEvent("syllabai:core-evidence"));
    return { kind: "synced" };
  } catch (err) {
    // core down / 404 unknown anchor / expired session — the local overlay
    // already holds the rating; core simply stays without this event
    const reason = err instanceof Error ? err.message : "core unavailable";
    return { kind: "local-only", reason };
  }
}
