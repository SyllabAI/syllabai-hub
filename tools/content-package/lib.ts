/**
 * ADR-021 Content Package v0.1 — shared library (compile/verify/restore).
 *
 * Governing docs (ledger repo):
 *   - ADR_021_CONTENT_COMPILER_AND_PORTABLE_CONTENT_PACKAGE.md
 *   - CONTENT_PACKAGE_V0_1.md (the v0.1 contract)
 *   - CONTENT_COMPILER_AND_PACKAGE_ARCHITECTURE.md
 *
 * Identity model — MEASURED, not guessed (recon 2026-09-29, all 49 courses):
 *   - note_id is NOT globally unique: 1205 of 3743 note rows share ids across
 *     courses (linear ↔ modular spec variants share SME notes, e.g.
 *     igcse-biology-19 <-> igcse-biology-modular-24-unit-1: 43 shared).
 *     Package identity is therefore COMPOSITE (course_slug, note_id) — the
 *     same scoping the hub's own URLs use (/courses/[course]/revision-notes/
 *     [noteId]). Cross-course sharing is RECORDED as a validation finding,
 *     not a gate failure; a collision WITHIN one course fails closed.
 *   - spec-point codes are course-local ("1.1") → composite (course, code).
 *   - question sets / flashcards: same composite treatment, measured in the
 *     compiler gates.
 *
 * v0.1 schema boundaries (CONTENT_PACKAGE_V0_1.md §6/§9):
 *   - the spec's paper/mark-scheme/parser_run tables are DEFERRED: this
 *     payload carries SME-derived question sets, not parsed QP/MS artifacts
 *     (no source PDF sha / parser runs exist for them — faking those fields
 *     would fabricate provenance). Recorded in package_metadata.
 *   - KG tables deferred per §6.
 *   - exam_question_set / flashcard are ADDITIVE identity+coverage tables
 *     (no bodies, no semantics) so QA can query coverage offline.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const PACKAGE_FORMAT = "syllabai-content";
export const PACKAGE_VERSION = "0.1";
export const COMPILER_VERSION = "content-package-compiler/0.1.0";
export const SQLITE_SCHEMA_VERSION = "content-package-sqlite/0.1";
export const BUNDLE_SCHEMA = "syllabai-demo.content-bundle/2.0";

export const BUNDLE_FILES = [
  "manifest.json",
  "curriculum.json",
  "concept-graph.json",
  "notes.json",
  "questions.json",
  "flashcards.json",
  "learner-sim.json",
] as const;

export type BundleFile = (typeof BUNDLE_FILES)[number];

export interface SourceCourse {
  slug: string;
  dir: string;
  manifest: any;
  curriculum: any;
  notes: any[];
  questionSets: any[];
  flashcards: any[];
}

export function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

export function sha256Bytes(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}

export function repoRoot(): string {
  // tools/content-package/<this file> → repo root two levels up
  return join(import.meta.dir, "..", "..");
}

export function contentDir(root = repoRoot()): string {
  return join(root, "content");
}

/** Fail-closed error carrying the gate that tripped. */
export class GateError extends Error {
  constructor(public gate: string, message: string) {
    super(`[${gate}] ${message}`);
    this.name = "GateError";
  }
}

/** Course directories present under content/ (sorted for determinism). */
export function courseSlugs(root = repoRoot()): string[] {
  const dir = contentDir(root);
  return readdirSync(dir)
    .filter((d) => statSync(join(dir, d)).isDirectory())
    .sort();
}

/**
 * Load one course bundle with the §7 identity/provenance gates applied.
 * Throws GateError (fail closed) on any violation; measures as it goes so
 * the compiler can record findings for everything that is a FINDING rather
 * than a FAILURE (cross-course id sharing, unresolved spec codes).
 */
export function loadCourseBundle(slug: string, root = repoRoot()): SourceCourse {
  const dir = join(contentDir(root), slug);
  if (!existsSync(dir)) throw new GateError("G1-inventory", `no content dir for ${slug}`);

  for (const f of BUNDLE_FILES) {
    if (!existsSync(join(dir, f))) {
      throw new GateError("G1-inventory", `${slug}: missing ${f}`);
    }
  }

  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (manifest?.schema !== BUNDLE_SCHEMA) {
    throw new GateError("G2-schema", `${slug}: schema=${String(manifest?.schema)} (expected ${BUNDLE_SCHEMA})`);
  }
  for (const field of ["generatedUtc", "importSource", "curriculum", "license", "counts"]) {
    if (manifest?.[field] === undefined) {
      throw new GateError("G3-provenance", `${slug}: manifest missing ${field}`);
    }
  }
  const imp = manifest.importSource ?? {};
  for (const field of ["repo", "ref", "upstreamSchemas"]) {
    if (!imp?.[field]) throw new GateError("G3-provenance", `${slug}: importSource missing ${field}`);
  }

  const curriculum = JSON.parse(readFileSync(join(dir, "curriculum.json"), "utf8"));
  const notes = JSON.parse(readFileSync(join(dir, "notes.json"), "utf8"));
  const questionSets = JSON.parse(readFileSync(join(dir, "questions.json"), "utf8"));
  const flashcards = JSON.parse(readFileSync(join(dir, "flashcards.json"), "utf8"));

  // G4 — counts reconciliation: the source manifest's own counts must match
  // the actual arrays (identity integrity of the bundle, not our guess).
  // MEASURED semantics (49/49 courses): topics == SUBTOPIC node count;
  // specPoints == SPEC_POINT nodes; the rest are direct array lengths.
  // "sections" is upstream-declared with NO verifiable local derivation
  // (== distinct note sectionSlug in 29/49, == distinct qset section in
  // 24/49, == neither in 20/49) — deliberately NOT a hard gate; the
  // compiler records it as an informational finding instead of silently
  // swallowing or fabricating a derivation.
  const specPoints = curriculum?.nodes?.filter((n: any) => n?.family === "SPEC_POINT") ?? [];
  const subtopics = curriculum?.nodes?.filter((n: any) => n?.family === "SUBTOPIC") ?? [];
  const actual = {
    topics: subtopics.length,
    specPoints: specPoints.length,
    notes: notes.length,
    questionSets: questionSets.length,
    questions: questionSets.reduce((a: number, t: any) => a + (t?.questions?.length ?? 0), 0),
    parts: questionSets.reduce(
      (a: number, t: any) => a + (t?.questions ?? []).reduce((b: number, q: any) => b + (q?.parts?.length ?? 0), 0),
      0,
    ),
    marks: questionSets.reduce(
      (a: number, t: any) =>
        a +
        (t?.questions ?? []).reduce(
          (b: number, q: any) => b + (q?.parts ?? []).reduce((c: number, p: any) => c + (Number(p?.marks) || 0), 0),
          0,
        ),
      0,
    ),
    flashcards: flashcards.length,
  };
  for (const [k, v] of Object.entries(actual)) {
    const claimed = manifest.counts?.[k];
    if (claimed !== undefined && claimed !== v) {
      throw new GateError("G4-counts", `${slug}: counts.${k} manifest=${claimed} actual=${v}`);
    }
  }

  // G5 — within-course identity uniqueness (fail closed); per-note identity
  // fields must exist.
  const seen = new Set<string>();
  for (const n of notes) {
    if (!n?.noteId) throw new GateError("G5-identity", `${slug}: note without noteId`);
    if (seen.has(n.noteId)) throw new GateError("G5-identity", `${slug}: duplicate noteId ${n.noteId} WITHIN course`);
    seen.add(n.noteId);
    if (typeof n?.bodyMd !== "string" || n.bodyMd.length === 0) {
      throw new GateError("G5-identity", `${slug}: note ${n.noteId} has empty bodyMd`);
    }
  }
  const seenSet = new Set<string>();
  for (const t of questionSets) {
    if (!t?.slug || !t?.name) throw new GateError("G5-identity", `${slug}: qset without slug/name`);
    if (seenSet.has(t.slug)) throw new GateError("G5-identity", `${slug}: duplicate set slug ${t.slug} WITHIN course`);
    seenSet.add(t.slug);
  }
  const seenCard = new Set<string>();
  for (const c of flashcards) {
    if (!c?.id) throw new GateError("G5-identity", `${slug}: flashcard without id`);
    if (seenCard.has(c.id)) throw new GateError("G5-identity", `${slug}: duplicate card id ${c.id} WITHIN course`);
    seenCard.add(c.id);
  }

  return { slug, dir, manifest, curriculum, notes, questionSets, flashcards };
}

export const SQLITE_DDL = `
PRAGMA journal_mode = DELETE;
PRAGMA page_size = 4096;

CREATE TABLE package_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE resource (
  resource_id INTEGER PRIMARY KEY,
  course_slug TEXT, -- NULL for course-agnostic hub artifacts (registry, pastpapers index)
  path TEXT NOT NULL,
  type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  upstream_schema TEXT
);

CREATE TABLE resource_version (
  resource_id INTEGER PRIMARY KEY REFERENCES resource(resource_id),
  generated_utc TEXT NOT NULL,
  upstream_ref TEXT NOT NULL
);

CREATE TABLE resource_provenance (
  resource_id INTEGER PRIMARY KEY REFERENCES resource(resource_id),
  source_repo TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  upstream_schemas TEXT NOT NULL,
  license TEXT NOT NULL
);

CREATE TABLE specification_point (
  course_slug TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  parent_code TEXT,
  provenance_tier TEXT,
  PRIMARY KEY (course_slug, code)
);

CREATE TABLE revision_note (
  course_slug TEXT NOT NULL,
  note_id TEXT NOT NULL,
  title TEXT NOT NULL,
  section_slug TEXT,
  topic_slug TEXT,
  updated_at TEXT,
  body_sha256 TEXT NOT NULL,
  body_bytes INTEGER NOT NULL,
  source_url TEXT,
  guided_study INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (course_slug, note_id)
);

CREATE TABLE revision_note_specification_point (
  course_slug TEXT NOT NULL,
  note_id TEXT NOT NULL,
  spec_code TEXT NOT NULL,
  resolved INTEGER NOT NULL,
  PRIMARY KEY (course_slug, note_id, spec_code)
);

CREATE TABLE exam_question_set (
  course_slug TEXT NOT NULL,
  set_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  section_slug TEXT,
  topic_slug TEXT,
  question_count INTEGER NOT NULL,
  part_count INTEGER NOT NULL,
  mark_total INTEGER NOT NULL,
  PRIMARY KEY (course_slug, set_slug)
);

CREATE TABLE flashcard (
  course_slug TEXT NOT NULL,
  card_id TEXT NOT NULL,
  deck_slug TEXT,
  card_type TEXT,
  spec_point_code TEXT,
  provenance_tier TEXT,
  PRIMARY KEY (course_slug, card_id)
);

CREATE TABLE validation_finding (
  finding_id INTEGER PRIMARY KEY,
  course_slug TEXT,
  severity TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);

CREATE INDEX idx_rnsp_resolved ON revision_note_specification_point (resolved);
CREATE INDEX idx_note_course ON revision_note (course_slug);
CREATE INDEX idx_finding_kind ON validation_finding (kind);
`;
