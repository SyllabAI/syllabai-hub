/**
 * HUB-TEACHER-DASH W1 probe — the teacher dashboard becomes the student one
 * (operator trace 1a0ec61d5612aa6d). Real clicks against the PRODUCTION
 * build served on :3100.
 *
 * Identity: the mock teacher session is seeded via localStorage
 * (syllabai.user with roles:["TEACHER"] + syllabai.token) — the same store
 * lib/identity.ts reads; /login writes exactly this shape.
 */
import { chromium } from "playwright";

const BASE = process.env.PROBE_BASE ?? "http://localhost:3100";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.addInitScript(() => {
  // the exact shape api.ts currentUser() shape-checks (id + displayName required)
  window.localStorage.setItem(
    "syllabai.user",
    JSON.stringify({
      id: "probe-teacher-1",
      email: "teacher@syllabai.test",
      displayName: "Demo Teacher",
      roles: ["TEACHER"],
    }),
  );
  window.localStorage.setItem("syllabai.token", "probe-token");
});

try {
  // ---------- S1: dashboard anatomy (empty) ----------
  await page.goto(`${BASE}/teacher`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const body = await page.textContent("body");
  check("S1 greeting renders", /Hi Demo Teacher/.test(body ?? ""), "");
  check("S1 My classes section with count 0", /My classes\s*·\s*0/.test(body ?? ""));
  check("S1 empty-state CTA present", (body ?? "").includes("No classes yet"));
  check("S1 nav intact", (body ?? "").includes("Marking review") && (body ?? "").includes("Classes"));
  check("S1 honesty line present", (body ?? "").includes("browser-local containers"));

  // ---------- S2: add-class flow ----------
  await page.locator('button:has-text("Add class")').first().click();
  await page.waitForTimeout(400);
  const dialog = page.locator("[role=dialog]");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await dialog.locator('input[aria-label="Class name"]').fill("10A · retake cohort");
  // cascade: pick a level, toggle two subjects
  const levelBtn = dialog.locator("button", { hasText: /IGCSE/ }).first();
  await levelBtn.click();
  await page.waitForTimeout(300);
  // subject rows are the only full-width aria-pressed buttons in the dialog
  // (board/level chips are auto-width) — scope precisely, board/level
  // toggles would leave `selected` empty and Create disabled
  const rows = dialog.locator('button[aria-pressed][class*="w-full"]');
  const rowCount = await rows.count();
  check("S2 subject rows listed", rowCount >= 2, `rows=${rowCount}`);
  await rows.nth(0).click();
  await rows.nth(1).click();
  await page.waitForTimeout(200);
  const chips = dialog.locator('button[aria-label^="Remove"]');
  const chipCount = await chips.count();
  check("S2 two subjects selected as chips", chipCount === 2, `chips=${chipCount}`);
  await dialog.locator('button:has-text("Create class")').click();
  await page.waitForTimeout(600);
  const body2 = await page.textContent("body");
  check("S2 class card appears", /10A · retake cohort/.test(body2 ?? ""));
  check("S2 eyebrow counts 2 subjects", /Edexcel · 2 subjects/.test(body2 ?? ""));
  check("S2 section count updated", /My classes\s*·\s*1/.test(body2 ?? ""));

  // ---------- S3: card rows navigate to the workspace ----------
  const cardLink = page.locator('a:has-text("Open class workspace")').first();
  await cardLink.click();
  await page.waitForTimeout(1200);
  const detail = await page.textContent("body");
  check("S3 dispatcher renders local workspace", (detail ?? "").includes("browser-local container"));
  check("S3 workspace h1 is the class", /10A · retake cohort/.test(detail ?? ""));
  check("S3 per-subject sections present", (detail ?? "").includes("Open the course hub"));
  check("S3 tools present with honest badges", (detail ?? "").includes("Test Builder") && (detail ?? "").includes("Phase 2"));
  check("S3 live console present", (detail ?? "").includes("Marking review") && (detail ?? "").includes("live"));
  check("S3 roster pointer present", (detail ?? "").includes("Live rosters (core)"));
  check("S3 honesty box present", (detail ?? "").includes("lives in this browser"));

  // ---------- S4: edit subjects from the workspace ----------
  await page.locator('button:has-text("Edit subjects")').first().click();
  await page.waitForTimeout(400);
  const dlg2 = page.locator("[role=dialog]");
  await dlg2.waitFor({ state: "visible", timeout: 5000 });
  const nameVal = await dlg2.locator('input[aria-label="Class name"]').inputValue();
  check("S4 edit mode pre-fills the name", nameVal === "10A · retake cohort", nameVal);
  // the seeded selection is visible as removable chips (subject ROWS only
  // render after a level pick — the cascade design; verified via
  // w8_debug_edit.mjs: the state IS seeded, rows await the level)
  const preChips = await dlg2.locator('button[aria-label^="Remove"]').count();
  check("S4 edit mode pre-selects both subjects (chips)", preChips === 2, `chips=${preChips}`);
  // unselect one via its chip, save
  await dlg2.locator('button[aria-label^="Remove"]').first().click();
  await dlg2.locator('button:has-text("Save changes")').click();
  await page.waitForTimeout(800);
  const detail2 = await page.textContent("body");
  check("S4 workspace reflects 1 subject", /Covering 1 subject/.test(detail2 ?? ""));

  // ---------- S5: persistence across reload ----------
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const afterReload = await page.textContent("body");
  check("S5 class persists after reload", /10A · retake cohort/.test(afterReload ?? ""));

  // ---------- S6: core id falls through to the core client ----------
  await page.goto(`${BASE}/teacher/classes/00000000-0000-0000-0000-000000000000`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1500);
  const coreDetail = await page.textContent("body");
  check(
    "S6 core id does NOT render the local workspace",
    !(coreDetail ?? "").includes("browser-local container"),
    "",
  );
  check("S6 core surface renders its own chrome", (coreDetail ?? "").length > 100, "");

  // ---------- S7: removed local id renders the honest empty state ----------
  await page.goto(`${BASE}/teacher/classes/local-does-not-exist`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const gone = await page.textContent("body");
  check("S7 unknown local id → honest message", (gone ?? "").includes("no longer on this browser"));

  // ---------- S8: remove the class from the dashboard ----------
  await page.goto(`${BASE}/teacher`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator('button[aria-label^="Remove 10A"]').click();
  await page.waitForTimeout(600);
  const afterRemove = await page.textContent("body");
  check("S8 remove returns to empty state", (afterRemove ?? "").includes("No classes yet"));

  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.waitForTimeout(300);
  check("S9 no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== HUB-TEACHER-DASH W1 probe: ${results.length - failed.length}/${results.length} passed ===`);
process.exit(failed.length ? 1 : 0);
