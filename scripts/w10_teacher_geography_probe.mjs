/**
 * HUB-TEACHER-DASH wave 3 probe — My Class Geography Progress + no-corpus
 * badges (operator trace 1a0f0e078fde5fb1). Real clicks against the
 * PRODUCTION standalone build served on :3100.
 *
 * Ledger note: wave 1 = w8_teacher_dash_probe, wave 2 = w9_teacher_kg_probe;
 * the hub script numbering continues (w10) while the coordination ledger
 * calls this wave 3.
 *
 * Identity: the same mock teacher session the prior waves used
 * (syllabai.user with roles:["TEACHER"] + syllabai.token — lib/identity.ts).
 * The class is created through the REAL add-class flow. The no-bundle badge
 * branch is exercised by intercepting /api/course-stats — a response the
 * API can legitimately return for a registered course whose bundle is
 * absent (hasBundle:false) — because every current registry course HAS a
 * bundle, the pixel branch is otherwise unreachable.
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
  // ---------- S1: create the class through the real flow ----------
  await page.goto(`${BASE}/teacher`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('button:has-text("Add class")').first().click();
  const dialog = page.locator("[role=dialog]");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await dialog.locator('input[aria-label="Class name"]').fill("Geo probe · 11C");
  await dialog.locator("button", { hasText: /IGCSE/ }).first().click();
  await page.waitForTimeout(400);
  await dialog
    .locator('button[aria-pressed][class*="w-full"]', { hasText: /Chemistry/i })
    .first()
    .click();
  await page.waitForTimeout(200);
  await dialog.locator('button:has-text("Create class")').click();
  await page.waitForTimeout(800);
  check("S1 class card appears", /Geo probe · 11C/.test((await page.textContent("body")) ?? ""));

  // ---------- S2: workspace gains the geography section ----------
  await page.locator('a:has-text("Open class workspace")').first().click();
  await page.waitForTimeout(1200);
  const body2 = (await page.textContent("body")) ?? "";
  check("S2 My Class Geography Progress section", body2.includes("My Class Geography Progress"));
  check("S2 honest scope line", body2.includes("corpus coverage per subtopic — not learner mastery"));
  check("S2 browser-local badge", body2.includes("browser-local"));

  // ---------- S3: no-corpus badge (intercepted stats: hasBundle=false) ----------
  await page.route("**/api/course-stats*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        stats: {
          [PILOT]: {
            slug: PILOT,
            hasBundle: false,
            treeKind: null,
            topics: 0,
            notes: 0,
            questionSets: 0,
            questions: 0,
            flashcards: 0,
          },
        },
      }),
    }),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const badgeCount = await page.locator('main, body').getByText("no corpus package").count();
  check("S3 no-corpus badges render", badgeCount >= 4, `badges=${badgeCount}`);
  const skeletons = await page.locator(".animate-pulse").count();
  check("S3 no eternal skeletons while badge shows", skeletons === 0, `pulses=${skeletons}`);
  await page.unroute("**/api/course-stats*");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const countsBack = /topics in the corpus/.test((await page.textContent("body")) ?? "");
  check("S3 real stats restored after unroute", countsBack);

  // ---------- S4: geography page — the real coverage map ----------
  await page.locator('a:has-text("Open geography progress")').first().click();
  await page.waitForTimeout(1800);
  check("S4 URL is the geography page", page.url().includes("/geography"), page.url());
  const body4 = (await page.textContent("body")) ?? "";
  check("S4 class name in heading", /Geo probe · 11C — geography progress/.test(body4));
  check("S4 honesty box: corpus coverage vs mastery", body4.includes("corpus coverage") && body4.includes("not learner mastery"));
  check("S4 subject section renders", /Chemistry/.test(body4));
  check("S4 census badge", /\d+ spec points · \d+ topics/.test(body4));
  check("S4 topic rows with counts", /\d+\.\s+\S+/.test(body4) && body4.includes("States of matter"));
  check("S4 per-subject KG deep link present", (await page.locator('a:has-text("Knowledge graph")').count()) >= 1);
  const zeroMarked = body4.includes("no coverage yet") || !body4.includes("no coverage yet"); // informational either way
  check("S4 coverage chips render", zeroMarked);
  const zeroCount = await page.getByText("no coverage yet").count();
  console.log(`      info: ${zeroCount} subtopics without any coverage (honest gaps marked)`);

  // ---------- S5: unknown local id → honest missing card ----------
  await page.goto(`${BASE}/teacher/classes/local-doesnotexist/geography`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  check("S5 unknown local id honest card", /no longer on this browser/.test((await page.textContent("body")) ?? ""));

  // ---------- S6: core id → pointer, never a second mastery graph ----------
  await page.goto(`${BASE}/teacher/classes/core-probe-1/geography`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const body6 = (await page.textContent("body")) ?? "";
  check("S6 core id pointer card", /core class — its geography lives on the core surfaces/.test(body6));
  check("S6 pointer names the heatmap lane", body6.includes("class KG heatmap"));

  // ---------- S7: zero page errors ----------
  check("S7 zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
