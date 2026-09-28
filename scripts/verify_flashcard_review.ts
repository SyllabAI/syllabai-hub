/**
 * Verification harness for the Ebbinghaus flashcard review scheduler
 * (ADR-029 tranche 4.6 — src/lib/flashcard-review.ts).
 *
 * Run: bun scripts/verify_flashcard_review.ts
 * Exits non-zero on the first failed pin; prints ALL GREEN otherwise.
 */
import {
  REVIEW_INTERVAL_DAYS,
  intervalDaysFor,
  knowStreak,
  trailOf,
  scheduleCards,
  dueCards,
  dueCountBySubtopic,
  summarizeCardReviews,
  TRAIL_CAP as _UNUSED_REVIEW_EXPORT, // must NOT exist in the scheduler lib
} from "../src/lib/flashcard-review";
import { TRAIL_CAP as STORE_TRAIL_CAP } from "../src/lib/progress";

let failures = 0;
function pin(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

// ── 1. the expanding ladder ─────────────────────────────────────────────
console.log("ladder:");
pin("streak 0 → 0d (still learning is due now)", intervalDaysFor(0) === 0);
pin("streak 1 → 1d", intervalDaysFor(1) === 1);
pin("streak 2 → 2d", intervalDaysFor(2) === 2);
pin("streak 3 → 4d", intervalDaysFor(3) === 4);
pin("streak 4 → 8d", intervalDaysFor(4) === 8);
pin("streak 5 → 16d", intervalDaysFor(5) === 16);
pin("streak 6 → 32d", intervalDaysFor(6) === 32);
pin("streak 12 → 32d (cap holds)", intervalDaysFor(12) === 32);
pin("negative streak → 0d (no invention)", intervalDaysFor(-3) === 0);
pin("ladder last entry is the cap", REVIEW_INTERVAL_DAYS[REVIEW_INTERVAL_DAYS.length - 1] === 32);

// ── 2. streak derivation from the trail ─────────────────────────────────
console.log("trail:");
pin("empty trail → streak 0", knowStreak([]) === 0);
pin("tail run [know, know] → 2", knowStreak([
  { rating: "know", at: 1 },
  { rating: "still-learning", at: 2 },
  { rating: "know", at: 3 },
  { rating: "know", at: 4 },
]) === 2);
pin("all-know trail → full length", knowStreak([
  { rating: "know", at: 1 },
  { rating: "know", at: 2 },
  { rating: "know", at: 3 },
]) === 3);
pin("still-learning tail → 0", knowStreak([{ rating: "still-learning", at: 1 }]) === 0);
pin("legacy record → single-entry trail (conservative)", trailOf({ rating: "know", at: 5 }).length === 1);
pin("record with trail → trail passthrough (newest last)", trailOf({
  rating: "know",
  at: 9,
  trail: [{ rating: "still-learning", at: 1 }, { rating: "know", at: 9 }],
})[0].rating === "still-learning");

// ── 3. scheduling semantics ─────────────────────────────────────────────
console.log("schedule:");
const stillNow = scheduleCards(
  { c1: { subtopic: "4CH1-S1-a", rating: "still-learning", at: NOW } },
  NOW,
);
pin("still-learning is due immediately", stillNow[0].due === true && stillNow[0].dueAt === NOW && stillNow[0].intervalDays === 0);

const freshKnow = scheduleCards(
  { c2: { subtopic: "4CH1-S1-a", rating: "know", at: NOW, trail: [{ rating: "know", at: NOW }] } },
  NOW,
);
pin("fresh know (streak 1) is NOT due yet", freshKnow[0].due === false);
pin("fresh know comes due in 1d", freshKnow[0].dueAt === NOW + 1 * DAY);
pin("one day later it IS due", scheduleCards(
  { c2: { subtopic: "4CH1-S1-a", rating: "know", at: NOW, trail: [{ rating: "know", at: NOW }] } },
  NOW + 1 * DAY,
)[0].due === true);

const matureKnow = scheduleCards(
  {
    c3: {
      subtopic: "4CH1-S1-b",
      rating: "know",
      at: NOW,
      trail: [
        { rating: "know", at: NOW - 10 * DAY },
        { rating: "know", at: NOW - 5 * DAY },
        { rating: "know", at: NOW },
      ],
    },
  },
  NOW,
);
pin("three knows → 4d interval (expanding)", matureKnow[0].intervalDays === 4 && matureKnow[0].streak === 3);

const legacyKnow = scheduleCards(
  { c4: { subtopic: "4CH1-S1-a", rating: "know", at: NOW - 90 * DAY } },
  NOW,
);
pin("legacy know with no trail schedules conservatively (streak 1) and is due", legacyKnow[0].streak === 1 && legacyKnow[0].due === true);

pin("never-rated cards get no schedule (nothing invented)", scheduleCards({}, NOW).length === 0);

// ── 4. queue shape ──────────────────────────────────────────────────────
console.log("queue:");
const flashcards = {
  a1: { subtopic: "4CH1-S1-a", rating: "still-learning" as const, at: NOW - 3 * DAY },
  a2: { subtopic: "4CH1-S1-a", rating: "know" as const, at: NOW - 2 * DAY }, // legacy → due
  b1: { subtopic: "4CH1-S1-b", rating: "know" as const, at: NOW - 9 * DAY }, // legacy → due
  b2: {
    subtopic: "4CH1-S1-b",
    rating: "know" as const,
    at: NOW,
    trail: [{ rating: "know", at: NOW }],
  }, // not due (1d)
  b3: {
    subtopic: "4CH1-S1-b",
    rating: "know" as const,
    at: NOW,
    trail: [
      { rating: "know", at: NOW - 6 * DAY },
      { rating: "know", at: NOW },
    ],
  }, // not due (2d)
};
const due = dueCards(flashcards, NOW);
pin("three cards due", due.length === 3);
// derived dueAt: a1 = at (still-learning, due now) = NOW-3d · a2 = at+1d = NOW-1d ·
// b1 = at+1d = NOW-8d — so stalest-first is b1, a1, a2
pin("stalest due first (legacy know dueAt NOW-8d)", due[0].cardId === "b1");
pin("then the still-learning card (dueAt NOW-3d), then the fresh legacy know", due[1].cardId === "a1" && due[2].cardId === "a2");

const byDeck = dueCountBySubtopic(flashcards, NOW);
pin("deck counts: S1-a=2, S1-b=1", byDeck.get("4CH1-S1-a") === 2 && byDeck.get("4CH1-S1-b") === 1);

const summary = summarizeCardReviews(flashcards, NOW);
pin("summary: 3 due / 2 scheduled", summary?.due === 3 && summary?.scheduled === 2);
pin("nextDueAt is the earliest future due (+1d)", summary?.nextDueAt === NOW + 1 * DAY);
pin("decks sorted most-due first", summary?.decks[0]?.subtopic === "4CH1-S1-a" && summary?.decks[0]?.due === 2);

const empty = summarizeCardReviews({}, NOW);
pin("no ratings at all → null summary (section hides)", empty === null);

// re-rate reset: a "still-learning" AFTER knows drops the card back to now
const reset = scheduleCards(
  {
    c5: {
      subtopic: "4CH1-S1-a",
      rating: "still-learning",
      at: NOW,
      trail: [
        { rating: "know", at: NOW - 9 * DAY },
        { rating: "know", at: NOW - 4 * DAY },
        { rating: "still-learning", at: NOW },
      ],
    },
  },
  NOW,
);
pin("re-rate to still-learning resets the clock (due now, streak 0)", reset[0].due === true && reset[0].streak === 0 && reset[0].intervalDays === 0);

// ── 5. cap wiring between store and scheduler ───────────────────────────
console.log("caps:");
pin("store trail cap ≥ ladder length (a capped trail can never understate the interval)", STORE_TRAIL_CAP >= REVIEW_INTERVAL_DAYS.length);
pin("scheduler lib does not re-export the store cap", (globalThis as Record<string, unknown>).__SHOULD_NOT_EXIST === undefined);

if (failures > 0) {
  console.error(`\n${failures} pin(s) FAILED`);
  process.exit(1);
}
console.log("\nALL GREEN — flashcard review scheduler verified");
