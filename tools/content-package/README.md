# ADR-021 Content Package v0.1 — hub corpus

Governed by the ledger's `ADR_021_CONTENT_COMPILER_AND_PORTABLE_CONTENT_PACKAGE.md`,
`CONTENT_PACKAGE_V0_1.md` (the v0.1 contract) and
`CONTENT_COMPILER_AND_PACKAGE_ARCHITECTURE.md`. This is the bounded v0.1
proof applied to the hub's committed corpus payload (49 courses, ~83 MB of
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
| V1–V8 | verify.ts: re-hash, stowaway scan, provenance completeness, independent re-derivation, body hashes, lifecycle, buildId |
| R1–R4 | restore.ts: byte-identical restore, gates re-run on restored tree, semantic equivalence, registry consistency |

## Deferrals (recorded in package_metadata)

- paper / mark_scheme / parser_run tables: this payload carries SME-derived
  question sets, not parsed QP/MS artifacts — no source-PDF/parser provenance
  exists to preserve, and fabricating it would violate fail-closed provenance.
- kg_node / kg_edge: deferred per CONTENT_PACKAGE_V0_1 §6.
- `exam_question_set` + `flashcard` are additive identity/coverage tables
  (no bodies, no semantics).

## Determinism (measured)

Same source tree + same compiler → **byte-identical `content.sqlite`** and
stable buildId (digest over sorted artifact digests, clock-free). Only
`MANIFEST.createdAt` varies (informational, excluded from buildId). The
selftest re-measures this on every CI run.
