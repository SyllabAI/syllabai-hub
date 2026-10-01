import { expect, test } from "@playwright/test";
import { DECK_URL, PILOT } from "./helpers";

/**
 * Outbound-link posture — the regression lock for the removal tranches:
 *
 *   HUB-NOTES-SOURCE   (0bc6ee9) the notes trust-meta Source hop is gone
 *   HUB-OUTBOUND-CLA   (43c1fde) every external MARKDOWN text-link renders
 *                               label-only (a span, not an anchor) corpus-wide
 *   HUB-OUTBOUND-FINAL (s144)    the last two GitHub hops: the graph-explorer
 *                               About popover (Integration plan / Source
 *                               builds) and the teacher banner's
 *                               TEACHER_MODE_PLAN.md reference
 *
 * What STAYS live by design — do not "fix" these if a sweep flags them:
 *   - the pastpapers surfaces: the raw.githubusercontent PDF mirror and its
 *     preconnect/dns-prefetch hints (the project's own mirror, HUB-PP-*)
 *   - corpus IMAGES: a different renderer path (<img>, hotlinked from the
 *     resources mirror) — images are not anchors and keep loading
 *
 * The invariant pinned here is deliberately narrow: on the scanned
 * surfaces, NO anchor element may carry an external (http/https) href.
 */

/** The note's body carries two savemyexams TEXT cross-references
 * ("[Periodic Table](…)", "[Electronic configurations](…)") plus one
 * resources-mirror image — one page pinning both sides of the contract. */
const NOTE_WITH_EXT_LINKS = `/courses/${PILOT}/revision-notes/rn_mBqgkpZ3hbSBmWCC`;
/** Every question topic in the pilot corpus carries external md links in
 * stems/solutions (Pearson refs, figure credits) — all neutralized. */
const EXAM_TOPIC = `/courses/${PILOT}/exam-questions/1-1-states-of-matter`;

test("graph-explorer: the About popover explains the builds without leaving the site", async ({
  page,
}) => {
  await page.goto("/graph-explorer", { waitUntil: "load" });
  await expect(page.getByRole("button", { name: "About this explorer" })).toBeVisible();

  // the former GitHub buttons are gone entirely
  await expect(page.getByRole("link", { name: "Integration plan" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Source builds" })).toHaveCount(0);

  // the affordances that remain (open-build-in-tab, canonicalKG artifact)
  // are all internal /kg/ paths — no anchor on the page leaves the site
  await expect(page.locator('a[href^="http"]')).toHaveCount(0);

  // the popover still opens and still carries its explanatory prose
  await page.getByRole("button", { name: "About this explorer" }).click();
  await expect(page.getByText("What is this?")).toBeVisible();
  await expect(page.locator('a[href^="http"]')).toHaveCount(0);
});

test("teacher banner: the plan reference stays, the GitHub hop goes", async ({ page }) => {
  // /teacher is RequireAuth-gated (role="teacher") — seed the same core
  // session shape login writes (syllabai.token + syllabai.user, lib/api),
  // the deck-flow specs' localStorage-seeding pattern applied to the
  // session. This is a UX affordance only; no core calls are needed for
  // the banner (browser-local classes + the internal course-stats route).
  await page.addInitScript(() => {
    window.localStorage.setItem("syllabai.token", "e2e-teacher-token");
    window.localStorage.setItem(
      "syllabai.user",
      JSON.stringify({
        id: "e2e-teacher",
        email: "teacher-e2e@syllabai.dev",
        displayName: "E2E Teacher",
        roles: ["TEACHER"],
      }),
    );
  });
  await page.goto("/teacher", { waitUntil: "load" });
  await expect(page.getByText("docs/TEACHER_MODE_PLAN.md")).toBeVisible();
  await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);
  await expect(page.locator('a[href^="http"]')).toHaveCount(0);
});

test("note reader: external md text-links render label-only; images keep loading", async ({
  page,
}) => {
  await page.goto(NOTE_WITH_EXT_LINKS, { waitUntil: "load" });

  // HUB-NOTES-SOURCE: no Source link in the trust meta row (the note's
  // sourceUrl is a savemyexams URL that stays in the data contract only)
  await expect(page.getByRole("link", { name: /^Source/ })).toHaveCount(0);

  // HUB-OUTBOUND-CLA: the md text-links render as spans, not anchors —
  // zero external anchors anywhere on the page…
  await expect(page.locator('a[href^="http"]')).toHaveCount(0);
  await expect(page.locator('a[href*="savemyexams"]')).toHaveCount(0);

  // …while the neutralized label text is still readable, and the corpus
  // image still loads from the resources mirror (<img>, not an anchor)
  await expect(page.getByText("Periodic Table", { exact: true })).toBeVisible();
  await expect(page.locator('img[src^="https://"]')).not.toHaveCount(0);
});

test("exam-questions topic and flashcards deck: zero external anchors", async ({ page }) => {
  await page.goto(EXAM_TOPIC, { waitUntil: "load" });
  await expect(page.locator('a[href^="http"]')).toHaveCount(0);

  await page.goto(DECK_URL, { waitUntil: "load" });
  await expect(page.locator('a[href^="http"]')).toHaveCount(0);
});
