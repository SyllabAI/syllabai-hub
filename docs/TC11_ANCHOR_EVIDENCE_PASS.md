# T-C11 §5.4 HOLD items #4–#8 — anchor-evidence pass

- Operator trace: `1a0f589530363705` ("#4–#8 anchor-evidence pass"), continuing `1a0f3e20d4f963e9` ("Review that 7-edge package and GO") and the `1a0f3c31c0cc39b1` review gate (§5.4: 8 order anomalies → 3 KEEP AS DERIVED / 5 HOLD).
- Scope: evidence pass ONLY. No prerequisite authoring, no promotion, no store edit. This document is the durable replacement for the §5.4 sections lost with the prior session's context.
- Verdicts feed the Batch-5 boundary (see §6): **0 of the 5 HOLD pairs is authorable**.

## 1. Method

Every claim below is derived from committed artifacts, re-derived deterministically:

| Source | Role in the pass |
|---|---|
| `content/igcse-chemistry-19/prerequisites.json` | T-C11 settled store mirror: `validatedPrerequisiteEdges` (operator-validated, provenance verbatim) + `conceptAnchors` |
| `content/igcse-chemistry-19/concept-graph.json` | `PART_OF` anchor edges with verbatim `evidenceQuote`s (anchor-soundness certification) |
| `content/igcse-chemistry-19/curriculum.json` | Spec-point texts (4CH1-2017) — the final authority on anchor soundness |
| `public/kg/data/igcse-chemistry-19.json` | Shipped export — what the /knowledge-graph surface actually draws |
| `scripts/kg_export.py` | Projection semantics: core store `(dependent, prerequisite)` flipped to visualizer `[prerequisite, dependent]`; self-loops skipped, multi-anchor endpoints cross-multiplied |

Direction conventions (from `kg_export.py` docstring, lines 126–128):
- Core/`concept-graph.json`: `A REQUIRES B` ⇒ A depends on B.
- `validatedPrerequisiteEdges`: explicit fields `{prerequisite, dependent}`.
- Visualizer/§5.4 pairs below are written `[prerequisite → dependent]`.
- "Reversed" = prerequisite code sorts after the dependent code (spec order 4CH1-2017).

## 2. Reproduced census

Projecting the 112 validated concept-level edges through the anchor map yields 133 SP pairs; the true reversed set is exactly six — the review gate's #1–#3 (KEEP AS DERIVED) plus the five HOLD items #4–#8. The seven `4CH1-PR-xx` endpoints do not resolve through the anchor map (`skipped.unmappedEndpoint: 12` in the shipped export) — the review gate's #3 `1.10→PR-01` lives in that skipped set, not in the 133.

A reproducibility note: a naive string sort of the point number over-reports anomalies (`1.10` vs `1.5C`); numeric-aware comparison is required. The six reversed pairs are stable under both orderings.

## 3. The five HOLD pairs — per-pair verdicts

### #4 `1.28 → 1.26` — ARTIFACT (cross-product of dual-anchoring)

- Source (settled store, operator-validated 2026-09-12): `prerequisite=4CH1-CON-AR / dependent=4CH1-CON-MR`, `DEFINITIONAL_DEPENDENCY`, pass `c11-pilot-pass-1`.
- Anchors: AR → {1.26, 1.28}; MR → {1.26, 1.28}. Cross-product emits both `(1.26, 1.28)` (in order) and `(1.28, 1.26)` (reversed).
- Anchor soundness — all four verbatim-justified:
  - `CON-AR PART_OF 1.26`: "The relative atomic mass of every element is given on the Periodic Table."
  - `CON-AR PART_OF 1.28`: "calculations involving amount of substance, relative atomic mass" — verbatim substring of 1.28's spec text ("…calculations involving amount of substance, relative atomic mass (Ar) and relative formula mass (Mr)").
  - `CON-MR PART_OF 1.26`: "To calculate the Mr of a substance, you have to add up the relative atomic masses…" (1.26 = "calculate relative formula masses (Mr) from relative atomic masses (Ar)").
  - `CON-MR PART_OF 1.28`: "relative formula mass" — verbatim substring of 1.28.
- Verdict: the review gate's hypothesis "PART_OF anchor misplaced — fix the anchor" is **refuted by spec text**: both 1.26 and 1.28 name Ar and Mr explicitly, so both concepts legitimately anchor at both points. The reversed pair is a **projection artifact of legitimate dual-anchoring**, not an anchor defect and not a data defect. The real relation is already carried by the in-order sibling `1.26 → 1.28` (present in the projection).
- Disposition: **NO-GO** for authoring. No anchor change required.

### #5 `1.33 → 1.32` — ARTIFACT (cross-product of dual-anchoring)

- Source (operator-validated 2026-09-12): `prerequisite=4CH1-CON-EMPIRICAL-FORMULA / dependent=4CH1-CON-MOLECULAR-FORMULA`, `USED_WITHOUT_RETEACHING`.
- Anchors: EMPIRICAL-FORMULA → {1.32, 1.33}; MOLECULAR-FORMULA → {1.32, 1.33}. Cross-product emits `(1.32, 1.33)` (in order) and the reversed `(1.33, 1.32)`.
- Anchor soundness: `CON-EMPIRICAL-FORMULA PART_OF 1.32` quotes 1.32's spec text verbatim ("know what is meant by the terms empirical formula and molecular formula"); both concepts quote 1.33 verbatim ("calculate empirical and molecular formulae from experimental data"). All sound.
- Verdict: **refutes the gate note's "gas-test family" gloss** — 1.32/1.33 are formula-definition and formula-calculation points (gas tests live elsewhere in section 2). Same artifact class as #4; the real relation is carried by `1.32 → 1.33` (present in the projection).
- Disposition: **NO-GO** for authoring. No anchor change required.

### #6 `1.33 → 1.31` — GENUINE SPIRAL (reclassified: joins KEEP-AS-DERIVED)

- Source (operator-validated 2026-09-12): `prerequisite=4CH1-CON-EMP-MOL-CALC / dependent=4CH1-CON-WATER-CRYST`, **`EXPLICIT_TEACH_SEQUENCE`**.
- Anchors: EMP-MOL-CALC → {1.33}; WATER-CRYST → {1.31}. The reversed pair is the **direct, unambiguous projection** of this single edge — not a cross-product.
- Anchor soundness: `CON-WATER-CRYST PART_OF 1.31` quotes 1.31 verbatim ("salts containing water of crystallisation"); EMP-MOL-CALC@1.33 is the calculation procedure the edge references. The gate's "strongest anchor-problem candidate" hypothesis is **refuted: both anchors are verbatim-correct**.
- Why it is nevertheless not authorable: the relation is real but **runs against the 4CH1-2017 listing order by design** — 1.31's experimental deductions (metal oxides, hydrated salts) supply the data that 1.33's method processes, and the hydrated-salt calculation reuses the empirical-formula steps ("The steps for empirical formula can be adapted for hydrated salt / water of crystallisation calculations"). This is the same intentional-spiral class the gate already ruled KEEP AS DERIVED for #1–#3 (`1.3→1.2`, `1.10→1.5C`, `1.10→PR-01`).
- Disposition: **KEEP AS DERIVED**. NO-GO for authoring; promotion stays locked.

### #7 `3.14C → 3.12` — ARTIFACT (dual-anchor spillover onto the definition point)

- Source (operator-validated 2026-09-13): `prerequisite=4CH1-CON-ACTIVATION-ENERGY / dependent=4CH1-CON-CATALYST`, `USED_WITHOUT_RETEACHING`, pass `c11-s16-batch-4`.
- Anchors: ACTIVATION-ENERGY → {3.14C}; CATALYST → {3.12, 3.13}. One concept edge, two projected pairs (#7 and #8).
- The decisive evidence: the settled edge's evidence quote — "The alternative pathway has a lower activation energy" — is **3.13's spec text** (3.13: "know that a catalyst works by providing an alternative pathway with lower activation energy"). The dependency attaches to the **mechanism point**, not the definition point: 3.12 ("know that a catalyst is a substance that increases the rate of a reaction, but is chemically unchanged at the end") presupposes no activation-energy concept.
- Verdict: the gate's "don't encode the projection's reversed order as authoritative" is **confirmed, with a sharper root cause** — the pair exists only because CATALYST dual-anchors at 3.12+3.13 and the projection spreads the dependency over both anchors. Anchor evidence does **not** support `3.14C` as prerequisite of `3.12` specifically.
- Disposition: **NO-GO** for authoring. No anchor change required (the CATALYST@3.12 anchor is verbatim-sound: "Catalysts are substances which speed up the rate of a reaction…").

### #8 `3.14C → 3.13` — GENUINE SPIRAL (reclassified: joins KEEP-AS-DERIVED)

- Same source edge as #7, projecting onto the mechanism point 3.13.
- The relation is real: 3.13's own spec text uses "lower activation energy" before 3.14C formalizes Ea via reaction profiles ("draw and explain reaction profile diagrams showing ΔH and activation energy"). Early contact before formal treatment — exactly the gate's KEEP class rationale for #2 ("formalization later than early contact").
- Verdict: the gate note is **confirmed**. Real relation, wrong direction for an authoritative in-order prerequisite record; as a drawn backwards arrow it would misrepresent the teaching order.
- Disposition: **KEEP AS DERIVED**. NO-GO for authoring.

## 4. Anchor-soundness certificate (gate hypotheses closed)

Every `PART_OF` anchor implicated by #4–#8 carries a verbatim quote matching the 4CH1-2017 spec text of its point (quotes in §3). Result: **no anchor anywhere in #4–#8 is misplaced**. All three gate hypotheses that blamed anchors (#4 "anchor misplaced", #6 "strongest anchor candidate", #7/#8 projection-order) resolve to: anchors sound; the anomaly lives entirely in the read-model projection's multi-anchor cross-product.

## 5. Product consequence (what ships today)

`public/kg/data/igcse-chemistry-19.json` (generated 2026-09-30T09:26:58Z) draws all five reversed pairs as `pre` edges — `p:1.28→p:1.26`, `p:1.33→p:1.31`, `p:1.33→p:1.32`, `p:3.14C→p:3.12`, `p:3.14C→p:3.13` — inside the 119-pair tier labeled operator-validated. That tier label is accurate for the **concept-level** edges but overstates the SP pairs: the operator validated the concept relations, not these reversed projections. Remediation belongs in the read model (`kg_export.py` / snapshot regeneration), not in the settled store. Candidate mechanisms, for operator review:

1. Suppress reversed cross-product pairs (keep in-order siblings) — minimal, loses the two genuine spirals from the graph.
2. Downgrade reversed pairs to the `rel` (related) tier — honest "related, not ordered" rendering, keeps #6/#8 visible.
3. Leave as-is with a provenance annotation only — no code change, relies on labels.

None of the three touches `validatedPrerequisiteEdges` or the concept-graph store.

**Implemented (trace `1a0f5ade2cba729d`):** a hybrid of 1+2, as a single mechanical rule in `kg_export.py` v1.4 — a reversed pair is suppressed when its in-order sibling is also projected (covers #4, #5), else demoted to the `rel` tier (covers #6, #7, #8). Applied uniformly, the rule also caught the gate's KEEP items that project reversed: `1.3→1.2` (#1 → `rel`) and, once the practical retarget made `1.10→1.7C` resolvable (#3 → `rel`), while `1.10→1.5C` (#2) suppressed via its drawn sibling `1.5C→1.10`. All eight §5.4 anomalies thus leave the `pre` tier under one rule; final dispositions in `docs/TC11_BATCH5_MANIFEST.md` §3.

## 6. Batch-5 boundary after this pass

- Authoring eligibility of #4–#8: **0 of 5** (#4, #5, #7 artifacts; #6, #8 spirals → KEEP AS DERIVED). The HOLD gate closes with dispositions, not with promotions.
- Whatever the Batch-5 7-edge package's full composition was (its manifest did not survive the prior session — the only committed 7-element edge set in this repo is the practical-retarget mapping in `scripts/fix_pr_edges.py`), **any package line containing #4–#8 is now struck**. Re-issue the package manifest listing its remaining edges before any authoring POST; the standing rule applies unchanged: authoring requires per-edge anchor-backed evidence (like the quotes in §3), promotion of the 132 concept-backed derived pairs remains NO-GO.
