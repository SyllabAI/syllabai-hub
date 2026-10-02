/**
 * Verification harness for the unified flashcard review queue (T-C57 —
 * src/lib/flashcard-unified.ts): the device-local trail (lib/flashcard-
 * review.ts, the arithmetic core mirrored bit-for-bit in T-C53) unioned
 * with the core review-schedule feed.
 *
 * Run: bun scripts/verify_flashcard_unified.ts
 * Exits non-zero on the first failed pin; prints ALL GREEN otherwise.
 *
 * Deterministic by construction: the "core feed" is fixture cards shaped
 * exactly like FlashcardReviewScheduleCard (core ce0d7eb wire contract) —
 * no network, no clock dependence (NOW is pinned).
 */
import {
  intervalDaysFor,
  scheduleCards,
  dueCards,
  dueCountBySubtopic,
  summarizeCardReviews,
} from "../src/lib/flashcard-review";
import {
  unifySchedules,
  unifiedDueCards,
  unifiedDueCountBySubtopic,
  unifiedSummarize,
  type CoreScheduleCard,
} from "../src/lib/flashcard-unified";
import type { CourseProgress } from "../src/lib/progress";

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

console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
