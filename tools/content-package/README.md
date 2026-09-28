# ADR-021 Content Package v0.2 — hub corpus

Governed by the ledger's `ADR_021_CONTENT_COMPILER_AND_PORTABLE_CONTENT_PACKAGE.md`,
`CONTENT_PACKAGE_V0_1.md` (the accepted v0.1 contract),
`CONTENT_PACKAGE_V0_2.md` (v0.2: KG projection policy + distribution) and
`CONTENT_COMPILER_AND_PACKAGE_ARCHITECTURE.md`. This is the bounded proof
applied to the hub's committed corpus payload (49 courses, ~83 MB of
per-course JSON bundles + the pastpapers index/blueprints).

## What it is

A **derived, portable, reproducible snapshot** of the corpus:

```
dist/content-package/
├── MANIFEST.json            identity, per-artifact SHA-256, counts, findings
├── content/
│   ├── courses.json         the course registry (verbatim)
│   ├── content/<slug>/…     the 49 per-course bundles (verbatim copies)
│   └── src/data/…           pastpapers index + blueprints (verbatim)
└── database/content.sqlite  the v0.1 queryable projection
```

PostgreSQL (and the hub's committed `content/` tree) remain the operational
truth. The package is a projection — it must never become a second database,
never carries learner state, and never confers learner-serving eligibility.

## Usage

```bash
bash tools/content-package/selftest.sh        # compile → verify → restore →
                                               # determinism → tamper (CI gate)
bun tools/content-package/compile.ts          # build to dist/content-package
bun tools/content-package/verify.ts           # verify a package independently
bun tools/content-package/restore.ts          # clean-env restore + semantic
                                               # equivalence (§8 reconstruction)
```

**Sandbox-reset recovery:** `compile.ts` on the current tree, or `restore.ts`
from a stored package, reproduces the exact `content/` tree byte-for-byte
(346 artifacts, verified) — no SME re-import needed.

**Scoped packages + distribution (v0.2):** `compile.ts --courses=<slugs>`
builds a bounded package (deterministic `scopeId`); `bundle.ts` wraps any
verified package into the §7 distribution form
`syllabai-content-<scopeId>-<version>-<buildId12>.zip` — a self-contained
deterministic zip (own writer, fixed entry order + timestamps, CRC-verified
round-trip; `--extract` fails closed on any corruption). Importing a bundle
never publishes content and never confers serving eligibility (§12).

## Measured identity model (not guessed)

- Note identity is **composite `(course_slug, note_id)`**: 1205 of 3743 note
  rows share ids across courses (linear ↔ modular spec variants share SME
  notes upstream, e.g. igcse-biology-19 ↔ igcse-biology-modular-24-unit-2:
  99 shared). Cross-course sharing is a recorded finding, not a failure;
  a duplicate WITHIN one course fails closed. Same composite treatment for
  question sets, flashcards and spec-point codes.
- Note → spec-point mapping resolution across the whole corpus:
  **3969/3969 (100%)**.
- `manifest.counts` semantics measured across all 49 courses: `topics` ==
  SUBTOPIC node count (49/49); `sections` is upstream-declared with **no**
  locally derivable definition (== note sections in 29/49, == qset sections
  in 24/49, == neither in 20/49) — recorded as a finding, never guessed.

## Gates (fail closed)

| Gate | What it enforces |
|------|------------------|
| G1 inventory | all 7 bundle files present per course |
| G2 schema | `syllabai-demo.content-bundle/2.0` exact |
| G3 provenance | importSource repo/ref/upstreamSchemas + license present |
| G4 counts | manifest counts reconcile with actual arrays (8 unambiguous counts) |
| G5 identity | within-course uniqueness; non-empty note bodies |
| G6 kg | KG projection gates (v0.2): graph shape + own-counts reconciliation, node/edge shape, frozen relation vocabulary, tier vocabulary, duplicate-triple ban, two-namespace endpoint resolution (kg_node ∪ specification_point), node.specPoints resolve |
| V1–V8 | verify.ts: re-hash, stowaway scan, provenance completeness, independent re-derivation, body hashes, lifecycle, buildId |
| V9 kg | verify.ts (v0.2): KG rows match an independent re-derivation from the package's own concept-graph.json (counts, per-row fields, tier census); endpoints resolve against the package's OWN tables; scope-aware registry check |
| R1–R4 | restore.ts: byte-identical restore, G1–G6 re-run on restored tree, semantic equivalence (incl. KG counts), registry consistency (full: equality; scoped: ⊆ + excluded == registry minus scope) |

## KG projection (v0.2) — the ADR-021 forward gate, measured

The concept-graph layer is projected as **NON-AUTHORITATIVE** rows
(`kg_node`, `kg_node_specification_point`, `kg_edge`) with every provenance
tier preserved verbatim. Measured corpus reality: only the pilot
`igcse-chemistry-19` carries a graph (113 nodes / 275 edges; the other 48
courses are empty shells), and **100% of rows are `AI_SUGGESTED`** — the
pilot's own `validationGate` text (operator review pending, no promotion
from generated state) is preserved verbatim in `validation_finding`. A KG
row never confers authority, curriculum/KG truth, or learner-serving
eligibility. Edge endpoints follow the TWO-NAMESPACE rule (measured):
`PART_OF` anchors CONCEPTs to spec points (endpoint = `specification_point`
code); `REQUIRES_PREREQUISITE` fires CON→CON and SPEC→CON; misconception
relations (MISCONCEPTION_OF / WRONG_ANSWER_PATTERN / REMEDIATED_BY) fire
MIS→CON.

## Deferrals (recorded in package_metadata)

- paper / mark_scheme / parser_run tables: this payload carries SME-derived
  question sets, not parsed QP/MS artifacts — no source-PDF/parser provenance
  exists to preserve, and fabricating it would violate fail-closed provenance.
- `exam_question_set` + `flashcard` are additive identity/coverage tables
  (no bodies, no semantics).
- kg tables: deferred in v0.1 per CONTENT_PACKAGE_V0_1 §6 — **ADDED in v0.2**
  per CONTENT_PACKAGE_V0_2.md (non-authoritative, G6/V9-gated).

## Determinism (measured, two layers)

**Package layer:** same source tree + same compiler → **byte-identical
`content.sqlite`** and stable buildId (digest over sorted artifact digests,
clock-free). Only `MANIFEST.createdAt` varies (informational, excluded from
buildId). The selftest re-measures this on every CI run.

**Zip layer (v0.2):** same package directory → **byte-identical zip**
(self-contained writer: sorted entries, fixed DOS timestamp 1980-01-01,
fixed deflate level, no extra fields). Zips of two independent compiles
may differ in exactly the `MANIFEST.createdAt` bytes — content identity
(buildId) never differs. Byte-identity across zlib/toolchain VERSIONS is
not claimed.
