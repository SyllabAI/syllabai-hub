/**
 * ADR-021 Content Package v0.2 — clean-environment restore + semantic
 * equivalence check (CONTENT_PACKAGE_V0_1.md §8 reconstruction test;
 * CONTENT_PACKAGE_V0_2.md adds the KG projection + scoped packages).
 *
 *   bun tools/content-package/restore.ts [packageDir] [restoreDir]
 *
 * Simulates the package's reason to exist: a sandbox reset wipes the hub's
 * content/ tree; the package must restore a known-good corpus snapshot
 * WITHOUT re-running the SME import, and the restored tree must be provably
 * equivalent to what was compiled.
 *
 *   known source snapshot → compile → package
 *        → CLEAN ENVIRONMENT (restoreDir starts empty)
 *        → restore package content/ → <restoreDir>/content/
 *        → inspect identities + provenance + lifecycle:
 *            R1  every restored file byte-identical to the package copy
 *            R2  the package's G1–G6 gates re-run against the RESTORED tree
 *                (loadCourseBundle on every course — identity, provenance,
 *                counts, within-course uniqueness, KG projection all hold
 *                post-restore)
 *            R3  semantic equivalence: re-derived note/spec/set/card/KG
 *                counts + every note body hash == the package SQLite
 *                projection
 *            R4  registry consistency: full scope — registry entries ==
 *                restored dirs; scoped package — dirs ⊆ registry and the
 *                excluded set == registry minus scope (the verbatim-registry
 *                rule: scoping never edits courses.json)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { loadCourseBundle, repoRoot, sha256File } from "./lib";

const argvFlags = process.argv.slice(2);
const positional = argvFlags.filter((a) => !a.startsWith("--"));
const pkgDir = positional[0] ? join(process.cwd(), positional[0]) : join(repoRoot(), "dist", "content-package");
const restoreDir = positional[1] ? join(process.cwd(), positional[1]) : join(repoRoot(), "dist", "restore-test");

let failures = 0;
const fail = (code: string, msg: string) => {
  failures++;
  console.error(`  FAIL [${code}] ${msg}`);
};
const ok = (msg: string) => console.log(`  ok   ${msg}`);

console.log(`restore: package=${pkgDir}`);
console.log(`restore: target=${restoreDir}`);

// ── clean environment ───────────────────────────────────────────────────
if (existsSync(restoreDir)) rmSync(restoreDir, { recursive: true, force: true });
mkdirSync(restoreDir, { recursive: true });

// ── restore ─────────────────────────────────────────────────────────────
// The package's content/ maps back onto the hub layout: content/courses.json
// → <restoreDir>/courses.json, content/content/<slug>/ → <restoreDir>/<slug>/,
// content/src/data/* → <restoreDir>/src-data/ (kept beside for provenance;
// the hub tree is the corpus target).
cpSync(join(pkgDir, "content", "courses.json"), join(restoreDir, "courses.json"));
cpSync(join(pkgDir, "content", "content"), join(restoreDir, "courses"), { recursive: true });
mkdirSync(join(restoreDir, "src-data"), { recursive: true });
cpSync(join(pkgDir, "content", "src", "data"), join(restoreDir, "src-data"), { recursive: true });
ok(`restored: ${readdirSync(join(restoreDir, "courses")).length} course dirs + registry + src-data`);

// ── R1 byte-identical restore ───────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(pkgDir, "MANIFEST.json"), "utf8"));
let checked = 0;
let byteDiff = 0;
for (const a of manifest.artifacts) {
  const inPkg = join(pkgDir, a.path);
  const rel = a.path.replace(/^content\/(content\/|src\/data\/|)/, "");
  // map: content/content/<slug>/f → courses/<slug>/f; content/src/data/f → src-data/f; content/courses.json → courses.json
  let target: string;
  if (a.path.startsWith("content/content/")) target = join(restoreDir, "courses", a.path.slice("content/content/".length));
  else if (a.path.startsWith("content/src/data/")) target = join(restoreDir, "src-data", a.path.slice("content/src/data/".length));
  else if (a.path === "content/courses.json") target = join(restoreDir, "courses.json");
  else continue;
  if (!existsSync(target)) {
    fail("R1", `restored file missing: ${target}`);
    continue;
  }
  if (sha256File(target) !== sha256File(inPkg)) {
    byteDiff++;
    fail("R1", `restored file differs from package: ${a.path}`);
  }
  checked++;
}
if (byteDiff === 0) ok(`R1: ${checked} restored files byte-identical to the package`);

// ── R2 gates re-run on the RESTORED tree ────────────────────────────────
// loadCourseBundle reads <root>/content/<slug>/ — point it at the restore
// by staging a fake root layout.
const fakeRoot = join(restoreDir, "_gateroot");
mkdirSync(join(fakeRoot, "content"), { recursive: true });
cpSync(join(restoreDir, "courses"), join(fakeRoot, "content"), { recursive: true });
const slugs = readdirSync(join(fakeRoot, "content")).sort();
const db = new Database(join(pkgDir, "database", "content.sqlite"), { readonly: true });

let expNotes = 0,
  expSets = 0,
  expCards = 0,
  expSpecs = 0,
  expMappings = 0,
  expKgNodes = 0,
  expKgEdges = 0,
  expKgMappings = 0;
const restoredNoteHashes = new Map<string, string>();
try {
  for (const slug of slugs) {
    const b = loadCourseBundle(slug, fakeRoot); // throws GateError on any violation (G1–G6)
    expNotes += b.notes.length;
    expSets += b.questionSets.length;
    expCards += b.flashcards.length;
    expSpecs += b.curriculum.nodes.filter((n: any) => n.family === "SPEC_POINT").length;
    expKgNodes += b.graph.nodes.length;
    expKgEdges += b.graph.edges.length;
    expKgMappings += b.graph.nodes.reduce((a: number, n: any) => a + (n.specPoints ?? []).length, 0);
    const codes = new Set(b.curriculum.nodes.filter((n: any) => n.family === "SPEC_POINT").map((n: any) => n.code));
    for (const n of b.notes) {
      expMappings += (n.specPointCodes ?? []).length;
      for (const c of n.specPointCodes ?? []) {
        if (!codes.has(c)) fail("R2", `${slug}/${n.noteId}: spec code ${c} unresolved in RESTORED tree`);
      }
      restoredNoteHashes.set(
        `${slug}\u0000${n.noteId}`,
        createHash("sha256").update(Buffer.from(String(n.bodyMd ?? ""), "utf8")).digest("hex"),
      );
    }
  }
  ok(`R2: G1–G6 gates hold on every restored course (${slugs.length} courses)`);
} catch (e: any) {
  fail("R2", `gate failed on restored tree: ${e.message}`);
}

// ── R3 semantic equivalence vs the package projection ───────────────────
if (failures === 0) {
  const count = (q: string) => (db.query(q).get() as any).n;
  const pairs: [string, number, number][] = [
    ["revision_note", count("SELECT COUNT(*) AS n FROM revision_note"), expNotes],
    ["exam_question_set", count("SELECT COUNT(*) AS n FROM exam_question_set"), expSets],
    ["flashcard", count("SELECT COUNT(*) AS n FROM flashcard"), expCards],
    ["specification_point", count("SELECT COUNT(*) AS n FROM specification_point"), expSpecs],
    ["note-spec mappings", count("SELECT COUNT(*) AS n FROM revision_note_specification_point"), expMappings],
    ["kg_node", count("SELECT COUNT(*) AS n FROM kg_node"), expKgNodes],
    ["kg_edge", count("SELECT COUNT(*) AS n FROM kg_edge"), expKgEdges],
    ["kg node-spec mappings", count("SELECT COUNT(*) AS n FROM kg_node_specification_point"), expKgMappings],
  ];
  for (const [name, got, exp] of pairs) {
    if (got !== exp) fail("R3", `${name}: package=${got} restored=${exp}`);
  }
  let hashMismatch = 0;
  for (const r of db.query("SELECT course_slug, note_id, body_sha256 FROM revision_note").all() as any[]) {
    if (restoredNoteHashes.get(`${r.course_slug}\u0000${r.note_id}`) !== r.body_sha256) hashMismatch++;
  }
  if (hashMismatch > 0) fail("R3", `${hashMismatch} note bodies differ between package DB and restored tree`);
  if (failures === 0) {
    ok(`R3: semantic equivalence — ${expNotes} notes, ${expSets} sets, ${expCards} cards, ${expMappings} mappings, KG ${expKgNodes}n/${expKgEdges}e, all body hashes`);
  }
}

// ── R4 registry consistency (scope-aware) ─────────────────────────────
// Full scope: registry entries == restored dirs (v0.1 behavior).
// Scoped package: the registry is copied VERBATIM by design (never edited to
// match the scope — that would fabricate a registry state that never
// existed); restored dirs ⊆ registry AND the excluded set == registry minus
// the recorded scope, so nothing is silently dropped or added.
const registry = JSON.parse(readFileSync(join(restoreDir, "courses.json"), "utf8"));
const regSlugs = new Set(registry.courses.map((c: any) => c.slug));
const dirSlugs = new Set(slugs);
const orphanDirs = [...dirSlugs].filter((s) => !regSlugs.has(s));
if (orphanDirs.length > 0) fail("R4", `restored dirs without registry entry: ${orphanDirs.join(", ")}`);
const scopeCourses: string[] = Array.isArray(manifest.scopeCourses) ? manifest.scopeCourses : [...regSlugs];
if (scopeCourses.length === regSlugs.size) {
  const missingDirs = [...regSlugs].filter((s) => !dirSlugs.has(s));
  if (missingDirs.length > 0) fail("R4", `registry entries without restored dir: ${missingDirs.join(", ")}`);
  if (failures === 0) ok(`R4: registry consistent (${regSlugs.size} entries == ${dirSlugs.size} dirs)`);
} else {
  const expected = new Set(scopeCourses);
  const extra = [...dirSlugs].filter((s) => !expected.has(s));
  const absent = scopeCourses.filter((s) => !dirSlugs.has(s));
  const excludedShouldBe = [...regSlugs].filter((s) => !expected.has(s));
  if (extra.length > 0) fail("R4", `restored dirs outside the recorded scope: ${extra.join(", ")}`);
  if (absent.length > 0) fail("R4", `scope courses without restored dir: ${absent.join(", ")}`);
  if (excludedShouldBe.length !== regSlugs.size - scopeCourses.length) {
    fail("R4", "excluded set does not equal registry minus scope");
  }
  if (failures === 0) {
    ok(`R4: scoped registry consistent (${dirSlugs.size} restored ⊆ ${regSlugs.size} registry; ${excludedShouldBe.length} excluded per scope, registry copied verbatim)`);
  }
}

db.close();
rmSync(fakeRoot, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\nrestore: FAILED — ${failures} failure(s)`);
  process.exit(1);
}
console.log(`restore: PASSED — clean-environment reconstruction is semantically equivalent to the compiled snapshot`);
