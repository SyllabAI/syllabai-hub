import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { DECK_URL, DECKS_URL, PILOT } from "./helpers";

/**
 * a11y pass — automated axe-core scans on the hub's key routes (ADR-029
 * tranche 4.13).
 *
 * The GATE: no CRITICAL and no SERIOUS violations on any scanned route.
 * Those are the classes axe documents as blocking screen-reader/keyboard
 * users (missing names, broken nesting, unlabeled inputs, non-semantic
 * critical landmarks). MODERATE/MINOR findings are printed to the test log
 * for the operator's visibility but do not fail the build — they are design
 * backlog, not correctness bugs, and snapshot-pinning them would churn on
 * every copy edit.
 *
 * Keyboard operability of the deck flow is pinned in deck-flow.spec.ts
 * (focus → Enter flip → enabled controls); the two specs together are the
 * a11y tranche.
 */

const ROUTES: Array<[string, string]> = [
  ["home", "/"],
  ["courses index", "/courses"],
  ["course page", `/courses/${PILOT}`],
  ["flashcards index", DECKS_URL],
  ["deck player", DECK_URL],
  ["learner state", "/learner"],
  ["login", "/login"],
  ["tutor", "/tutor"],
];

for (const [name, route] of ROUTES) {
  test(`axe: ${name} (${route}) has no serious or critical violations`, async ({ page }) => {
    await page.goto(route, { waitUntil: "load" });
    // let client hydration settle before scanning (badges/due chips mount
    // after the overlay loads). NOT networkidle — some surfaces (login)
    // poll continuously and never go idle.
    await page.waitForTimeout(1_500);

    const results = await new AxeBuilder({ page }).analyze();

    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    for (const v of serious) {
      console.error(
        `[axe:${name}] ${v.id} (${v.impact}) x${v.nodes.length}: ${v.help} — ${v.nodes[0]?.target.join(" ")}`,
      );
    }
    // operator visibility: the design backlog, counted not gated
    const backlog = results.violations.filter(
      (v) => v.impact === "moderate" || v.impact === "minor",
    );
    if (backlog.length > 0) {
      console.log(
        `[axe:${name}] design backlog (not gated): ` +
          backlog.map((v) => `${v.id}(${v.impact})x${v.nodes.length}`).join(", "),
      );
    }
    expect(serious, `${name}: serious/critical a11y violations`).toEqual([]);
  });
}
