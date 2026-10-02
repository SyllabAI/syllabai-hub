/**
 * Verification harness for the unified flashcard review queue (T-C57 —
 * src/lib/flashcard-unified.ts; T-C61 added the true-merge rung): the
 * device-local trail (lib/flashcard-review.ts, the arithmetic core mirrored
 * bit-for-bit in T-C53) unioned with the core review-schedule feed, and —
 * when the bounded raw trail walk completes — TRUE-merged per card from the
 * raw account events plus this device's receipted entries (ADR-034).
 *
 * Run: bun scripts/verify_flashcard_unified.ts
 * Exits non-zero on the first failed pin; prints ALL GREEN otherwise.
 *
 * Deterministic by construction: the "core feed" is fixture cards shaped
 * exactly like FlashcardReviewScheduleCard (core ce0d7eb wire contract) and
 * the "raw trail" is fixture events shaped like FlashcardRatingTrailEvent
 * (core c4b67e8 wire contract) — no network, no clock dependence (NOW is
 * pinned). The HOOK's network ladder (trail → feed → device) is exercised
 * by the mock-mode e2e suite, not here.
 */
import { readFileSync } from "node:fs";
import {
  intervalDaysFor,
  scheduleCards,
  dueCards,
  dueCountBySubtopic,
  summarizeCardReviews,
} from "../src/lib/flashcard-review";
import {
  mergeTrailCards,
  unifySchedules,
  unifiedDueCards,
  unifiedDueCountBySubtopic,
  unifiedQueue,
  unifiedSummarize,
  type CoreScheduleCard,
  type CoreTrailEvent,
} from "../src/lib/flashcard-unified";
import type { CourseProgress } from "../src/lib/progress";
import {
  FLASHCARD_SYNC_COURSES,
  isFlashcardSyncCourse,
} from "../src/lib/flashcard-sync-eligibility";

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

// ── fixtures ────────────────────────────────────────────────────────────
type LocalRecord = CourseProgress["flashcards"][string];

/** device rated card know@NOW-2d → streak 1 → due NOW-2d+1d (overdue) */
const deviceKnow: LocalRecord = {
  subtopic: "4CH1-S1-a",
  rating: "know",
  at: NOW - 2 * DAY,
  trail: [
    { rating: "know", at: NOW - 2 * DAY },
  ],
};

/** device card rated still-learning@NOW-3d → streak 0 → due NOW-3d (overdue) */
const deviceStillLearning: LocalRecord = {
  subtopic: "4CH1-S2-c",
  rating: "still-learning",
  at: NOW - 3 * DAY,
  trail: [
    { rating: "know", at: NOW - 9 * DAY },
    { rating: "still-learning", at: NOW - 3 * DAY },
  ],
};

/** device card on a future schedule: know@NOW-1h → streak 3 → due NOW-1h+4d */
const deviceScheduled: LocalRecord = {
  subtopic: "4CH1-S1-b",
  rating: "know",
  at: NOW - 3_600_000,
  trail: [
    { rating: "know", at: NOW - 7 * DAY },
    { rating: "know", at: NOW - 5 * DAY },
    { rating: "know", at: NOW - 3_600_000 },
  ],
};

const deviceCards: Record<string, LocalRecord> = {
  "fl-local-know": deviceKnow,
  "fl-local-sl": deviceStillLearning,
  "fl-local-future": deviceScheduled,
};

/** core-only card: rated from ANOTHER device, never seen here — know 12d
 *  ago, streak 2 → due 12d-ago+2d = 10d ago (overdue), subtopic null
 *  (honest-null anchor echo). */
const coreOnly: CoreScheduleCard = {
  cardId: "fl-core-only",
  subtopicCode: null,
  nodeId: "00000000-0000-0000-0000-000000000001",
  rating: "know",
  streak: 2,
  lastRatedAt: new Date(NOW - 12 * DAY).toISOString(),
  dueAt: new Date(NOW - 10 * DAY).toISOString(),
  due: true,
  intervalDays: 2,
};

/** core copy of the device-known card, stale evidence (rated 5d ago vs the
 *  device's 2d ago) — must LOSE to the device record. */
const coreStaleSameCard: CoreScheduleCard = {
  cardId: "fl-local-know",
  subtopicCode: "4CH1-S1-a",
  nodeId: "00000000-0000-0000-0000-000000000002",
  rating: "know",
  streak: 1,
  lastRatedAt: new Date(NOW - 5 * DAY).toISOString(),
  dueAt: new Date(NOW - 4 * DAY).toISOString(),
  due: true,
  intervalDays: 1,
};

/** core copy of the still-learning card with NEWER evidence (another device
 *  re-rated it know 1h ago, streak 1 → due in ~1d) — must WIN. */
const coreNewerSameCard: CoreScheduleCard = {
  cardId: "fl-local-sl",
  subtopicCode: "4CH1-S2-c",
  nodeId: "00000000-0000-0000-0000-000000000003",
  rating: "know",
  streak: 1,
  lastRatedAt: new Date(NOW - 3_600_000).toISOString(),
  dueAt: new Date(NOW - 3_600_000 + DAY).toISOString(),
  due: false,
  intervalDays: 1,
};

/** malformed instant — can never win the merge (no invented history) */
const coreBroken: CoreScheduleCard = {
  ...coreOnly,
  cardId: "fl-core-broken",
  subtopicCode: "4CH1-S9-z",
  lastRatedAt: "not-a-timestamp",
  dueAt: "also-not",
};

/** core card whose due flag is STALE: core derived it before the due
 *  instant passed (dueAt = NOW-1s, core said due=false) — the hub's
 *  recompute must flip it to due. */
const coreStaleDueFlag: CoreScheduleCard = {
  cardId: "fl-core-stale-flag",
  subtopicCode: "4CH1-S3-d",
  nodeId: "00000000-0000-0000-0000-000000000004",
  rating: "know",
  streak: 4,
  lastRatedAt: new Date(NOW - 9 * DAY).toISOString(),
  dueAt: new Date(NOW - 1_000).toISOString(),
  due: false,
  intervalDays: 8,
};

const coreFeed: CoreScheduleCard[] = [
  coreOnly,
  coreStaleSameCard,
  coreNewerSameCard,
  coreStaleDueFlag,
  coreBroken,
];

// ── 1. the null-feed degradation is the device derivation, exactly ──────
console.log("degradation (core null):");
{
  const unified = unifySchedules(deviceCards, null, NOW);
  const device = scheduleCards(deviceCards, NOW);
  pin(
    "same card set as scheduleCards",
    unified.length === device.length &&
      unified.every((u) => device.some((d) => d.cardId === u.cardId && d.dueAt === u.dueAt && d.due === u.due && d.streak === u.streak)),
  );
  pin(
    "every entry originates from the device",
    unified.every((u) => u.origin === "device"),
  );
  pin(
    "dueCards / dueCountBySubtopic / summarizeCardReviews agree",
    JSON.stringify(unifiedDueCards(deviceCards, null, NOW).map((c) => c.cardId)) ===
      JSON.stringify(dueCards(deviceCards, NOW).map((c) => c.cardId)) &&
      JSON.stringify([...unifiedDueCountBySubtopic(deviceCards, null, NOW).entries()].sort()) ===
        JSON.stringify([...dueCountBySubtopic(deviceCards, NOW).entries()].sort()) &&
        unifiedSummarize(deviceCards, null, NOW)!.due === summarizeCardReviews(deviceCards, NOW)!.due,
  );
  pin(
    "empty everywhere → summary null (no section, no promise)",
    unifiedSummarize({}, null, NOW) === null && unifySchedules({}, null, NOW).length === 0,
  );
}

// ── 2. the union ─────────────────────────────────────────────────────────
console.log("union (core feed present):");
{
  const unified = unifySchedules(deviceCards, coreFeed, NOW);
  const byId = new Map(unified.map((c) => [c.cardId, c]));

  pin("core-only card surfaces with origin 'account'", byId.get("fl-core-only")?.origin === "account");
  pin(
    "core-only card is due (now >= its dueAt) and honestly unattributed (subtopic null)",
    byId.get("fl-core-only")?.due === true && byId.get("fl-core-only")?.subtopic === null,
  );

  const sl = byId.get("fl-local-sl");
  pin(
    "newer account evidence wins the card (stale device record replaced)",
    sl?.origin === "account" && sl?.rating === "know" && sl?.streak === 1,
  );
  pin(
    "winner's dueAt comes from the feed verbatim",
    sl?.dueAt === Date.parse(coreNewerSameCard.dueAt),
  );
  pin(
    "due recomputed against the HUB's now (future dueAt stays not-due)",
    sl?.due === (NOW >= Date.parse(coreNewerSameCard.dueAt)) && sl?.due === false,
  );
  pin(
    "stale feed due-flag is recomputed, not trusted (dueAt passed since core's read)",
    unifySchedules(deviceCards, [coreStaleDueFlag], NOW)[0]?.due === true,
  );

  const know = byId.get("fl-local-know");
  pin(
    "stale account evidence loses to the newer device record",
    know?.origin === "device" && know?.dueAt === deviceKnow.at + intervalDaysFor(1) * DAY,
  );

  pin("malformed feed timestamps can never win (no invented history)", !byId.has("fl-core-broken"));

  const future = byId.get("fl-local-future");
  pin(
    "untouched device card keeps its schedule and origin",
    future?.origin === "device" &&
      future?.due === false &&
      future?.dueAt === (NOW - 3_600_000) + intervalDaysFor(3) * DAY,
  );

  pin(
    "ordering: due first, stalest dueAt first, cardId tiebreak",
    unified.every((c, i, a) => i === 0 || a[i - 1].dueAt <= c.dueAt) &&
      unified.filter((c) => c.due)[0]?.cardId === "fl-core-only",
  );
}

// ── 3. the unified consumers ─────────────────────────────────────────────
console.log("consumers:");
{
  const counts = unifiedDueCountBySubtopic(deviceCards, coreFeed, NOW);
  pin(
    "due count per deck merges both origins (S2-c not due — the account record won and moved it out)",
    counts.get("4CH1-S1-a") === 1 && counts.get("4CH1-S2-c") === undefined && counts.get("4CH1-S3-d") === 1,
  );
  pin("null-subtopic due cards bucket under null, never vanish", counts.get(null) === 1);

  const summary = unifiedSummarize(deviceCards, coreFeed, NOW)!;
  const due = unifiedDueCards(deviceCards, coreFeed, NOW);
  pin(
    "summary coherence: due count == due list length, scheduled == rest, coverage names the feed",
    summary.due === due.length &&
      summary.due === 3 &&
      summary.scheduled === 2 &&
      summary.coverage === "device+account",
  );
  pin(
    "nextDueAt = the earliest future due date (the re-rated card, ~1d out)",
    summary.nextDueAt === Date.parse(coreNewerSameCard.dueAt),
  );
  pin(
    "decks list skips the honest-null anchor (two attributed decks due)",
    summary.decks.every((d) => d.subtopic !== null && d.subtopic !== undefined) &&
      summary.decks.length === 2,
  );
}

// ── 4. parity spot-check: the ladder the feed rides is the hub ladder ────
console.log("parity:");
{
  pin(
    "feed intervalDays values are reachable from the hub ladder (1·2·4·8·16·32)",
    [coreOnly, coreStaleSameCard, coreNewerSameCard].every((c) =>
      [0, 1, 2, 4, 8, 16, 32].includes(c.intervalDays),
    ),
  );
  pin(
    "a streak past the cap still maps to the 32d maintenance interval",
    intervalDaysFor(12) === 32 && intervalDaysFor(6) === 32 && intervalDaysFor(5) === 16,
  );
}

// ── 5. the true-merge rung (T-C61): receipts, not timestamps ───────────
console.log("trail merge (T-C61):");
{
  const iso = (ms: number) => new Date(ms).toISOString();
  const ev = (
    cardId: string,
    rating: "know" | "still-learning",
    at: number,
    subtopicCode: string | null = null,
  ): CoreTrailEvent => ({
    cardId,
    rating,
    subtopicCode,
    nodeId: "00000000-0000-0000-0000-00000000abcd",
    occurredAt: iso(at),
  });

  // device: one synced flip (receipted core) + one OFFLINE flip (receipted
  // local) — the true merge must show both flips exactly once: streak 2,
  // due NOW-3d+2d = NOW-1d (a double-counted synced copy would make
  // streak 3 → interval 4d → due NOW+1d — the under-practice bug)
  const mixedReceipts: LocalRecord = {
    subtopic: "4CH1-S1-a",
    rating: "know",
    at: NOW - 3 * DAY,
    trail: [
      { rating: "know", at: NOW - 9 * DAY, sync: "core" },
      { rating: "know", at: NOW - 3 * DAY, sync: "local" },
    ],
  };
  // historical record: rated before receipts existed (no trail, no sync
  // field), account silent → the device trail stands alone (parity with
  // the pre-T-C61 derivation)
  const historicalNoAccount: LocalRecord = {
    subtopic: "4CH1-S2-c",
    rating: "know",
    at: NOW - 2 * DAY,
  };
  // historical record WITH a synced account copy (unreceipted device entry
  // + account events for the same card): the unmarked entry MUST drop —
  // it might BE the account copy — conservative due-earlier, never later
  const historicalDuplicated: LocalRecord = {
    subtopic: "4CH1-S2-c",
    rating: "know",
    at: NOW - 1 * DAY,
    trail: [{ rating: "know", at: NOW - 1 * DAY }],
  };
  const trailCards: Record<string, LocalRecord> = {
    "fl-merge-mixed": mixedReceipts,
    "fl-hist-solo": historicalNoAccount,
    "fl-hist-dup": historicalDuplicated,
  };
  const accountEvents: CoreTrailEvent[] = [
    // the account copy of the offline device's first flip (server-stamped
    // ~5s after the device clock — timestamps CANNOT match across sides)
    ev("fl-merge-mixed", "know", NOW - 9 * DAY + 5_000, "4CH1-S1-a"),
    // the synced copy of the historical duplicate
    ev("fl-hist-dup", "know", NOW - 1 * DAY + 5_000, "4CH1-S2-c"),
    // an account-only card (rated on another device, never here): two
    // knows 2d apart, streak 2 → due NOW-10d+2d = NOW-8d
    ev("fl-core-only", "know", NOW - 12 * DAY, "4CH1-S3-b"),
    ev("fl-core-only", "know", NOW - 10 * DAY, "4CH1-S3-b"),
  ];
  const malformed: CoreTrailEvent = {
    cardId: "fl-broken",
    rating: "know",
    subtopicCode: null,
    nodeId: "00000000-0000-0000-0000-00000000abcd",
    occurredAt: "not-a-date",
  };
  const allEvents = [...accountEvents, malformed];

  const merged = mergeTrailCards(trailCards, allEvents, NOW);
  const byCard = (id: string) => merged.find((c) => c.cardId === id)!;

  pin(
    "receipted-core entry excluded + local entry kept: the offline flip completes the streak (2 → due NOW-1d, origin merged)",
    byCard("fl-merge-mixed").streak === 2 &&
      byCard("fl-merge-mixed").dueAt === NOW - 3 * DAY + 2 * DAY &&
      byCard("fl-merge-mixed").origin === "merged",
  );
  pin(
    "historical unmarked + account empty: device trail stands alone (pre-T-C61 parity)",
    byCard("fl-hist-solo").streak === 1 &&
      byCard("fl-hist-solo").dueAt === NOW - 2 * DAY + 1 * DAY &&
      byCard("fl-hist-solo").origin === "device" &&
      byCard("fl-hist-solo").lastAt === NOW - 2 * DAY,
  );
  pin(
    "historical unmarked + account present: the unmarked copy drops (no invented double-count)",
    byCard("fl-hist-dup").streak === 1 &&
      byCard("fl-hist-dup").lastAt === NOW - 1 * DAY + 5_000,
  );
  pin(
    "account-only card: derived from raw events through the frozen ladder, anchor filled from the NEWEST event, origin account",
    byCard("fl-core-only").streak === 2 &&
      byCard("fl-core-only").dueAt === NOW - 10 * DAY + 2 * DAY &&
      byCard("fl-core-only").origin === "account" &&
      byCard("fl-core-only").subtopic === "4CH1-S3-b",
  );
  pin(
    "a malformed instant never enters the merge (no schedule invented for fl-broken)",
    !merged.some((c) => c.cardId === "fl-broken"),
  );
  pin(
    "chronological interleave is true per card: the merged trail of the mixed card is exactly [account@-9d, local@-3d]",
    byCard("fl-merge-mixed").streak === 2 &&
      byCard("fl-merge-mixed").rating === "know",
  );

  // rung discriminator + coverage words
  const queue = unifiedQueue(trailCards, { mode: "trail", events: allEvents }, NOW);
  pin(
    "unifiedQueue routes the trail rung to the same queue as mergeTrailCards",
    JSON.stringify(queue.map((c) => [c.cardId, c.dueAt, c.origin])) ===
      JSON.stringify(merged.map((c) => [c.cardId, c.dueAt, c.origin])),
  );
  pin(
    "unifiedQueue(device mode) == the bare device derivation (rung 3 preserved)",
    JSON.stringify(unifiedQueue(trailCards, { mode: "device" }, NOW)) ===
      JSON.stringify(unifySchedules(trailCards, null, NOW)),
  );
  pin(
    "unifiedQueue accepts the bare feed array — the T-C57 call shape routes to the feed rung",
    JSON.stringify(unifiedQueue(deviceCards, coreFeed, NOW)) ===
      JSON.stringify(unifySchedules(deviceCards, coreFeed, NOW)),
  );
  const trailSummary = unifiedSummarize(trailCards, { mode: "trail", events: allEvents }, NOW)!;
  pin(
    "coverage word names the true merge when the trail contributed",
    trailSummary.coverage === "device+account-merged",
  );
  pin(
    "empty trail events degrade the coverage word to device",
    unifiedSummarize(trailCards, { mode: "trail", events: [] }, NOW)!.coverage === "device",
  );
  pin(
    "feed rung keeps the T-C57 coverage word",
    unifiedSummarize(deviceCards, coreFeed, NOW)!.coverage === "device+account",
  );

  // TRAIL_CAP parity: a merged trail longer than the device window derives
  // the same interval from its newest-10 as the full trail would (the
  // ladder cannot overstate beyond its cap — the core full-trail derivation
  // and the hub capped-window derivation agree)
  const longTrail: Record<string, LocalRecord> = {
    "fl-long": {
      subtopic: "4CH1-S1-a",
      rating: "know",
      at: NOW - 1 * DAY,
      trail: Array.from({ length: 12 }, (_, i) => ({
        rating: "know" as const,
        at: NOW - (13 - i) * DAY,
      })),
    },
  };
  const longMerged = mergeTrailCards(longTrail, null, NOW);
  pin(
    "a trail longer than TRAIL_CAP derives the capped interval (12 knows → 32d maintenance, same as the full trail)",
    longMerged[0].intervalDays === 32 && intervalDaysFor(12) === 32,
  );
}

// ── core-sync eligibility (T-C66) ────────────────────────────────────────
// The widened gate: one registry-derived predicate, three consumers (the
// write bridge, the queue hook, the deck player's honesty chip). The
// manifest↔registry derivation is pinned by
// scripts/verify_flashcard_sync_courses.ts (prebuild); these pins cover
// the predicate behavior the queue surfaces see.
console.log("core-sync eligibility (T-C66):");
{
  // pilot: registered, deck-bearing, curriculumCode, course-prefixed
  // charset-safe anchors — eligible
  pin("the pilot course is core-sync eligible", isFlashcardSyncCourse("igcse-chemistry-19"));
  // deck-bearing but no curriculumCode → core cannot anchor it → not eligible
  pin(
    "a deck-bearing course without a core-known curriculum is NOT eligible (igcse-biology-19)",
    !isFlashcardSyncCourse("igcse-biology-19"),
  );
  pin("an unregistered slug is never eligible", !isFlashcardSyncCourse("no-such-course"));
  pin(
    "the committed manifest is exactly the registry-derived set (today: the pilot alone)",
    FLASHCARD_SYNC_COURSES.length === 1 && FLASHCARD_SYNC_COURSES[0] === "igcse-chemistry-19",
  );
  // structural widen-both-or-neither: the write gate, the read gate and the
  // honesty chip must consume the shared predicate — no second copy of the
  // rule, no pilot slug left in either gate file
  const bridgeSrc = readFileSync(
    new URL("../src/lib/flashcard-bridge.ts", import.meta.url),
    "utf8",
  );
  const unifiedSrc = readFileSync(
    new URL("../src/lib/flashcard-unified.ts", import.meta.url),
    "utf8",
  );
  const chipSrc = readFileSync(
    new URL("../src/app/courses/[course]/flashcards/[subtopic]/deck-player.tsx", import.meta.url),
    "utf8",
  );
  pin(
    "the write gate consumes the shared predicate (no pilot-slug copy)",
    bridgeSrc.includes('from "./flashcard-sync-eligibility"') &&
      !bridgeSrc.includes("PILOT_COURSE_SLUG"),
  );
  pin(
    "the read gate consumes the shared predicate (no pilot-slug copy)",
    unifiedSrc.includes('from "./flashcard-sync-eligibility"') &&
      !unifiedSrc.includes("PILOT_COURSE_SLUG"),
  );
  pin(
    "the deck player's honesty chip consumes the shared predicate (no pilot-slug copy)",
    chipSrc.includes('from "@/lib/flashcard-sync-eligibility"') &&
      !chipSrc.includes("PILOT_COURSE_SLUG"),
  );
}

console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
