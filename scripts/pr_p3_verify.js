// P3 sweep runtime verification (audit 2026-10-02 #9-#22) — standalone :3001
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

const BASE = "http://localhost:3001";
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${extra}`);
  }
};

(async () => {
  const browser = await chromium.launch();

  // ── learner contexts (signed out) ────────────────────────────────────
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // #14 page titles
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  ok("#14 home title", (await page.title()) === "SyllabAI Hub — IGCSE & IAL revision", await page.title());
  await page.goto(BASE + "/courses", { waitUntil: "domcontentloaded" });
  ok("#14 courses title", (await page.title()) === "Browse courses — SyllabAI Hub", await page.title());
  await page.goto(BASE + "/courses/igcse-chemistry-19", { waitUntil: "domcontentloaded" });
  const chemTitle = await page.title();
  ok("#14 course title labelled", chemTitle.includes("— SyllabAI Hub") && !chemTitle.startsWith("SyllabAI Hub —"), chemTitle);
  await page.goto(BASE + "/teacher", { waitUntil: "domcontentloaded" });
  ok("#14 teacher title", (await page.title()) === "Teacher workspace — SyllabAI Hub", await page.title());

  // #10 skip link: first Tab lands on it; Enter moves focus to #main-content
  await page.goto(BASE + "/courses", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.keyboard.press("Tab");
  const firstFocused = await page.evaluate(() => ({
    text: document.activeElement?.textContent?.trim(),
    href: document.activeElement?.getAttribute("href"),
  }));
  ok("#10 skip link first in tab order", firstFocused.text === "Skip to content" && firstFocused.href === "#main-content", JSON.stringify(firstFocused));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const afterSkip = await page.evaluate(() => ({
    id: document.activeElement?.id,
    tag: document.activeElement?.tagName,
  }));
  ok("#10 skip link targets main", afterSkip.id === "main-content" && afterSkip.tag === "MAIN", JSON.stringify(afterSkip));

  // #9 focus-visible ring on directory cards (keyboard focus → border change)
  await page.goto(BASE + "/courses", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const ring = await page.evaluate(() => {
    const link = document.querySelector('a[href="/courses/igcse-chemistry-19"]');
    const card = link?.querySelector("div[class*='group-hover']");
    if (!link || !card) return { found: false };
    const before = getComputedStyle(card).borderColor;
    // simulate :focus-visible by checking the class + focusing the link
    link.focus();
    const after = getComputedStyle(card).borderColor;
    return {
      found: true,
      hasClass: /group-focus-visible:border-primary\/60/.test(card.className),
      changed: before !== after,
      before,
      after,
    };
  });
  ok("#9 directory card focus ring class", ring.found && ring.hasClass, JSON.stringify(ring));

  // #13 single active row on /exam-questions/saved
  await page.goto(BASE + "/courses/igcse-chemistry-19/exam-questions/saved", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const activeRows = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Course sections"]');
    if (!nav) return -1;
    return nav.querySelectorAll('[aria-current="page"]').length;
  });
  const activeLabels = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Course sections"]');
    return nav ? [...nav.querySelectorAll('[aria-current="page"]')].map((n) => n.textContent?.trim().slice(0, 30)) : [];
  });
  ok("#13 exactly one active row", activeRows === 1 && /Saved/.test(activeLabels[0] ?? ""), `count=${activeRows} ${JSON.stringify(activeLabels)}`);

  // #22 Experiments hidden from signed-out More tools
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const studyBtn = page.getByRole("button", { name: "Study tools" }).first();
  await studyBtn.click();
  await page.waitForTimeout(400);
  const menuText = await page.evaluate(() => document.querySelector('[role="menu"]')?.textContent ?? "");
  ok("#22 no Experiments for signed-out", !menuText.includes("Experiments") && menuText.includes("AI Tutor"), menuText.slice(0, 80));
  await page.keyboard.press("Escape");

  // #20a ?q= deep link resolves to the owning topic page
  const resp = await page.goto(BASE + "/courses/igcse-chemistry-19/exam-questions?q=qstnprt_smxznrg8dFtKfc6t", { waitUntil: "domcontentloaded", maxRedirects: 5 });
  await page.waitForTimeout(600);
  ok("#20a q= redirects to topic", page.url().includes("/exam-questions/1-1-states-of-matter--exam-questions"), page.url());
  ok("#20a topic page renders", (await page.content()).includes("States of Matter"));

  // #20b ?node= deep link focuses the node in the renderer iframe
  await page.goto(BASE + "/knowledge-graph?course=igcse-chemistry-19&node=" + encodeURIComponent("p:1.1"), { waitUntil: "networkidle" });
  await page.waitForTimeout(3500); // iframe load + ready handshake + focus retry
  const frameHandle = page.frames().find((f) => f.url().includes("openhuman-course-explorer"));
  if (!frameHandle) {
    ok("#20b kg iframe found", false);
  } else {
    const panel = await frameHandle.evaluate(() => {
      const p = document.getElementById("panel");
      return { shown: p?.classList.contains("show") ?? false, title: document.getElementById("p-title")?.textContent ?? "" };
    });
    ok("#20b node focused in renderer", panel.shown && panel.title.includes("1.1"), JSON.stringify(panel));
  }

  await page.close();

  // ── teacher context (#19 renames) ────────────────────────────────────
  const tpage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await tpage.addInitScript(() => {
    localStorage.setItem("syllabai.token", "fake-token-for-verification");
    localStorage.setItem(
      "syllabai.user",
      JSON.stringify({ id: "u_test", email: "t@example.com", displayName: "Test Teacher", roles: ["TEACHER"] }),
    );
  });
  await tpage.goto(BASE + "/teacher/class", { waitUntil: "domcontentloaded" });
  await tpage.waitForTimeout(1200);
  const h1 = await tpage.evaluate(() => document.querySelector("h1")?.textContent?.trim());
  ok("#19 Class insights h1", h1 === "Class insights", h1 ?? "no h1");
  const navLabels = await tpage.evaluate(() => [...document.querySelectorAll("nav a")].map((a) => a.textContent?.trim()));
  ok("#19 tab shows Class graph (demo)", navLabels.some((l) => l?.includes("Class graph (demo)")), JSON.stringify(navLabels.slice(0, 8)));
  ok("#19 tab shows Class insights", navLabels.some((l) => l?.includes("Class insights")));
  await tpage.close();

  await browser.close();
  console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
