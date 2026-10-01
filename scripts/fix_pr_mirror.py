#!/usr/bin/env python3
"""
Retarget the 12 dangling practical endpoints (4CH1-PR-01..11 ad-hoc codes) in
content/igcse-chemistry-19/prerequisites.json to the real core-practical spec
codes — the same verified-1:1 mapping already applied to concept-graph.json by
scripts/fix_pr_edges.py (commit fd05d75).

Why: the exporter (scripts/kg_export.py) resolves snapshot endpoints through
the exported point set. The curriculum DOES carry the practicals as real spec
statements ("practical: ..."), so the retarget makes the 12 operator-validated
concept->practical prerequisite edges drawable instead of skipped
(meta.prerequisites.skipped.unmappedEndpoint: 12 -> 0).

The upstream syllabai-core settled store still uses the ad-hoc codes; that
retarget is the follow-up data fix. This mirror edit is annotated in-file.

Mapping (verified 1:1 in spec order against curriculum.json — identical to
fix_pr_edges.py):
  4CH1-PR-01 -> 4CH1-1.7C   (solubility of a solid at a set temperature)
  4CH1-PR-02 -> 4CH1-1.13   (paper chromatography, inks/food colourings)
  4CH1-PR-03 -> 4CH1-1.36   (formula of a metal oxide by combustion)
  4CH1-PR-04 -> 4CH1-1.60C  (electrolysis of aqueous solutions)
  4CH1-PR-09 -> 4CH1-3.8    (temperature changes: HCl + NaOH calorimetry)
  4CH1-PR-10 -> 4CH1-3.15   (marble chips surface area / concentration rate)
  4CH1-PR-11 -> 4CH1-3.16   (catalytic decomposition of hydrogen peroxide)

PR-05..08 and PR-12 have no edges, so nothing to do for them.
"""
import json
import re
import sys
from pathlib import Path

SNAP = Path("content/igcse-chemistry-19/prerequisites.json")
CURRICULUM = Path("content/igcse-chemistry-19/curriculum.json")

MAPPING = {
    "4CH1-PR-01": "4CH1-1.7C",
    "4CH1-PR-02": "4CH1-1.13",
    "4CH1-PR-03": "4CH1-1.36",
    "4CH1-PR-04": "4CH1-1.60C",
    "4CH1-PR-09": "4CH1-3.8",
    "4CH1-PR-10": "4CH1-3.15",
    "4CH1-PR-11": "4CH1-3.16",
}


def collect_codes(cur: dict) -> set:
    codes = set()

    def walk(o):
        if isinstance(o, dict):
            c = o.get("code") or o.get("id")
            if isinstance(c, str):
                codes.add(c)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(cur)
    return codes


def main() -> int:
    raw = SNAP.read_text(encoding="utf-8")
    snap = json.loads(raw)
    cur_codes = collect_codes(json.loads(CURRICULUM.read_text(encoding="utf-8")))

    edges = snap["validatedPrerequisiteEdges"]
    before = [e for e in edges
              if e["prerequisite"] in MAPPING or e["dependent"] in MAPPING]
    print(f"edges carrying a PR-xx endpoint: {len(before)} (expect 12)")
    if len(before) != 12:
        print("ABORT: unexpected edge count")
        return 1

    # every PR endpoint is the DEPENDENT (the practical requires the concept),
    # but retarget both fields defensively — the mapping is code-verbatim
    retargeted = 0
    for e in edges:
        for field in ("prerequisite", "dependent"):
            if e[field] in MAPPING:
                e[field] = MAPPING[e[field]]
                retargeted += 1

    # post-conditions
    leftover = [e for e in edges
                if re.search(r"-PR-\d", e["prerequisite"] + e["dependent"])]
    # resolution check mirrors the exporter's endpoint contract: spec codes must
    # exist in the curriculum; concept endpoints must exist in the anchor map
    anchors = set(snap.get("conceptAnchors", {}))
    unresolvable = [
        e for e in edges
        if (e["prerequisite"] not in anchors and e["prerequisite"] not in cur_codes)
        or (e["dependent"] not in anchors and e["dependent"] not in cur_codes)
    ]
    retargeted_resolvable = all(
        MAPPING[c] in cur_codes
        for e in before for c in (e["prerequisite"], e["dependent"]) if c in MAPPING
    )
    counts_unchanged = snap["counts"]["validatedEdges"] == len(edges)

    print(f"endpoint fields retargeted: {retargeted} (expect 12)")
    print(f"leftover PR-xx references: {len(leftover)} (expect 0)")
    print(f"edges with unresolvable endpoints: {len(unresolvable)} (expect 0)")
    print(f"retargeted spec codes all in curriculum: {retargeted_resolvable}")
    print(f"counts.validatedEdges untouched: {counts_unchanged}")

    if (leftover or unresolvable or not counts_unchanged
            or retargeted != 12 or not retargeted_resolvable):
        print("ABORT: post-conditions failed, not writing")
        return 1

    # in-file honesty note: the mirror now differs from the upstream core store
    # exactly where that store still carries the ad-hoc codes
    snap["practicalEndpointRetarget"] = (
        "12 operator-validated edges carried ad-hoc 4CH1-PR-01..11 endpoints; "
        "retargeted here to the real core-practical spec codes via the mapping "
        "verified 1:1 in spec order against curriculum.json (same mapping as "
        "scripts/fix_pr_edges.py, commit fd05d75, which fixed concept-graph.json). "
        "Provenance strings untouched. The upstream syllabai-core settled store "
        "retarget is the follow-up data fix."
    )

    out = json.dumps(snap, ensure_ascii=False, indent=1)
    SNAP.write_text(out + ("\n" if not out.endswith("\n") else ""), encoding="utf-8")
    print(f"written: {SNAP} ({len(raw)} -> {len(out) + 1} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
