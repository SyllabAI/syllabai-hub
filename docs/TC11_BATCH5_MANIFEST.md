# Batch-5 prerequisite manifest — re-issue and closure

- Operator trace: `1a0f5ade2cba729d` ("Okay, proceed"), executing the post-pass follow-ups from `1a0f589530363705` (#4–#8 anchor-evidence pass) under the standing boundary from `1a0f3e20d4f963e9`: "Batch-5 prerequisite authoring: GO; Batch-5 promotion: NO-GO until that authoring/evidence pass is reviewed."
- This manifest replaces the lost 7-edge package (its manifest did not survive the prior session; the only committed 7-element edge set in the repo was the practical-retarget mapping in `scripts/fix_pr_edges.py`). It re-issues the Batch-5 candidate census from committed data with a disposition per class, and closes the batch.

## 1. What "proceed" implemented

1. **Mirror retarget** (`scripts/fix_pr_mirror.py`, mapping identical to the reviewed `scripts/fix_pr_edges.py` / commit fd05d75): the 12 operator-validated concept→practical edges in `content/igcse-chemistry-19/prerequisites.json` carried ad-hoc `4CH1-PR-01..11` endpoints; they now point at the real core-practical spec statements (1.7C, 1.13, 1.36, 1.60C, 3.8, 3.15, 3.16 — all present in the exported point set). `skipped.unmappedEndpoint: 12 → 0`. Provenance strings untouched; the upstream syllabai-core store retarget remains the follow-up data fix (noted in-file).
2. **Reversed-pair governance** (`scripts/kg_export.py` v1.4, per the anchor-evidence pass): a projected pair that sorts against spec order is suppressed when its in-order sibling is also projected (dual-anchor cross-product redundancy), else demoted to the related (`rel`) tier. The settled store is untouched; the read model no longer draws any backwards prerequisite arrow.
3. **Bundles regenerated** (`public/kg/data/`): only `igcse-chemistry-19.json` changed substantively (edges 359 → 369); every other course file differs only in exporter version/timestamp header.

## 2. Batch-5 candidate census and dispositions

| Class | Size | Disposition |
|---|---|---|
| 1. Operator-validated T-C11 store (`validatedPrerequisiteEdges`) | 112 concept edges | **Already carried** — these ARE the settled store; nothing to author. Projection post-governance: 124 `pre` pairs + 5 demoted to `rel` + 3 suppressed. |
| 2. Inferred-prototype curation (`inferredPrototypePre` / `Rel`) | 30 `pre` + 5 `rel` tuples | **Carried as the inferred tier**, labeled honestly in the explorer. Promotion to validated: **NO-GO** per the standing gate. |
| 3. Practical-dependent edges (class 1 ∩ practicals) | 12 edges → 13 SP pairs | **Now drawable** after the retarget: 12 in-order pairs drawn `pre` (e.g. 1.4→1.7C, 1.5C→1.7C, 1.10→1.13, 1.31→1.36, 3.2→3.8, 3.9→3.15, 3.12→3.16 …), 1 spiral (`1.10→1.7C`) demoted to `rel`. Reconciles §5.5's "13 practical-dependent pairs". |
| 4. §5.4 order anomalies | 8 pairs | **Closed by the pass + governance** — see §3. |
| 5. PR-gap practicals PR-05 / PR-06 / PR-07 / PR-08 / PR-12 | 5 practicals | **NO-GO** — no validated edges exist for them; they have no prerequisite evidence, and authoring without evidence is invention (forbidden by the core governance principle). These remain honestly missing. |

## 3. §5.4 anomaly set — final dispositions

| Gate item | Pair | Post-governance state |
|---|---|---|
| #1 KEEP | `1.3→1.2` (particle model / state changes spiral) | **`rel`** — real spiral, kept visible, no longer drawn as an ordered prerequisite |
| #2 KEEP | `1.10→1.5C` (solubility before formal treatment) | **Suppressed** — redundant: its in-order sibling `1.5C→1.10` is drawn (global-sibling rule caught it across two source edges) |
| #3 KEEP | `1.10→PR-01` (chromatography vs the later solubility practical) | **`rel`** (as `1.10→1.7C` post-retarget) — resolvable at last, honest tier |
| #4 HOLD | `1.28→1.26` | **Suppressed** — artifact; sibling `1.26→1.28` drawn |
| #5 HOLD | `1.33→1.32` | **Suppressed** — artifact; sibling `1.32→1.33` drawn |
| #6 HOLD | `1.33→1.31` | **`rel`** — genuine spiral (`EXPLICIT_TEACH_SEQUENCE`), anchors certified sound |
| #7 HOLD | `3.14C→3.12` | **`rel`** — dual-anchor spillover; definition point 3.12 does not presuppose Ea |
| #8 HOLD | `3.14C→3.13` | **`rel`** — genuine spiral (early Ea contact before 3.14C formalizes) |

Every reversed pair is out of the `pre` tier; `prereqValidated` (the renderer's provenance set) now contains exactly the 124 in-order validated pairs.

## 4. Eligible new authoring set

**Empty.** Every evidence-backed prerequisite relation in the committed data already lives in the operator-validated settled store (class 1) or the honestly-labeled inferred tier (class 2). The only candidates that would remain (class 5 and any promotion of classes 2/4) fail the evidence bar: authoring them would invent educational relations. Batch-5 therefore closes with **zero authoring POSTs** — the correct outcome of "review that package and GO" once the evidence pass ran. If the operator remembers specific edges from the lost package that this census does not surface, name them against this manifest and each will get the same per-edge evidence treatment.

## 5. Follow-ups for operator review

1. **Upstream retarget**: apply the same PR-xx → real-code mapping to the syllabai-core settled store so the mirror and its upstream agree again.
2. **Renderer nuance (optional)**: demoted pairs render as "Related knowledge · inferred prototype"; a "validated-related" tag could surface their concept-level provenance — a renderer-fork change, not a data change.
3. **Promotion gate**: the 132 concept-backed derived pairs stay `derived`; promotion remains NO-GO until the operator re-opens it with evidence per pair.
