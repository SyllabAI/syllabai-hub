import { expect, test } from "@playwright/test";
import {
  DECK_SUBTOPIC,
  DECK_URL,
  DECKS_URL,
  ageCardRatings,
  ratedCardIds,
} from "./helpers";

/**
 * Deck-flow E2E — the Ebbinghaus review cycle end-to-end (ADR-029 tranche
 * 4.13, over the tranche-4.6 scheduler).
 *
 * The pins follow the queue's honest contract:
 *   - a "Still learning" rating is due IMMEDIATELY (you said you haven't got it);
 *   - a "Know" rating schedules the expanding ladder (1·2·4·8·16, cap 32d)
 *     and is NOT due while fresh;
 *   - a days-old trail (seeded by time-travel in helpers.ts — the same
 *     localStorage shape the scheduler reads, only `at` moved) makes the
 *     card due: header badge, on-card marker, deck-index chip, learner-page
 *     section — all four altitudes from ONE derivation;
 *   - "Review due first" lifts the stalest-due card to the front;
 *   - a re-rate resets the clock (the due marker leaves immediately);
 *   - nothing is invented: never-rated decks show no badge at all.
 *
 * Every test drives the REAL UI for ratings (flip → rate) and only moves
 * timestamps through the overlay — the scheduler's inputs stay shaped
 * exactly like production's.
 */

const REVEAL = "Reveal answer";

/** Flip the current card and give it a rating through the real controls. */
async function rateCurrent(page: import("@playwright/test").Page, rating: "Still learning" | "Know") {
  await page.getByRole("button", { name: REVEAL }).click();
  await page.getByRole("button", { name: rating, exact: true }).click();
}

/**
 * The learner-facing drawer that hosts the SAME StateTab as /learner — the
 * knowledge-graph page's "my state" drawer (one derivation, one UI, tranche
 * 4.8). /learner itself is auth-gated (RequireAuth) and mock mode has no
 * core to sign in against, so the E2E pins the section where every signed-
 * out visitor can actually reach it — the honest surface.
 */
async function openLearnerDrawer(page: import("@playwright/test").Page) {
  await page.goto("/knowledge-graph");
  await page.locator('button[aria-haspopup="dialog"]').first().click();
}

test("rating through the deck: counters update, still-learning is due immediately, review-due-first lifts it", async ({
  page,
}) => {
  await page.goto(DECK_URL);
  await expect(page.locator("span.tabular-nums", { hasText: /^1\// })).toBeVisible();

  // SME loop: rate only after seeing the back — controls disabled up front
  await expect(page.getByRole("button", { name: "Still learning", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Know", exact: true })).toBeDisabled();

  // never-rated → no due badge at all (nothing invented)
  await expect(page.getByText("due for review")).toHaveCount(0);

  await rateCurrent(page, "Still learning");
  await expect(page.locator("span.tabular-nums", { hasText: /^2\// })).toBeVisible();
  await expect(page.getByText("1 still learning")).toBeVisible();
  // a still-learning rating is due NOW — the queue surfaces it immediately
  await expect(page.getByText("1 due for review")).toBeVisible();

  await page.getByRole("button", { name: "Review due first" }).click();
  await expect(page.locator("span.tabular-nums", { hasText: /^1\// })).toBeVisible();
  // the current card carries the honest on-card marker
  await expect(page.getByText("due for review", { exact: true })).toBeVisible();

  // keyboard-only traversal: focus the card, Enter flips, controls enable
  const card = page.getByRole("button", { name: "Reveal answer" });
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Know", exact: true })).toBeEnabled();
});

test("know ladder: fresh know is not due, a days-old trail is, review-due-first lifts the stalest, re-rate resets", async ({
  page,
}) => {
  await page.goto(DECK_URL);

  // rate two cards "know" through the real UI — fresh knows are NOT due
  await rateCurrent(page, "Know");
  await rateCurrent(page, "Know");
  await expect(page.getByText("2 know")).toBeVisible();
  await expect(page.getByText("due for review")).toHaveCount(0);

  // time-travel the SECOND card's trail 2 days back (streak 1 → 1-day
  // interval → due a day ago) — the returning-learner state
  const ids = await ratedCardIds(page);
  expect(ids).toHaveLength(2);
  const aged = await ageCardRatings(page, [{ cardId: ids[1], rating: "know", ageDays: 2 }]);
  expect(aged).toEqual([ids[1]]);
  await page.reload();

  await expect(page.getByText("1 due for review")).toBeVisible();
  // current card is the first in natural order (NOT the due one) — no marker
  await expect(page.locator("span.tabular-nums", { hasText: /^1\// })).toBeVisible();
  await expect(page.getByText("due for review", { exact: true })).toHaveCount(0);

  // "Review due first" lifts the stalest-due card to the front — the marker
  // appears on the CURRENT card
  await page.getByRole("button", { name: "Review due first" }).click();
  await expect(page.getByText("due for review", { exact: true })).toBeVisible();

  // re-rate resets the clock: the queue empties immediately
  await rateCurrent(page, "Know");
  await expect(page.getByText("2 know")).toBeVisible();
  await expect(page.getByText("due for review")).toHaveCount(0);

  // and a still-learning on the next card is due again right away
  await rateCurrent(page, "Still learning");
  await expect(page.getByText("1 due for review")).toBeVisible();
  await expect(page.getByText("1 still learning")).toBeVisible();
});

test("learner page: the Flashcards due section shows the deck, its due count, and deep-links to it", async ({
  page,
}) => {
  await page.goto(DECK_URL);
  await rateCurrent(page, "Know"); // card 1: fresh → scheduled, not due
  const ids = await ratedCardIds(page);
  await ageCardRatings(page, [{ cardId: ids[0], rating: "know", ageDays: 3 }]);
  await page.reload();

  // the deck index carries the per-deck due chip from the same derivation
  // (the code lives in the link's href — the row shows the human title)
  await page.goto(DECKS_URL);
  const deckRow = page.locator(`a[href$="/flashcards/${DECK_SUBTOPIC}"]`);
  await expect(deckRow).toBeVisible();
  await expect(deckRow.getByText("1 due")).toBeVisible();

  // the learner drawer's Flashcards due section: one deck row, one due,
  // honest deep link
  await openLearnerDrawer(page);
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Flashcards due" }) });
  await expect(section).toBeVisible();
  await expect(section.getByText("1 due")).toBeVisible();
  await expect(section.getByText(DECK_SUBTOPIC)).toBeVisible();

  await section.getByRole("link", { name: "open deck" }).click();
  await expect(page).toHaveURL(new RegExp(`/flashcards/${DECK_SUBTOPIC}$`));
});

test("learner drawer: rated-but-nothing-due shows the honest empty state, never a fabricated queue", async ({
  page,
}) => {
  await page.goto(DECK_URL);
  await rateCurrent(page, "Know"); // fresh know: scheduled +1 day, not due
  await openLearnerDrawer(page);

  const section = page.locator("section", { has: page.getByRole("heading", { name: "Flashcards due" }) });
  await expect(section).toBeVisible();
  await expect(section.getByText(/Nothing due — next card/)).toBeVisible();
  // the honesty footer rides every state of the section: timing-only rule,
  // never mastery (its own words are the pin)
  await expect(section.getByText(/never mastery/)).toBeVisible();
});
