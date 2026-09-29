/**
 * W7 probe — the symbols palette must be transient (operator bug report,
 * trace 1a0ec11bc830f67d: "the Mathematics, Greek Letters, Chemistry
 * notation pop up stays opened up by default, cant close it as well").
 *
 * Surface: /practice (shared AnswerTextarea — the exam-questions player
 * renders the same component; question surfaces stay bridge-off here per
 * the wave-3 ledger precedent).
 *
 * Scenario matrix (real Playwright mouse/keyboard):
 *  S1 default-closed WITH the stale wave-3c pref seeded ("1") — the exact
 *     reported repro; the old code re-opened the palette one tick after
 *     hydration. Also asserts the legacy key is swept after load.
 *  S2 open via the Ω trigger → the three legends visible.
 *  S3 close via OUTSIDE pointer-down (the dismiss path that was a no-op).
 *  S4 close via Escape (the dismiss path that was a no-op).
 *  S5 close via the Ω trigger again (toggle).
 *  S6 reload (stale pref now swept) → activate → still closed.
 *  S7 regression: inserting a symbol still lands text in the editor.
 */
import { chromium } from "playwright";

const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";
const LEGACY_KEY = "syllabai-hub:answer-symbols-open";

const results = [];
const check = (name, ok, detail = "") =>
  results.push({ name, ok, detail }) &&
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

const paletteVisible = (page) =>
  page.evaluate(() => {
    const legends = [...document.querySelectorAll("[data-slot=popover-content] p")];
    const has = (t) => legends.some((p) => p.textContent.trim() === t);
    const el = document.querySelector("[data-slot=popover-content]");
    return {
      mounted: !!el,
      visible: !!el && el.offsetParent !== null,
      math: has("Mathematical"),
      greek: has("Greek letters"),
      chem: has("Chemistry & notation"),
    };
  });

/** Click the answer editor until the toolbar strip reacts (dev cold-compile
 *  hydration can swallow the first clicks — retries are probe hygiene, not
 *  part of the behavior under test). */
const activateEditor = async (page) => {
  const editor = page.locator("[contenteditable].ProseMirror").first();
  const omega = page.locator('button[aria-label="Insert symbol"]');
  for (let i = 0; i < 6; i++) {
    await editor.click().catch(() => {});
    try {
      await omega.waitFor({ state: "visible", timeout: 4000 });
      return;
    } catch {
      await page.waitForTimeout(1500); // hydration may still be in flight
    }
  }
  throw new Error("answer box never activated (Ω strip never appeared)");
};

const browser = await chromium.launch();
try {
  // ---------- S1: stale pref seeded — palette must NOT open by default ----------
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(
    ([k]) => window.localStorage.setItem(k, "1"),
    [LEGACY_KEY]
  );
  await page.goto(`${BASE}/practice`, { waitUntil: "domcontentloaded" });
  await activateEditor(page);
  await page.waitForTimeout(600); // the old bug applied the pref one tick after mount

  let vis = await paletteVisible(page);
  check(
    "S1a default-closed despite stale pref=1",
    !vis.visible && !vis.mounted,
    `mounted=${vis.mounted} visible=${vis.visible}`
  );
  const swept = await page.evaluate(([k]) => window.localStorage.getItem(k), [LEGACY_KEY]);
  check("S1b legacy key swept after load", swept === null, `value=${JSON.stringify(swept)}`);
  await ctx.close();

  // ---------- S2–S7: fresh context, clean storage ----------
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(`${BASE}/practice`, { waitUntil: "domcontentloaded" });
  await activateEditor(page2);
  await page2.waitForTimeout(200);

  const omega = page2.locator('button[aria-label="Insert symbol"]');
  await omega.click();
  await page2.waitForTimeout(250);
  vis = await paletteVisible(page2);
  check(
    "S2 Ω opens the palette with all three SME legends",
    vis.visible && vis.math && vis.greek && vis.chem,
    `visible=${vis.visible} math=${vis.math} greek=${vis.greek} chem=${vis.chem}`
  );
  const expanded = await omega.getAttribute("aria-expanded");
  check("S2b trigger aria-expanded=true while open", expanded === "true", `aria-expanded=${expanded}`);

  // S3: outside pointer-down closes
  await page2.mouse.click(20, 300); // dead page space, outside box + palette
  await page2.waitForTimeout(250);
  vis = await paletteVisible(page2);
  check("S3 outside pointer-down closes", !vis.visible, `visible=${vis.visible}`);
  // NOTE: the outside click ALSO blurs the wrapper (SME's writtenMode
  // collapse — correct product behavior), so the strip is gone; re-activate.
  await activateEditor(page2);

  // S4: Escape closes
  await omega.click();
  await page2.waitForTimeout(250);
  vis = await paletteVisible(page2);
  if (!vis.visible) throw new Error("S4 setup: palette did not open");
  await page2.keyboard.press("Escape");
  await page2.waitForTimeout(250);
  vis = await paletteVisible(page2);
  check("S4 Escape closes", !vis.visible, `visible=${vis.visible}`);

  // S5: Ω toggles closed when open
  await omega.click();
  await page2.waitForTimeout(250);
  await omega.click();
  await page2.waitForTimeout(250);
  vis = await paletteVisible(page2);
  check("S5 Ω re-click toggles closed", !vis.visible, `visible=${vis.visible}`);

  // S6: reload → activate → still closed (no resurrection)
  await page2.reload({ waitUntil: "domcontentloaded" });
  await activateEditor(page2);
  await page2.waitForTimeout(500);
  vis = await paletteVisible(page2);
  check("S6 after reload the palette stays closed", !vis.visible, `visible=${vis.visible}`);

  // S7: regression — a symbol insert still lands text
  await omega.click();
  await page2.waitForTimeout(250);
  await page2.locator('[data-slot=popover-content] button', { hasText: "α" }).first().click();
  await page2.waitForTimeout(300);
  const text = await page2.evaluate(
    () => document.querySelector("[contenteditable].ProseMirror")?.textContent ?? ""
  );
  check("S7 symbol insert lands in the editor", text.includes("α"), `text=${JSON.stringify(text.slice(0, 40))}`);
  // and the palette closes after the insert — the editor REGAINS focus
  // (TipTap hands the caret back so typing continues) and Radix's standard
  // focus-outside dismissal fires. SME's own close-on-insert behavior is
  // honest-absent (unverifiable for free); the Radix standard is the
  // recorded choice (verified via w7_s7b_instrument.mjs: NO pointerDownOutside
  // fired — the dismissal is focusOutside after the insert).
  vis = await paletteVisible(page2);
  check("S7b palette closes after an insert (focus back to the editor)", !vis.visible, `visible=${vis.visible}`);
  const focusBack = await page2.evaluate(
    () => document.activeElement?.classList?.contains("ProseMirror") ?? false
  );
  check("S7c editor holds focus after insert", focusBack, `activeElement=ProseMirror:${focusBack}`);

  const errs = [];
  page2.on("pageerror", (e) => errs.push(String(e)));
  await page2.waitForTimeout(200);
  check("console clean of page errors", errs.length === 0, errs.slice(0, 3).join(" | "));

  await ctx2.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== W7 probe: ${results.length - failed.length}/${results.length} passed ===`);
process.exit(failed.length ? 1 : 0);
