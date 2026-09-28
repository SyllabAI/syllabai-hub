/**
 * ADR-021 Content Package v0.2 — compiler.
 *
 *   bun tools/content-package/compile.ts [sourceRoot] [outDir] [--courses=a,b]
 *
 * Builds a portable content package from the hub's committed corpus:
 *
 *   <outDir>/                       (default dist/content-package)
 *   ├── MANIFEST.json               identity + per-artifact SHA-256 + counts
 *   ├── content/                    verbatim copies (courses.json, <slug>/…,
 *   │                               pastpapers index + blueprints)
 *   └── database/content.sqlite     the queryable projection (v0.2: + KG)
 *
 * v0.2 (CONTENT_PACKAGE_V0_2.md — ADR-021 forward gates):
 *   - KG projection (kg_node / kg_node_specification_point / kg_edge):
 *     non-authoritative, tiers preserved verbatim, G6 fail-closed gates
 *   - scope selection: --courses=<slugs> builds a bounded package (the
 *     default remains the full hub corpus); scopeId is deterministic
 *
 * Fail-closed gates: G1 inventory, G2 schema, G3 provenance, G4 counts
 * reconciliation, G5 within-course identity, G6 KG projection (lib.ts).
 * Cross-course note-id sharing and unresolved spec codes are FINDINGS, not
 * failures — the corpus measurement that produced the composite identity
 * model.
 *
 * Determinism target: same source tree + same compiler → byte-identical
 * content.sqlite and identical artifact hashes; buildId is derived from the
 * artifact digests (NOT the clock). createdAt stays informational (and is
 * therefore EXCLUDED from the determinism claim — MANIFEST.json bytes differ
 * across compiles; the sqlite + buildId do not). The determinism claim is
 * only as good as the selftest measurement.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, statSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  BUNDLE_FILES,
  COMPILER_VERSION,
  GateError,
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  SQLITE_DDL,
  SQLITE_SCHEMA_VERSION,
  BUNDLE_SCHEMA,
  contentDir,
  courseSlugs,
  loadCourseBundle,
  repoRoot,
  sha256Bytes,
  sha256File,
} from "./lib";

// args: positional [sourceRoot] [outDir] + optional --courses=<slug,…> scope
// and --out=<dir> (equivalent to the outDir positional)
const argvFlags = process.argv.slice(2);
const positional = argvFlags.filter((a) => !a.startsWith("--"));
const scopeFlag = argvFlags.find((a) => a.startsWith("--courses="));
const outFlag = argvFlags.find((a) => a.startsWith("--out="));
const root = positional[0] ? join(process.cwd(), positional[0]) : repoRoot();
const outDir = outFlag
  ? join(process.cwd(), outFlag.slice("--out=".length))
  : positional[1]
    ? join(process.cwd(), positional[1])
    : join(root, "dist", "content-package");

console.log(`compile: root=${root}`);
console.log(`compile: out=${outDir}`);

const available = courseSlugs(root);
if (available.length === 0) throw new GateError("G1-inventory", "no course directories under content/");
let slugs = available;
if (scopeFlag) {
  const requested = scopeFlag.slice("--courses=".length).split(",").map((s) => s.trim()).filter(Boolean).sort();
  const unknown = requested.filter((s) => !available.includes(s));
  if (unknown.length > 0) throw new GateError("G1-inventory", `--courses unknown slugs: ${unknown.join(", ")}`);
  slugs = requested;
}
const fullCorpus = slugs.length === available.length;
// scopeId — deterministic, filename-safe identity for the distribution name
const scopeId = fullCorpus
  ? "hub-corpus"
  : `scope-${sha256Bytes(Buffer.from(slugs.join("\n") + "\n", "utf8")).slice(0, 8)}`;
console.log(`compile: ${slugs.length} courses (scope=${scopeId}${fullCorpus ? "" : `, ${available.length} available`})`);

// The package is a derived snapshot — always start from a clean output so a
// recompile can never merge with stale artifacts (determinism precondition).
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "content"), { recursive: true });
mkdirSync(join(outDir, "database"), { recursive: true });

const db = new Database(join(outDir, "database", "content.sqlite"));
db.exec("BEGIN");
db.exec(SQLITE_DDL);

const artifacts: { path: string; sha256: string; type: string; bytes: number }[] = [];
const findings: { course_slug: string | null; severity: string; kind: string; detail: string }[] = [];
const noteIdOwners = new Map<string, string>(); // cross-course sharing measurement
let sharedNoteIds = 0;

const insMeta = db.prepare("INSERT INTO package_metadata (key, value) VALUES (?, ?)");
const insResource = db.prepare(
  "INSERT INTO resource (course_slug, path, type, sha256, bytes, upstream_schema) VALUES (?,?,?,?,?,?)",
);
const insVersion = db.prepare("INSERT INTO resource_version (resource_id, generated_utc, upstream_ref) VALUES (?,?,?)");
const insProv = db.prepare(
  "INSERT INTO resource_provenance (resource_id, source_repo, source_ref, upstream_schemas, license) VALUES (?,?,?,?,?)",
);
const insSpec = db.prepare(
  "INSERT INTO specification_point (course_slug, code, title, parent_code, provenance_tier) VALUES (?,?,?,?,?)",
);
const insNote = db.prepare(
  `INSERT INTO revision_note (course_slug, note_id, title, section_slug, topic_slug, updated_at, body_sha256, body_bytes, source_url, guided_study)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
);
const insNoteSpec = db.prepare(
  "INSERT INTO revision_note_specification_point (course_slug, note_id, spec_code, resolved) VALUES (?,?,?,?)",
);
const insSet = db.prepare(
  `INSERT INTO exam_question_set (course_slug, set_slug, name, section_slug, topic_slug, question_count, part_count, mark_total)
   VALUES (?,?,?,?,?,?,?,?)`,
);
const insCard = db.prepare(
  "INSERT INTO flashcard (course_slug, card_id, deck_slug, card_type, spec_point_code, provenance_tier) VALUES (?,?,?,?,?,?)",
);
const insKgNode = db.prepare(
  "INSERT INTO kg_node (course_slug, code, family, title, aliases, summary, provenance_tier, extraction_pass) VALUES (?,?,?,?,?,?,?,?)",
);
const insKgNodeSpec = db.prepare(
  "INSERT INTO kg_node_specification_point (course_slug, node_code, spec_code) VALUES (?,?,?)",
);
const insKgEdge = db.prepare(
  `INSERT INTO kg_edge (course_slug, edge_index, source, relation, target, role, evidence_quote, provenance_tier, extraction_pass, derivation_method)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
);
const insFinding = db.prepare(
  "INSERT INTO validation_finding (course_slug, severity, kind, detail) VALUES (?,?,?,?)",
);

function copyArtifact(absSrc: string, pkgRel: string, type: string) {
  const dest = join(outDir, pkgRel);
  mkdirSync(join(dest, ".."), { recursive: true });
  copyFileSync(absSrc, dest);
  const st = statSync(dest);
  artifacts.push({ path: pkgRel, sha256: sha256File(dest), type, bytes: st.size });
}

// ── registry + pastpapers payloads (course-agnostic artifacts) ──────────
// Hub-owned derived files, but they carry real provenance (source repo +
// corpus treeSha in their meta blocks) — resource rows record it.
function hubArtifactResource(pkgRel: string, provenance: { repo: string; ref: string; schema: string | null; generatedUtc: string | null; license: string }) {
  const art = artifacts.find((a) => a.path === pkgRel)!;
  db.run(
    "INSERT INTO resource (course_slug, path, type, sha256, bytes, upstream_schema) VALUES (?,?,?,?,?,?)",
    null,
    pkgRel,
    art.type,
    art.sha256,
    art.bytes,
    provenance.schema,
  );
  const rid = (db.query("SELECT last_insert_rowid() AS id").get() as any).id;
  insVersion.run(rid, provenance.generatedUtc ?? "unknown", provenance.ref);
  insProv.run(rid, provenance.repo, provenance.ref, provenance.schema ?? "n/a", provenance.license);
}

copyArtifact(join(contentDir(root), "courses.json"), "content/courses.json", "COURSE_REGISTRY");
hubArtifactResource("content/courses.json", {
  repo: "SyllabAI/syllabai-hub",
  ref: "content-as-committed",
  schema: "syllabai-demo.course-registry/1.1",
  generatedUtc: null,
  license: "hub-internal registry — course licenses live in each bundle manifest",
});
for (const f of [
  { src: "src/data/pastpapers-index.json", type: "PASTPAPERS_INDEX" },
  { src: "src/data/pastpapers-blueprints.json", type: "PASTPAPERS_BLUEPRINTS" },
]) {
  const p = join(root, f.src);
  if (existsSync(p)) {
    copyArtifact(p, `content/${f.src}`, f.type);
    const meta = JSON.parse(readFileSync(p, "utf8")).meta ?? {};
    hubArtifactResource(`content/${f.src}`, {
      repo: meta.source ?? "SyllabAI/syllabai-pastpapers",
      ref: meta.treeSha ? `tree:${meta.treeSha}` : "tree:unknown",
      schema: null,
      generatedUtc: meta.generatedAt ?? null,
      license: "derived inventory — per-dir manifest.yaml is authoritative (AI-IDENTIFIED provenance)",
    });
  }
}

// ── per-course bundles ──────────────────────────────────────────────────
for (const slug of slugs) {
  const src = loadCourseBundle(slug, root); // gates G1–G5 fail closed here
  const pkgDir = `content/content/${slug}`;
  for (const f of BUNDLE_FILES) {
    copyArtifact(join(src.dir, f), `${pkgDir}/${f}`, f === "manifest.json" ? "BUNDLE_MANIFEST" : "BUNDLE_JSON");
  }

  // resource identity + provenance rows (one per bundle file)
  for (const f of BUNDLE_FILES) {
    const path = `${pkgDir}/${f}`;
    const art = artifacts.find((a) => a.path === path)!;
    const schema = f === "manifest.json" ? BUNDLE_SCHEMA : (src.manifest?.importSource?.upstreamSchemas ?? []).join(",");
    db.run(
      "INSERT INTO resource (course_slug, path, type, sha256, bytes, upstream_schema) VALUES (?,?,?,?,?,?)",
      slug,
      path,
      art.type,
      art.sha256,
      art.bytes,
      schema || null,
    );
    const rid = (db.query("SELECT last_insert_rowid() AS id").get() as any).id;
    insVersion.run(rid, src.manifest.generatedUtc, src.manifest.importSource.ref);
    insProv.run(
      rid,
      src.manifest.importSource.repo,
      src.manifest.importSource.ref,
      JSON.stringify(src.manifest.importSource.upstreamSchemas),
      src.manifest.license,
    );
  }

  // specification points from curriculum truth
  for (const n of src.curriculum?.nodes ?? []) {
    if (n?.family === "SPEC_POINT") {
      insSpec.run(slug, n.code, n.title ?? "", n.parents?.[0] ?? null, n.provenanceTier ?? null);
    }
  }
  const specCodes = new Set<string>(
    (src.curriculum?.nodes ?? []).filter((n: any) => n?.family === "SPEC_POINT").map((n: any) => n.code),
  );

  // notes + spec mappings (composite identity; resolution measured honestly)
  for (const n of src.notes) {
    const body = Buffer.from(String(n.bodyMd ?? ""), "utf8");
    insNote.run(
      slug,
      n.noteId,
      n.title ?? "",
      n.sectionSlug ?? null,
      n.topicSlug ?? null,
      n.updatedAt ?? null,
      sha256Bytes(body),
      body.length,
      n.sourceUrl ?? null,
      n.guidedStudy ? 1 : 0,
    );
    const prevOwner = noteIdOwners.get(n.noteId);
    if (prevOwner !== undefined && prevOwner !== slug) {
      sharedNoteIds++;
      if (sharedNoteIds <= 50) {
        findings.push({
          course_slug: slug,
          severity: "info",
          kind: "note_id_shared_across_courses",
          detail: `${n.noteId} also in ${prevOwner} (linear ↔ modular spec sharing)`,
        });
      }
    } else {
      noteIdOwners.set(n.noteId, slug);
    }
    for (const code of n.specPointCodes ?? []) {
      const resolved = specCodes.has(code) ? 1 : 0;
      insNoteSpec.run(slug, n.noteId, code, resolved);
      if (!resolved) {
        findings.push({
          course_slug: slug,
          severity: "warning",
          kind: "spec_code_unresolved",
          detail: `note ${n.noteId}: code "${code}" not in ${slug} curriculum SPEC_POINT set`,
        });
      }
    }
  }

  // question sets (identity + coverage only)
  for (const t of src.questionSets) {
    const qs = t.questions ?? [];
    const partCount = qs.reduce((a: number, q: any) => a + (q?.parts?.length ?? 0), 0);
    const markTotal = qs.reduce(
      (a: number, q: any) => a + (q?.parts ?? []).reduce((b: number, p: any) => b + (Number(p?.marks) || 0), 0),
      0,
    );
    insSet.run(slug, t.slug, t.name, t.sectionSlug ?? t.section ?? null, t.topicSlug ?? null, qs.length, partCount, markTotal);
  }

  // flashcards (identity + coverage only — no front/back content)
  for (const c of src.flashcards) {
    insCard.run(slug, c.id, c.deckSlug ?? null, c.cardType ?? null, c.specPointCode ?? null, c.provenanceTier ?? null);
  }

  // KG projection (v0.2) — non-authoritative; tiers preserved verbatim.
  // G6 already gated shape/vocabulary/endpoints in loadCourseBundle.
  for (const n of src.graph.nodes) {
    insKgNode.run(
      slug,
      n.code,
      n.family,
      n.title,
      JSON.stringify(n.aliases ?? []),
      n.summary ?? null,
      n.provenanceTier,
      n.extractionPass,
    );
    for (const code of n.specPoints ?? []) insKgNodeSpec.run(slug, n.code, code);
  }
  src.graph.edges.forEach((e: any, i: number) => {
    insKgEdge.run(
      slug,
      i,
      e.source,
      e.relation,
      e.target,
      e.role ?? null,
      e.evidenceQuote ?? null,
      e.provenanceTier,
      e.extractionPass,
      e.derivationMethod ?? null,
    );
  });
  if (src.graph.validationGate) {
    findings.push({
      course_slug: slug,
      severity: "info",
      kind: "kg_validation_gate",
      detail: src.graph.validationGate,
    });
  }
}

// ── findings + metadata ─────────────────────────────────────────────────
// "sections": upstream-declared count with no verifiable local derivation
// (measured 2026-09-29: == distinct note sectionSlug in 29/49, == distinct
// qset section in 24/49, == neither in 20/49) — recorded, not adjudicated.
findings.push({
  course_slug: null,
  severity: "info",
  kind: "sections_count_not_locally_derivable",
  detail:
    "manifest.counts.sections is upstream-declared (syllabai-resources import); no single derivation from the committed bundle files reproduces it for all courses — see lib.ts G4 note",
});
if (!fullCorpus) {
  findings.push({
    course_slug: null,
    severity: "info",
    kind: "scoped_package",
    detail: `scoped package (scopeId=${scopeId}): registry copied verbatim lists ${available.length} courses, package carries ${slugs.length} (${slugs.join(", ")}) — registry ⊇ package by design`,
  });
}
// KG census finding — the non-authoritative pin, recorded from measurement
{
  const kgTotal = (db.query("SELECT COUNT(*) AS n FROM kg_node").get() as any).n + (db.query("SELECT COUNT(*) AS n FROM kg_edge").get() as any).n;
  const kgPromoted =
    (db.query("SELECT COUNT(*) AS n FROM kg_node WHERE provenance_tier NOT IN ('AI_SUGGESTED')").get() as any).n +
    (db.query("SELECT COUNT(*) AS n FROM kg_edge WHERE provenance_tier NOT IN ('AI_SUGGESTED')").get() as any).n;
  if (kgTotal > 0) {
    findings.push({
      course_slug: null,
      severity: "info",
      kind: "kg_projection_non_authoritative",
      detail: `${kgTotal} KG rows projected; ${kgPromoted} carry a tier other than AI_SUGGESTED. The KG projection preserves provenance tiers verbatim and NEVER confers authority, curriculum/KG truth, or learner-serving eligibility (CONTENT_PACKAGE_V0_2.md; the pilot's own validationGate — operator review pending — is preserved verbatim in validation_finding kind=kg_validation_gate).`,
    });
  }
}
for (const f of findings) insFinding.run(f.course_slug, f.severity, f.kind, f.detail);

const noteCount = (db.query("SELECT COUNT(*) AS n FROM revision_note").get() as any).n;
const noteSpecCount = (db.query("SELECT COUNT(*) AS n FROM revision_note_specification_point").get() as any).n;
const resolvedCount = (db.query("SELECT COUNT(*) AS n FROM revision_note_specification_point WHERE resolved = 1").get() as any).n;
const setCount = (db.query("SELECT COUNT(*) AS n FROM exam_question_set").get() as any).n;
const cardCount = (db.query("SELECT COUNT(*) AS n FROM flashcard").get() as any).n;
const specCount = (db.query("SELECT COUNT(*) AS n FROM specification_point").get() as any).n;
const kgNodeCount = (db.query("SELECT COUNT(*) AS n FROM kg_node").get() as any).n;
const kgEdgeCount = (db.query("SELECT COUNT(*) AS n FROM kg_edge").get() as any).n;
const kgMappingCount = (db.query("SELECT COUNT(*) AS n FROM kg_node_specification_point").get() as any).n;
const kgCourseCount = (db.query("SELECT COUNT(DISTINCT course_slug) AS n FROM kg_node").get() as any).n;
const warnings = (db.query("SELECT COUNT(*) AS n FROM validation_finding WHERE severity = 'warning'").get() as any).n;

// buildId = digest over sorted artifact digests (deterministic; clock-free)
const artifactLines = [...artifacts].sort((a, b) => (a.path < b.path ? -1 : 1)).map((a) => `${a.path} ${a.sha256}`);
const buildId = sha256Bytes(Buffer.from(artifactLines.join("\n") + "\n", "utf8"));

insMeta.run("packageFormat", PACKAGE_FORMAT);
insMeta.run("packageVersion", PACKAGE_VERSION);
insMeta.run("scope", fullCorpus ? "hub-corpus" : `courses:${slugs.length}`);
insMeta.run("scopeId", scopeId);
insMeta.run("scopeCourses", slugs.join(","));
insMeta.run("buildId", buildId);
insMeta.run("compilerVersion", COMPILER_VERSION);
insMeta.run("sqliteSchemaVersion", SQLITE_SCHEMA_VERSION);
insMeta.run("status", "VALIDATED");
insMeta.run(
  "statusSource",
  "source bundle manifests (syllabai-resources import provenance + license) + hub prebuild corpus gate (verify_corpus_23a.ts)",
);
insMeta.run("courseCount", String(slugs.length));
insMeta.run("noteCount", String(noteCount));
insMeta.run("specificationPointCount", String(specCount));
insMeta.run("questionSetCount", String(setCount));
insMeta.run("flashcardCount", String(cardCount));
insMeta.run(
  "identityModel",
  "composite (course_slug, id) — note ids are shared across linear↔modular spec variants upstream (1205/3743 rows measured); recorded as findings",
);
insMeta.run(
  "deferrals",
  "paper/paper_question/question_part/mark_scheme/mark_point/parser_run deferred: payload carries SME-derived question sets, not parsed QP/MS artifacts (no source-PDF/parser provenance exists to preserve — fabricating it would violate fail-closed provenance). kg_node/kg_edge/kg_node_specification_point ADDED in v0.2 (CONTENT_PACKAGE_V0_2.md) as a non-authoritative projection — tiers preserved verbatim, never conferring authority or serving eligibility.",
);
insMeta.run(
  "additiveTables",
  "exam_question_set + flashcard are additive identity/coverage projections (no bodies, no semantics) — schema notes recorded here per the ADR's governed-projection rule",
);
insMeta.run(
  "kgProjection",
  `non-authoritative (CONTENT_PACKAGE_V0_2.md): ${kgNodeCount} nodes + ${kgEdgeCount} edges across ${kgCourseCount} course(s); tiers preserved verbatim; never curriculum/KG truth, never learner-servable`,
);

db.exec("COMMIT");
db.exec("VACUUM"); // canonical layout → deterministic page sequence
db.close();

const manifest = {
  packageFormat: PACKAGE_FORMAT,
  packageVersion: PACKAGE_VERSION,
  scope: fullCorpus ? "hub-corpus" : `courses:${slugs.length}`,
  scopeId,
  scopeCourses: slugs,
  buildId,
  compilerVersion: COMPILER_VERSION,
  schemaVersion: SQLITE_SCHEMA_VERSION,
  createdAt: new Date().toISOString(),
  status: "VALIDATED",
  courses: slugs.length,
  counts: {
    specificationPoints: specCount,
    revisionNotes: noteCount,
    noteSpecMappings: noteSpecCount,
    noteSpecMappingsResolved: resolvedCount,
    examQuestionSets: setCount,
    flashcards: cardCount,
    kgNodes: kgNodeCount,
    kgEdges: kgEdgeCount,
    kgNodeSpecMappings: kgMappingCount,
    kgCourses: kgCourseCount,
    validationFindings: findings.length,
    warnings,
  },
  findings: {
    noteIdSharedAcrossCourses: sharedNoteIds,
    specCodeUnresolved: noteSpecCount - resolvedCount,
  },
  artifacts,
};
writeFileSync(join(outDir, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(`compile: DONE — ${slugs.length} courses, ${noteCount} notes, ${setCount} sets, ${cardCount} cards, KG ${kgNodeCount}n/${kgEdgeCount}e (${kgCourseCount} course)`);
console.log(`compile: buildId=${buildId.slice(0, 16)}…`);
console.log(`compile: findings — shared note ids: ${sharedNoteIds}, unresolved spec codes: ${noteSpecCount - resolvedCount}`);
console.log(`compile: artifacts: ${artifacts.length} (${(artifacts.reduce((a, x) => a + x.bytes, 0) / 1e6).toFixed(1)} MB)`);
