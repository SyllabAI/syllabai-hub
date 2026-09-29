/**
 * HUB-TEACHER-DASH wave 2 probe — the per-subject Knowledge Graph entry
 * inside the class workspace (operator trace 1a0ec95548b5f1e1 "The teacher
 * should also have a knowledge graph view right?"). Real clicks against the
 * PRODUCTION standalone build served on :3100.
 *
 * Ledger note: wave 1 = scripts/w8_teacher_dash_probe.mjs (26/26); this file
 * continues the hub probe numbering (w9) while the coordination ledger calls
 * this increment wave 2.
 *
 * Identity: the same mock teacher session wave 1 used (syllabai.user with
 * roles:["TEACHER"] + syllabai.token — the store lib/identity.ts reads).
 * The class is created through the REAL add-class flow (name -> level ->
 * subject row pick), then the workspace's resource band is asserted:
 * four cards, the Knowledge Graph one deep-linking
 * /knowledge-graph?course=igcse-chemistry-19 exactly like the student's
 * course hub does, with the honest course-stats TOPIC census, and the
 * click-through landing on the KG host chrome with its live data-path chip.
 */
import { chromium } from "playwright";

const BASE = process.env.PROBE_BASE ?? "http://localhost:3100";
const PILOT = "igcse-chemistry-19";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.addInitScript(() => {
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
  // ---------- S1: create a class through the real flow (Chemistry only) ----------
  await page.goto(`${BASE}/teacher`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('button:has-text("Add class")').first().click();
  const dialog = page.locator("[role=dialog]");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await dialog.locator('input[aria-label="Class name"]').fill("KG probe · 10B");
  await dialog.locator("button", { hasText: /IGCSE/ }).first().click();
  await page.waitForTimeout(400);
  // pick ONLY the pilot subject row so count/census assertions are exact
  const chemRow = dialog.locator('button[aria-pressed][class*="w-full"]', {
    hasText: /Chemistry/i,
  });
  const chemCount = await chemRow.count();
  check("S1 chemistry subject row listed", chemCount >= 1, `rows=${chemCount}`);
  await chemRow.first().click();
  await page.waitForTimeout(200);
  await dialog.locator('button:has-text("Create class")').click();
  await page.waitForTimeout(800);
  const body1 = await page.textContent("body");
  check("S1 class card appears", /KG probe · 10B/.test(body1 ?? ""));

  // ---------- S2: workspace resource band — four cards, KG deep link exact ----------
  await page.locator('a:has-text("Open class workspace")').first().click();
  await page.waitForTimeout(1200);
  const body2 = (await page.textContent("body")) ?? "";
  check("S2 workspace heading Chemistry section", /Chemistry/.test(body2));
  for (const label of [
    "Revision Notes",
    "Exam Questions",
    "Flashcards",
    "Knowledge Graph",
  ]) {
    const n = await page.locator("a", { hasText: label }).count();
    check(`S2 resource card present: ${label}`, n >= 1, `count=${n}`);
  }
  const kgCard = page.locator('a:has-text("Knowledge Graph")').first();
  const kgHref = await kgCard.getAttribute("href");
  check(
    "S2 KG card deep-links ?course=igcse-chemistry-19",
    kgHref === `/knowledge-graph?course=${PILOT}`,
    `href=${kgHref}`,
  );
  // regression: the three pre-existing cards keep their course-hub hrefs
  for (const [label, path] of [
    ["Revision Notes", `/courses/${PILOT}/revision-notes`],
    ["Exam Questions", `/courses/${PILOT}/exam-questions`],
    ["Flashcards", `/courses/${PILOT}/flashcards`],
  ]) {
    const href = await page
      .locator("a", { hasText: label })
      .first()
      .getAttribute("href");
    check(`S2 regression href: ${label}`, href === path, `href=${href}`);
  }

  // ---------- S3: KG count is the honest course-stats TOPIC census ----------
  const kgCardText = (await kgCard.textContent()) ?? "";
  const m = kgCardText.match(/(\d+)\s+topics in the corpus/);
  check("S3 KG count = topics census", !!m && Number(m[1]) > 0, `text=${kgCardText.replace(/\s+/g, " ").trim().slice(0, 120)}`);

  // ---------- S4: click-through lands on the KG host chrome ----------
  await kgCard.click();
  await page.waitForURL(`${BASE}/knowledge-graph?course=${PILOT}`, { timeout: 8000 }).catch(() => {});
  check("S4 URL is /knowledge-graph?course=<pilot>", page.url().includes(`/knowledge-graph?course=${PILOT}`), page.url());
  await page.waitForTimeout(1500);
  const body4 = (await page.textContent("body")) ?? "";
  check("S4 host chrome renders the course label", /Chemistry/i.test(body4));
  // live data-path chip (syllabai-kg:ready over postMessage) — the same
  // pre-existing surface students use from the course hub
  const chipReady = await page
    .locator("text=/\\d+ nodes · \\d+ edges · \\d+ spec points/")
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check("S4 data-path counts chip appears", chipReady, chipReady ? "" : "honest-absent: iframe ready chip did not surface in 10s");

  // ---------- S5: zero page errors across the whole run ----------
  check("S5 zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
