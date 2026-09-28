/**
 * Survey every course's unmatched recons — where would a "scope-out" chip fire?
 * Also: which question number does the chemistry 2013-01 1C recon hold?
 *
 * Usage: bun scripts/survey_scope_outs.ts
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "/home/z/my-project";
const { collectPastPapers } = await import(path.join(ROOT, "src/lib/past-papers.ts"));
const { parseReconstruction } = await import(
  path.join(ROOT, "src/lib/pastpapers-reconstruction.ts")
);
const { corpusPapersForCourse, corpusSpecsForCourse } = await import(
  path.join(ROOT, "src/lib/pastpapers-corpus.ts")
);

const contentDir = path.join(ROOT, "content");
const slugs = fs.readdirSync(contentDir).filter((d) =>
  fs.existsSync(path.join(contentDir, d, "questions.json")),
);

for (const slug of slugs) {
  const map = corpusSpecsForCourse(slug);
  const banks = JSON.parse(
    fs.readFileSync(path.join(contentDir, slug, "questions.json"), "utf8"),
  );
  const recons = collectPastPapers(banks);
  if (recons.length === 0) continue;
  const papers = map ? corpusPapersForCourse(slug) : [];
  const matched = new Set<string>();
  if (map) {
    const { matchedReconKeys } = await import(
      path.join(ROOT, "src/lib/pastpapers-reconstruction.ts")
    ).then((m) => m.matchReconstructions(papers, recons));
    for (const k of matchedReconKeys) matched.add(k);
  }
  const unmatched = recons.filter((r) => !matched.has(r.key));
  const curUnit = map?.specs[0]?.split("/").pop()?.toUpperCase();
  const scopeOuts: string[] = [];
  const inScopeUnmatched: string[] = [];
  const unparseable: string[] = [];
  for (const u of unmatched) {
    const p = parseReconstruction(u.date, u.number);
    if (!p) {
      unparseable.push(`${u.date}|${u.number}`);
      continue;
    }
    const variantOut = map?.variants ? !map.variants.includes(p.variant) : false;
    const unitOut = !!(p.unit && curUnit && p.unit !== curUnit);
    const tag = `${u.date} + ${u.number}`;
    if (variantOut || unitOut) scopeOuts.push(`${tag} (v=${p.variant}${p.unit ? ` unit=${p.unit}` : ""}${unitOut ? " UNIT-OUT" : ""})`);
    else inScopeUnmatched.push(tag);
  }
  const flag = scopeOuts.length || inScopeUnmatched.length || unparseable.length;
  console.log(
    `${slug}: recons=${recons.length} matched=${matched.size} scopeOut=${scopeOuts.length} inScopeUnmatched=${inScopeUnmatched.length} unparseable=${unparseable.length}${flag ? "  ◀" : ""}`,
  );
  for (const s of scopeOuts) console.log(`    SCOPE-OUT ${s}`);
  for (const s of inScopeUnmatched) console.log(`    in-scope-unmatched ${s}`);
  for (const s of unparseable) console.log(`    unparseable ${s}`);
}

// ── chemistry 2013 row spot-check ────────────────────────────────────────────
console.log("\n── chemistry 2013-01 1C recon detail ──");
const chemBanks = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "content/igcse-science-double-award-17-chemistry/questions.json"),
    "utf8",
  ),
);
const chemRecons = collectPastPapers(chemBanks);
const row2013 = chemRecons.find((r) => r.key === "january-2013-1c");
if (row2013) {
  console.log(`date=${row2013.date} number=${row2013.number} qns=${JSON.stringify(row2013.questionNumbers)}`);
  console.log(`per-question marks=${JSON.stringify(row2013.questions.map((q) => q.totalMarks))}`);
  const first = row2013.questions[0];
  const sp = first?.parts?.find((p: { sourcePaper?: unknown }) => p.sourcePaper)?.sourcePaper;
  console.log(`sourcePaper=${JSON.stringify(sp)}`);
  console.log(`question text head=${JSON.stringify((first?.question ?? first?.text ?? "").slice(0, 120))}`);
}
