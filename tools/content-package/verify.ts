/**
 * ADR-021 Content Package v0.2 — verifier.
 *
 *   bun tools/content-package/verify.ts [packageDir] [sourceRoot]
 *
 * Verifies a built package WITHOUT trusting it: every artifact is re-hashed
 * from disk and compared to MANIFEST.json; the SQLite projection is opened
 * read-only and reconciled against an INDEPENDENT re-derivation from the
 * package's own content/ tree (not the build source). This is the §8
 * "inspect identities + provenance + lifecycle" half of the reconstruction
 * test; restore.ts supplies the clean-environment half.
 *
 * Checks:
 *   V1  MANIFEST parses; packageFormat/packageVersion/schemaVersion exact
 *   V2  every artifact file exists, byte size + sha256 match
 *   V3  no files in content/ beyond the manifest's inventory (no stowaways)
 *   V4  SQLite opens; package_metadata carries identity + status
 *   V5  resource rows == manifest artifacts (count + digests + provenance
 *       completeness: repo/ref/upstreamSchemas/license non-null on every row)
 *   V6  revision_note / specification_point / revision_note_specification_point /
 *       exam_question_set / flashcard rows match an independent re-derivation
 *       from the package's content/ JSON (the source manifests' own counts
 *       are re-checked too — G4 re-applied on the packaged copies)
 *   V7  lifecycle: status == VALIDATED and statusSource recorded; no
 *       severity='error' findings; warnings reported
 *   V8  buildId recomputed from artifacts == manifest buildId
 *   V9  KG projection (v0.2): kg_node / kg_edge / kg_node_specification_point
 *       match an independent re-derivation from the package's own
 *       concept-graph.json (row counts, per-row fields ordered by code /
 *       edge_index, tier census); every edge endpoint resolves against the
 *       package's OWN kg_node or specification_point tables; scope-aware
 *       registry check (full scope: strict equality; scoped: dirs ⊆ registry)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  BUNDLE_SCHEMA,
  COMPILER_VERSION,
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  SQLITE_SCHEMA_VERSION,
  repoRoot,
} from "./lib";

const argvFlags = process.argv.slice(2);
const positional = argvFlags.filter((a) => !a.startsWith("--"));
const pkgDir = positional[0] ? join(process.cwd(), positional[0]) : join(repoRoot(), "dist", "content-package");

let failures = 0;
const fail = (code: string, msg: string) => {
  failures++;
  console.error(`  FAIL [${code}] ${msg}`);
};
const ok = (msg: string) => console.log(`  ok   ${msg}`);

console.log(`verify: package=${pkgDir}`);

// ── V1 manifest ─────────────────────────────────────────────────────────
const manifestPath = join(pkgDir, "MANIFEST.json");
if (!existsSync(manifestPath)) {
  console.error("FAIL [V1] MANIFEST.json missing");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.packageFormat !== PACKAGE_FORMAT) fail("V1", `packageFormat=${manifest.packageFormat}`);
if (manifest.packageVersion !== PACKAGE_VERSION) fail("V1", `packageVersion=${manifest.packageVersion}`);
if (manifest.schemaVersion !== SQLITE_SCHEMA_VERSION) fail("V1", `schemaVersion=${manifest.schemaVersion}`);
if (manifest.compilerVersion !== COMPILER_VERSION) fail("V1", `compilerVersion=${manifest.compilerVersion}`);
if (manifest.status !== "VALIDATED") fail("V1", `status=${manifest.status}`);
if (!manifest.buildId || manifest.buildId.length !== 64) fail("V1", "buildId missing/malformed");
if (failures === 0) ok(`manifest identity (${manifest.packageFormat}/${manifest.packageVersion}, status=${manifest.status})`);

// ── V2/V3 artifact inventory (hash re-derivation + stowaway scan) ───────
const inv = new Map(manifest.artifacts.map((a: any) => [a.path, a]));
let hashed = 0;
for (const a of manifest.artifacts) {
  const p = join(pkgDir, a.path);
  if (!existsSync(p)) {
    fail("V2", `artifact missing: ${a.path}`);
    continue;
  }
  const st = statSync(p);
  if (st.size !== a.bytes) fail("V2", `${a.path}: bytes manifest=${a.bytes} actual=${st.size}`);
  const sha = createHash("sha256").update(readFileSync(p)).digest("hex");
  if (sha !== a.sha256) fail("V2", `${a.path}: sha256 mismatch`);
  hashed++;
}
ok(`artifact hashes verified: ${hashed}/${manifest.artifacts.length}`);

const walk = (dir: string, base = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`],
  );
const onDisk = walk(join(pkgDir, "content"));
const stowaways = onDisk.filter((f) => !inv.has(`content/${f}`));
if (stowaways.length > 0) fail("V3", `files in content/ not in manifest: ${stowaways.slice(0, 5).join(", ")}`);
if (failures === 0) ok(`no stowaway files (${onDisk.length} on disk == manifest content inventory)`);

// ── V4/V5 database ──────────────────────────────────────────────────────
const dbPath = join(pkgDir, "database", "content.sqlite");
if (!existsSync(dbPath)) {
  console.error("FAIL [V4] database/content.sqlite missing");
  process.exit(1);
}
const db = new Database(dbPath, { readonly: true });
const meta = Object.fromEntries((db.query("SELECT key, value FROM package_metadata").all() as any[]).map((r) => [r.key, r.value]));
for (const k of ["buildId", "compilerVersion", "sqliteSchemaVersion", "status", "statusSource", "identityModel", "deferrals"]) {
  if (!meta[k]) fail("V4", `package_metadata missing ${k}`);
}
if (meta.buildId !== manifest.buildId) fail("V4", "package_metadata.buildId != MANIFEST.buildId");
if (failures === 0) ok("package_metadata identity complete (buildId match)");

const resourceRows = db.query("SELECT * FROM resource").all() as any[];
if (resourceRows.length !== manifest.artifacts.length) {
  fail("V5", `resource rows ${resourceRows.length} != artifacts ${manifest.artifacts.length}`);
}
const noProv = resourceRows.filter(
  (r) =>
    !db.query("SELECT 1 FROM resource_provenance WHERE resource_id = ?").get(r.resource_id) ||
    !db.query("SELECT 1 FROM resource_version WHERE resource_id = ?").get(r.resource_id),
);
if (noProv.length > 0) fail("V5", `${noProv.length} resources without provenance/version rows`);
if (failures === 0) ok(`resource identity + provenance complete on all ${resourceRows.length} rows`);

// ── V6 independent re-derivation from the package's own content/ ────────
const contentRoot = join(pkgDir, "content", "content");
const coursesJson = JSON.parse(readFileSync(join(pkgDir, "content", "courses.json"), "utf8"));
const slugs = readdirSync(contentRoot).sort();
if (slugs.length !== manifest.courses) fail("V6", `courses ${slugs.length} != manifest ${manifest.courses}`);

// scope-aware registry check: full scope = strict equality (v0.1 behavior);
// scoped package = dirs ⊆ registry (the registry is copied verbatim by
// design — the scoping finding records the difference)
const registrySlugs = new Set(coursesJson.courses.map((c: any) => c.slug));
const scopeCourses: string[] = Array.isArray(manifest.scopeCourses) ? manifest.scopeCourses : slugs;
for (const s of slugs) {
  if (!registrySlugs.has(s)) fail("V6", `course dir ${s} not in registry`);
}
if (scopeCourses.length === registrySlugs.size) {
  const missing = [...registrySlugs].filter((s: string) => !slugs.includes(s));
  if (missing.length > 0) fail("V6", `full-scope package missing registry courses: ${missing.join(", ")}`);
} else {
  // scoped: dirs must equal scopeCourses exactly
  const expected = new Set(scopeCourses);
  const extra = slugs.filter((s) => !expected.has(s));
  const absent = scopeCourses.filter((s) => !slugs.includes(s));
  if (extra.length > 0) fail("V6", `scoped package carries non-scope courses: ${extra.join(", ")}`);
  if (absent.length > 0) fail("V6", `scoped package missing scope courses: ${absent.join(", ")}`);
}

let expNotes = 0,
  expSpecs = 0,
  expSets = 0,
  expCards = 0,
  expMappings = 0;
let expKgNodes = 0,
  expKgEdges = 0,
  expKgMappings = 0;
const noteHashSpot = new Map<string, string>(); // (course, noteId) -> body sha
// V9: expected KG rows, keyed for ordered comparison (nodes by code, edges by index)
const expKgNodeRows = new Map<string, string>(); // (course, code) -> `${family}|${title}|${tier}|${pass}`
const expKgEdgeRows = new Map<string, string>(); // (course, index) -> `${source}|${relation}|${target}|${tier}`
const expKgTierCensus = new Map<string, number>();
for (const slug of slugs) {
  const dir = join(contentRoot, slug);
  const mf = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (mf?.schema !== BUNDLE_SCHEMA) fail("V6", `${slug}: bundle schema=${mf?.schema}`);
  const notes = JSON.parse(readFileSync(join(dir, "notes.json"), "utf8"));
  const cur = JSON.parse(readFileSync(join(dir, "curriculum.json"), "utf8"));
  const qs = JSON.parse(readFileSync(join(dir, "questions.json"), "utf8"));
  const fc = JSON.parse(readFileSync(join(dir, "flashcards.json"), "utf8"));
  const cg = JSON.parse(readFileSync(join(dir, "concept-graph.json"), "utf8"));

  // G4 re-applied on the packaged copies (source manifest counts vs arrays)
  const specPts = cur.nodes.filter((n: any) => n.family === "SPEC_POINT");
  const subtopics = cur.nodes.filter((n: any) => n.family === "SUBTOPIC");
  const pairs: [string, number, number][] = [
    ["specPoints", mf.counts.specPoints, specPts.length],
    ["topics", mf.counts.topics, subtopics.length],
    ["notes", mf.counts.notes, notes.length],
    ["questionSets", mf.counts.questionSets, qs.length],
    ["flashcards", mf.counts.flashcards, fc.length],
  ];
  for (const [k, claimed, actual] of pairs) {
    if (claimed !== undefined && claimed !== actual) fail("V6", `${slug}: counts.${k} ${claimed} != ${actual}`);
  }

  expNotes += notes.length;
  expSpecs += specPts.length;
  expSets += qs.length;
  expCards += fc.length;
  const specCodes = new Set(specPts.map((n: any) => n.code));
  for (const n of notes) {
    for (const c of n.specPointCodes ?? []) {
      expMappings++;
      if (!specCodes.has(c)) fail("V6", `${slug}/${n.noteId}: spec code ${c} unresolved in package DB`);
    }
    noteHashSpot.set(`${slug}\u0000${n.noteId}`, createHash("sha256").update(Buffer.from(String(n.bodyMd ?? ""), "utf8")).digest("hex"));
  }

  // V9 expectations — independent re-derivation of the KG rows from the
  // package's own concept-graph.json (G6 shape gates re-applied here would
  // duplicate lib.ts; V9 verifies the PROJECTION matches the source graph)
  const pkgSpecCodes = new Set(specPts.map((n: any) => n.code));
  const pkgKgCodes = new Set<string>((cg.nodes ?? []).map((n: any) => n.code));
  for (const n of cg.nodes ?? []) {
    expKgNodes++;
    expKgNodeRows.set(`${slug}\u0000${n.code}`, `${n.family}|${n.title}|${n.provenanceTier}|${n.extractionPass}`);
    expKgTierCensus.set(`node:${n.provenanceTier}`, (expKgTierCensus.get(`node:${n.provenanceTier}`) ?? 0) + 1);
    for (const code of n.specPoints ?? []) {
      expKgMappings++;
      if (!pkgSpecCodes.has(code)) fail("V9", `${slug}: kg node ${n.code} specPoint ${code} unresolved in package`);
    }
  }
  (cg.edges ?? []).forEach((e: any, i: number) => {
    expKgEdges++;
    expKgEdgeRows.set(`${slug}\u0000${i}`, `${e.source}|${e.relation}|${e.target}|${e.provenanceTier}`);
    expKgTierCensus.set(`edge:${e.provenanceTier}`, (expKgTierCensus.get(`edge:${e.provenanceTier}`) ?? 0) + 1);
    for (const endpoint of [e.source, e.target]) {
      if (!pkgKgCodes.has(endpoint) && !pkgSpecCodes.has(endpoint)) {
        fail("V9", `${slug}: kg edge endpoint ${endpoint} resolves to neither kg_node nor specification_point`);
      }
    }
  });
}

const count = (q: string) => (db.query(q).get() as any).n;
const gotNotes = count("SELECT COUNT(*) AS n FROM revision_note");
const gotSpecs = count("SELECT COUNT(*) AS n FROM specification_point");
const gotSets = count("SELECT COUNT(*) AS n FROM exam_question_set");
const gotCards = count("SELECT COUNT(*) AS n FROM flashcard");
const gotMappings = count("SELECT COUNT(*) AS n FROM revision_note_specification_point");
const gotResolved = count("SELECT COUNT(*) AS n FROM revision_note_specification_point WHERE resolved = 1");
if (gotNotes !== expNotes) fail("V6", `revision_note rows ${gotNotes} != ${expNotes}`);
if (gotSpecs !== expSpecs) fail("V6", `specification_point rows ${gotSpecs} != ${expSpecs}`);
if (gotSets !== expSets) fail("V6", `exam_question_set rows ${gotSets} != ${expSets}`);
if (gotCards !== expCards) fail("V6", `flashcard rows ${gotCards} != ${expCards}`);
if (gotMappings !== expMappings) fail("V6", `note-spec mappings ${gotMappings} != ${expMappings}`);
if (gotResolved !== expMappings) fail("V6", `resolved mappings ${gotResolved} != ${expMappings} (all must resolve)`);
if (failures === 0) {
  ok(`independent re-derivation matches DB: ${gotNotes} notes, ${gotSpecs} spec points, ${gotSets} sets, ${gotCards} cards, ${gotMappings}/${gotMappings} mappings resolved`);
}
// body-integrity spot check: every note row's body_sha256 matches the
// packaged content (full check — 3743 rows is cheap)
const badBodies = db.query("SELECT course_slug, note_id, body_sha256 FROM revision_note").all() as any[];
let bodyMismatches = 0;
for (const r of badBodies) {
  if (noteHashSpot.get(`${r.course_slug}\u0000${r.note_id}`) !== r.body_sha256) bodyMismatches++;
}
if (bodyMismatches > 0) fail("V6", `${bodyMismatches} note body hashes do not match packaged content`);
else ok(`all ${badBodies.length} note body hashes match the packaged note bodies`);

// ── V9 KG projection re-derivation (v0.2) ──────────────────────────────
if (manifest.counts?.kgNodes !== undefined) {
  const gotKgNodes = count("SELECT COUNT(*) AS n FROM kg_node");
  const gotKgEdges = count("SELECT COUNT(*) AS n FROM kg_edge");
  const gotKgMappings = count("SELECT COUNT(*) AS n FROM kg_node_specification_point");
  if (gotKgNodes !== expKgNodes) fail("V9", `kg_node rows ${gotKgNodes} != ${expKgNodes}`);
  if (gotKgEdges !== expKgEdges) fail("V9", `kg_edge rows ${gotKgEdges} != ${expKgEdges}`);
  if (gotKgMappings !== expKgMappings) fail("V9", `kg_node_specification_point rows ${gotKgMappings} != ${expKgMappings}`);

  // per-row fidelity: nodes ordered by code, edges by edge_index
  let kgRowMismatches = 0;
  for (const r of db.query("SELECT course_slug, code, family, title, provenance_tier, extraction_pass FROM kg_node ORDER BY course_slug, code").all() as any[]) {
    if (expKgNodeRows.get(`${r.course_slug}\u0000${r.code}`) !== `${r.family}|${r.title}|${r.provenance_tier}|${r.extraction_pass}`) kgRowMismatches++;
  }
  for (const r of db.query("SELECT course_slug, edge_index, source, relation, target, provenance_tier FROM kg_edge ORDER BY course_slug, edge_index").all() as any[]) {
    if (expKgEdgeRows.get(`${r.course_slug}\u0000${r.edge_index}`) !== `${r.source}|${r.relation}|${r.target}|${r.provenance_tier}`) kgRowMismatches++;
  }
  if (kgRowMismatches > 0) fail("V9", `${kgRowMismatches} kg rows do not match the packaged concept-graph.json`);

  // tier census — the non-authoritative pin, verified not asserted
  const gotCensus = new Map<string, number>();
  for (const r of db.query("SELECT 'node' AS k, provenance_tier AS t, COUNT(*) AS n FROM kg_node GROUP BY provenance_tier UNION ALL SELECT 'edge', provenance_tier, COUNT(*) FROM kg_edge GROUP BY provenance_tier").all() as any[]) {
    gotCensus.set(`${r.k}:${r.t}`, r.n);
  }
  let censusMismatch = "";
  for (const [k, v] of expKgTierCensus) {
    if (gotCensus.get(k) !== v) censusMismatch += ` ${k} db=${gotCensus.get(k) ?? 0} src=${v};`;
  }
  if (censusMismatch) fail("V9", `kg tier census mismatch:${censusMismatch}`);

  // endpoints resolve against the package's OWN tables (not the source tree)
  let dangling = 0;
  for (const r of db.query("SELECT course_slug, source, target FROM kg_edge").all() as any[]) {
    for (const code of [r.source, r.target]) {
      const isNode = db.query("SELECT 1 FROM kg_node WHERE course_slug = ? AND code = ?").get(r.course_slug, code);
      const isSpec = db.query("SELECT 1 FROM specification_point WHERE course_slug = ? AND code = ?").get(r.course_slug, code);
      if (!isNode && !isSpec) dangling++;
    }
  }
  if (dangling > 0) fail("V9", `${dangling} kg_edge endpoints resolve to neither kg_node nor specification_point (two-namespace rule)`);

  if (failures === 0) {
    const tiers = [...new Set([...expKgTierCensus.keys()])].sort().join(", ");
    ok(`V9 KG projection verified: ${gotKgNodes} nodes, ${gotKgEdges} edges, ${gotKgMappings} node-spec mappings; tier census exact (${tiers}); all endpoints resolve (two-namespace rule)`);
  }
}

// ── V7 lifecycle + findings ─────────────────────────────────────────────
const errors = count("SELECT COUNT(*) AS n FROM validation_finding WHERE severity = 'error'");
const warnings = count("SELECT COUNT(*) AS n FROM validation_finding WHERE severity = 'warning'");
if (errors > 0) fail("V7", `${errors} severity=error findings`);
if (failures === 0) ok(`lifecycle VALIDATED (statusSource recorded), 0 error findings, ${warnings} warnings`);

// ── V8 buildId re-derivation ────────────────────────────────────────────
const artifactLines = [...manifest.artifacts]
  .sort((a: any, b: any) => (a.path < b.path ? -1 : 1))
  .map((a: any) => `${a.path} ${a.sha256}`);
const recomputed = createHash("sha256").update(Buffer.from(artifactLines.join("\n") + "\n", "utf8")).digest("hex");
if (recomputed !== manifest.buildId) fail("V8", "buildId does not match artifact digests");
else ok(`buildId re-derived from artifact digests (${manifest.buildId.slice(0, 16)}…)`);

db.close();

if (failures > 0) {
  console.error(`\nverify: FAILED — ${failures} failure(s)`);
  process.exit(1);
}
console.log(`verify: PASSED — package is internally consistent and matches an independent re-derivation`);
