#!/usr/bin/env python3
"""kg_export.py — per-course canonicalKG export for the OpenHuman visualizer.

    content/<slug>/curriculum.json  ->  public/kg/data/<slug>.json  (+ index.json)

Contract: GRAPH_CONTRACT v1.0 — node types Subject / Section / SubTopic /
SpecificationPoint / ExamPaper; edge types hier / pre / rel / assess.

v1.3: prerequisite/related edge projection. A committed per-course snapshot
(content/<slug>/prerequisites.json — the operator-validated T-C11 settled
store + concept anchors + the inferred-prototype curation) projects onto the
spec-point graph as `pre`/`rel` edges with provenance tiers in
meta.prerequisites and the validated pair keys in `prereqValidated`.
Courses without a snapshot keep the exact v1.2 payload shape (hier edges
only; only the exporter meta label differs).

v1.2: curricula that carry a UNIT family layer (IAL sciences) export the
printed units as Sections, their TOPICs as SubTopics, and consume the
curriculum SUBTOPIC layer as the point-mapping level (points attach to
their topic directly). Curricula without UNIT nodes export exactly as
v1.1 — byte-identical shapes.

v1 ships hier edges only: curriculum.json carries no prerequisite, relation or
paper metadata, and the corpus discipline forbids inventing edges. The 4CH1
counts cross-check against the prototype's hand-curated dataset (1 Subject /
4 Sections / 28 SubTopics / 182 SpecificationPoints, 214 hier edges).

Node id conventions mirror the visualizer build exactly:
    Subject             id 'subject'
    Section             id 'sec<N>'            (N = 1-based curriculum order)
    SubTopic            id '<N><a..z|aa..zz>'  (section number + letter)
    SpecificationPoint  id 'p:<pointId>'       (pointId '1.5C' when the
                                               official code is numeric, else
                                               the SME code, verbatim)

The payload carries the build's own table shapes (sections / subtopics /
points / subPointCounts / sectionAnchors / pointSubtopics) so the loader fork
rebuilds the graph through the renderer's own makeBase() pipeline.

Usage:
    python3 scripts/kg_export.py                 # export all courses
    python3 scripts/kg_export.py --qual igcse-chemistry-19
    python3 scripts/kg_export.py --check-only    # validate, write nothing
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import math
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONTENT = REPO / "content"
OUT_DIR = REPO / "public" / "kg" / "data"

CONTRACT_VERSION = "1.0"
NODE_TYPES = {"Subject", "Section", "SubTopic", "SpecificationPoint", "ExamPaper"}
EDGE_TYPES = {"hier", "pre", "rel", "assess"}

# section colours (first four = the build's own 4CH1 palette)
SECTION_COLORS = [
    "#6656a9", "#2a8b8a", "#3d79a6", "#4a9b70",
    "#c38422", "#a85566", "#5b6ee1", "#7a7a52",
]

NUMERIC_POINT = re.compile(r"^\d+\.\d+[A-Z]?$")


def sub_letter(seq: int) -> str:
    """0 -> 'a', 25 -> 'z', 26 -> 'aa', 27 -> 'ab', ... (no collision)."""
    if seq < 26:
        return chr(ord("a") + seq)
    return chr(ord("a") + seq // 26 - 1) + chr(ord("a") + seq % 26)


def point_id_for(qual_code: str, raw_code: str) -> str:
    """'4CH1-1.5C' -> '1.5C'; opaque SME codes pass through verbatim."""
    prefix = qual_code + "-"
    if raw_code.startswith(prefix):
        stripped = raw_code[len(prefix):]
        if NUMERIC_POINT.match(stripped):
            return stripped
    return raw_code


def section_anchor(i: int, n: int) -> tuple[float, float]:
    """Ellipse ring around the subject node (750, 420), like the build's
    hand-placed 4CH1 anchors (390,220) (1090,220) (420,640) (1080,650)."""
    cx, cy = 750.0, 420.0
    if n == 1:
        return (cx + 330.0, cy)
    rx, ry = 370.0 * max(1.0, math.sqrt(n / 4)), 240.0 * max(1.0, math.sqrt(n / 4))
    angle = -math.pi / 2 + 2 * math.pi * i / n
    return (round(cx + rx * math.cos(angle), 1), round(cy + ry * math.sin(angle), 1))


class ExportError(Exception):
    pass


def point_ord_key(pid: str) -> tuple:
    """Listing-order key for a point id ('1.5' < '1.5C' < '1.6'). Mirrors the
    per-section ord gate in export_course (multi-level codes and letter
    suffixes order naturally); used by the reversed-pair governance below."""
    parts = pid.split(".")
    nums = []
    letter = ""
    for i, comp in enumerate(parts):
        m = re.match(r"^(\d+)([A-Za-z]*)$", comp)
        if m:
            nums.append(float(m.group(1)))
            letter = m.group(2) or letter
        else:
            try:
                nums.append(float(comp.rstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                                             "abcdefghijklmnopqrstuvwxyz")))
            except ValueError:
                nums.append(0.0)
    return tuple(nums) + (letter,)


def load_prerequisites(slug: str, qual_code: str, seen_pid: dict) -> tuple[list, dict, list[str]]:
    """v1.4: project the committed prerequisite snapshot (content/<slug>/
    prerequisites.json) onto the visualizer's spec-point graph.

    Two provenance tiers, both data-backed, neither invented here:
      - operator-validated: the T-C11 settled store's REQUIRES_PREREQUISITE
        edges (VALIDATED in core) are DETERMINISTICALLY projected through the
        concept anchor map — concept endpoints resolve to the spec points the
        concept anchors under; structure endpoints map verbatim. Validated
        edges win over inferred pairs on the same (prerequisite, dependent).
      - inferred-prototype: the hand-curated SME tuples transcribed verbatim
        from the canonicalKG prototype artifact.

    Endpoints that resolve outside the exported point set are skipped and
    counted — never silently dropped: the counts land in meta.prerequisites
    (the historical case was the ad-hoc 4CH1-PR-01..11 practical codes, since
    retargeted to their real spec statements in the snapshot mirror; the
    curriculum carries practicals as ordinary spec points). Courses without a
    snapshot keep the exact v1.2 payload shape.

    Reversed-pair governance (operator pass 1a0f589530363705): multi-anchored
    concepts cross-project into SP pairs whose prerequisite sorts after its
    dependent — against the spec listing order. When the opposite direction is
    also projected (the dual-anchor cross-product's in-order sibling), the
    reversed copy is redundant and is suppressed (counted). A reversed pair
    with no in-order sibling is a genuine spiral relation (e.g. hydrated-salt
    deduction reusing the later-taught empirical-formula method) — it is
    DEMOTED to the related ('rel') tier, never drawn as a prerequisite: real
    relation, wrong direction for an authoritative in-order record.

    Returns (extra pre/rel edges, meta.prerequisites block, validated pair keys).
    Edge direction follows the visualizer convention: [prerequisite, dependent].
    The core store convention is the reverse (source = dependent), so the
    projection flips it.
    """
    snap_path = CONTENT / slug / "prerequisites.json"
    if not snap_path.exists():
        return [], {}, []
    snap = json.loads(snap_path.read_text(encoding="utf-8"))

    anchors_raw = snap.get("conceptAnchors", {})
    # concept code -> exported point-id set (anchors outside the point set
    # are counted, not mapped — practicals are the known case)
    anchors: dict[str, set[str]] = {}
    unmapped_anchors = 0
    for ccode, specs in anchors_raw.items():
        pids = set()
        for sp in specs:
            pid = point_id_for(qual_code, sp)
            if pid in seen_pid:
                pids.add(pid)
            else:
                unmapped_anchors += 1
        if pids:
            anchors[ccode] = pids

    def resolve(code: str) -> tuple[set[str], bool]:
        """(point-id set, resolved?) for a snapshot endpoint code."""
        if code in anchors_raw:               # concept endpoint
            return anchors.get(code, set()), code in anchors
        pid = point_id_for(qual_code, code)   # structure endpoint
        return ({pid} if pid in seen_pid else set()), pid in seen_pid

    validated: dict[tuple[str, str], dict] = {}
    skipped = {"unmappedEndpoint": 0, "unanchoredConcept": 0, "selfLoop": 0}
    for e in snap.get("validatedPrerequisiteEdges", []):
        dep_pids, dep_ok = resolve(e["dependent"])
        pre_pids, pre_ok = resolve(e["prerequisite"])
        if not dep_ok or not pre_ok:
            skipped["unmappedEndpoint"] += 1
            continue
        if not dep_pids or not pre_pids:
            skipped["unanchoredConcept"] += 1
            continue
        for d in dep_pids:
            for p in pre_pids:
                if d == p:
                    skipped["selfLoop"] += 1
                    continue
                validated[(p, d)] = {
                    "via": [e["prerequisite"], e["dependent"]],
                    "provenance": e.get("provenance"),
                }

    # reversed-pair governance — see the docstring. Runs before the inferred
    # tier is read so a demoted/suppressed pair can never re-enter as inferred.
    suppressed_mutual = 0
    demoted: dict[tuple[str, str], dict] = {}
    for pair in list(validated):
        p, d = pair
        if point_ord_key(p) < point_ord_key(d):
            continue                      # in-order — drawn as prerequisite
        if (d, p) in validated:
            del validated[pair]           # redundant with its in-order sibling
            suppressed_mutual += 1
        else:
            demoted[pair] = validated.pop(pair)   # genuine spiral -> 'rel'

    def mapped_pairs(tuples: list) -> list[tuple[str, str]]:
        out = []
        for a, b in tuples:
            pa, pb = a[2:], b[2:]   # snapshot tuples are 'p:<pointId>' verbatim
            if pa in seen_pid and pb in seen_pid and pa != pb:
                out.append((pa, pb))
            else:
                skipped["unmappedEndpoint"] += 1
        return out

    inferred = [pair for pair in mapped_pairs(snap.get("inferredPrototypePre", []))
                if pair not in validated and pair not in demoted]
    related = mapped_pairs(snap.get("inferredPrototypeRel", []))

    extra: list[list] = []
    for p, d in sorted(validated):
        extra.append(["p:" + p, "p:" + d, "pre"])
    for p, d in sorted(inferred):
        extra.append(["p:" + p, "p:" + d, "pre"])
    for p, d in sorted(demoted):
        extra.append(["p:" + p, "p:" + d, "rel"])
    for a, b in sorted(related):
        extra.append(["p:" + a, "p:" + b, "rel"])

    meta_block = {
        "source": snap.get("source"),
        "snapshotGeneratedUtc": snap.get("generatedUtc"),
        "curriculumCode": snap.get("curriculumCode"),
        **({"practicalEndpointRetarget": snap["practicalEndpointRetarget"]}
           if "practicalEndpointRetarget" in snap else {}),
        "tiers": {
            "operatorValidated": len(validated),
            "demotedReversed": len(demoted),
            "inferredPrototype": len(inferred),
            "relatedInferredPrototype": len(related),
        },
        "reversedGovernance": {
            "rule": ("a projected pair that sorts against spec order is suppressed "
                     "when its in-order sibling is also projected (dual-anchor "
                     "cross-product), else demoted to the related tier — operator "
                     "pass 1a0f589530363705, docs/TC11_ANCHOR_EVIDENCE_PASS.md"),
            "suppressedMutual": suppressed_mutual,
            "demotedPairs": [{"pair": "p:" + p + "|p:" + d, "via": meta["via"]}
                             for (p, d), meta in sorted(demoted.items())],
        },
        "skipped": skipped,
        "skippedUnmappedAnchors": unmapped_anchors,
        "projection": ("concept endpoints resolve through the concept->spec-point "
                       "anchor map; validated pairs override inferred pairs; "
                       "reversed cross-product pairs suppressed or demoted to "
                       "rel; [prerequisite, dependent] direction"),
    }
    # keys match the bundle's edge tuples verbatim ('p:X|p:Y') so the renderer
    # fork can tier-check any edge with a direct set lookup — post-governance:
    # only pairs still drawn as 'pre' carry the validated label
    validated_keys = sorted("p:" + p + "|" + "p:" + d for p, d in validated)
    return extra, meta_block, validated_keys


def export_course(slug: str, registry: dict[str, dict]) -> dict:
    cur_path = CONTENT / slug / "curriculum.json"
    cur = json.loads(cur_path.read_text(encoding="utf-8"))
    nodes = cur["nodes"]
    qual_code = cur.get("code") or slug

    # display truth: the course registry carries clean labels ("English Literature",
    # level "IGCSE"/"IAL"); curriculum meta can hold raw ids ("English-literature")
    reg = registry.get(slug, {})
    display_subject = reg.get("subject") or cur.get("subject") or slug
    display_level = reg.get("level") or cur.get("level") or ""
    display_code = reg.get("code") or qual_code

    by_code = {n["code"]: n for n in nodes}
    families = collections.Counter(n["family"] for n in nodes)
    if families.get("SUBJECT", 0) != 1:
        raise ExportError(f"{slug}: expected exactly 1 SUBJECT node, got {families.get('SUBJECT', 0)}")

    subject = next(n for n in nodes if n["family"] == "SUBJECT")
    topics = [n for n in nodes if n["family"] == "TOPIC"]
    subtopics = [n for n in nodes if n["family"] == "SUBTOPIC"]
    points = [n for n in nodes if n["family"] == "SPEC_POINT"]
    if not topics:
        raise ExportError(f"{slug}: no TOPIC nodes")

    units = [n for n in nodes if n["family"] == "UNIT"]
    unit_layer = bool(units)

    # --- sections (curriculum order) -------------------------------------
    if unit_layer:
        # v1.2 unit-layer path: UNIT nodes are the printed spec units and
        # export as Sections; TOPICs export as SubTopics under their unit;
        # curriculum SUBTOPICs are consumed as the point-mapping level.
        def _unit_num(u):
            m = re.search(r"U(\d+)$", u["code"])
            if not m:
                raise ExportError(f"{slug}: UNIT {u['code']} has no unit number")
            return int(m.group(1))

        units.sort(key=_unit_num)
        sections_tbl = {}        # printed unit number -> {label, color}
        for i, u in enumerate(units, start=1):
            key = str(_unit_num(u))
            if key in sections_tbl:
                raise ExportError(f"{slug}: duplicate unit number {key}")
            sections_tbl[key] = {
                "label": u["title"],
                "color": SECTION_COLORS[(i - 1) % len(SECTION_COLORS)],
            }
        unit_key_of = {u["code"]: str(_unit_num(u)) for u in units}

        # topics grouped under their unit (array order = spec order)
        subs_by_unit: dict[str, list[dict]] = collections.defaultdict(list)
        for t in topics:
            up = [p for p in (t.get("parents") or []) if p in unit_key_of]
            if len(up) != 1:
                raise ExportError(f"{slug}: TOPIC {t['code']} has {len(up)} UNIT parents")
            subs_by_unit[up[0]].append(t)
        subtopics_tbl: dict[str, list[list[str]]] = {}
        sub_id_of: dict[str, str] = {}   # topic code -> build id ("1a")
        for unit_code, ts in subs_by_unit.items():
            key = unit_key_of[unit_code]
            defs = []
            for j, t in enumerate(ts):
                sid = key + sub_letter(j)
                sub_id_of[t["code"]] = sid
                defs.append([sid, t["title"]])
            subtopics_tbl[key] = defs

        # duplicate topic titles within a unit would break the build's
        # parentSubtopicId() title matching — refuse rather than guess
        for unit_code, ts in subs_by_unit.items():
            titles = [t["title"] for t in ts]
            if len(set(titles)) != len(titles):
                raise ExportError(f"{slug}: duplicate topic titles in unit "
                                  f"{unit_key_of[unit_code]} ({unit_code})")

        # curriculum SUBTOPICs resolve into exactly one topic each and map
        # that topic's build id, so points attach to their topic directly
        topic_sid = dict(sub_id_of)
        for st in subtopics:
            tp = [p for p in (st.get("parents") or []) if p in topic_sid]
            if len(tp) != 1:
                raise ExportError(f"{slug}: SUBTOPIC {st['code']} has "
                                  f"{len(tp)} TOPIC parents")
            sub_id_of[st["code"]] = topic_sid[tp[0]]
    else:
        sec_key_of = {}          # topic code -> "1".."N"
        sections_tbl = {}        # "1" -> {label, color}
        for i, t in enumerate(topics, start=1):
            key = str(i)
            sec_key_of[t["code"]] = key
            sections_tbl[key] = {
                "label": t["title"],
                "color": SECTION_COLORS[(i - 1) % len(SECTION_COLORS)],
            }

        # --- subtopics, grouped under their section -----------------------
        subs_by_section: dict[str, list[dict]] = collections.defaultdict(list)
        sub_id_of: dict[str, str] = {}   # subtopic code -> build id ("1a")
        for st in subtopics:
            parents = st.get("parents") or []
            topic_code = next((p for p in parents if p in sec_key_of), None)
            if topic_code is None:
                raise ExportError(f"{slug}: SUBTOPIC {st['code']} has no TOPIC parent")
            subs_by_section[topic_code].append(st)
        subtopics_tbl: dict[str, list[list[str]]] = {}
        for topic_code, sts in subs_by_section.items():
            key = sec_key_of[topic_code]
            defs = []
            for j, st in enumerate(sts):
                sid = key + sub_letter(j)
                sub_id_of[st["code"]] = sid
                defs.append([sid, st["title"]])
            subtopics_tbl[key] = defs

        # duplicate subtopic titles within a section would break the build's
        # parentSubtopicId() title matching — refuse rather than guess
        for topic_code, sts in subs_by_section.items():
            titles = [st["title"] for st in sts]
            if len(set(titles)) != len(titles):
                raise ExportError(f"{slug}: duplicate subtopic titles in section "
                                  f"{sec_key_of[topic_code]} ({topic_code})")

    # --- points: explicit subtopic mapping (from curriculum parents) ------
    points_list = []
    point_subs: dict[str, list[str]] = collections.defaultdict(list)  # sub build id -> [pointId]
    seen_pid = {}
    for p in points:
        pid = point_id_for(qual_code, p["code"])
        if pid in seen_pid:
            raise ExportError(f"{slug}: duplicate pointId {pid} ({p['code']} vs {seen_pid[pid]})")
        seen_pid[pid] = p["code"]
        parents = p.get("parents") or []
        sub_codes = [c for c in parents if c in sub_id_of]
        if len(sub_codes) != 1:
            raise ExportError(f"{slug}: SPEC_POINT {p['code']} has {len(sub_codes)} "
                              f"SUBTOPIC parents ({parents})")
        points_list.append({"id": pid, "text": p["title"],
                            **({"applicability": p["applicability"]}
                               if p.get("applicability") else {})})
        point_subs[sub_id_of[sub_codes[0]]].append(pid)

    # numeric ids must order strictly within a section (port of pointOrd gate)
    # ord key = tuple of numeric components + trailing letter, so multi-level
    # codes (economics '1.1.1a') and letter suffixes ('1.5C', '1.3A' vs '1.3B')
    # order naturally; plain '1.5' sorts before '1.5C'
    def _ord_key(pid: str):
        head = pid.split(".", 1)[0] if "." in pid else pid
        parts = pid.split(".")
        nums = []
        letter = ""
        for i, comp in enumerate(parts):
            if i == 0 and comp == head and len(parts) > 1:
                nums.append(float(comp))
                continue
            m = re.match(r"^(\d+)([A-Za-z]*)$", comp)
            if m:
                nums.append(float(m.group(1)))
                letter = m.group(2) or letter
            else:
                try:
                    nums.append(float(comp.rstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")))
                except ValueError:
                    nums.append(0.0)
        return tuple(nums) + (letter,)

    for key, defs in subtopics_tbl.items():
        secs = {sid[0] for sid, _ in defs}
        if len(secs) != 1:
            raise ExportError(f"{slug}: section {key} subtopic ids span {secs}")
        numeric = [pt["id"] for pt in points_list
                   if "." in pt["id"] and pt["id"].split(".")[0] == key]
        ords = [_ord_key(numeric_id) for numeric_id in numeric]
        if ords != sorted(ords) or len(set(ords)) != len(ords):
            raise ExportError(f"{slug}: point ordering invalid in section {key}")

    # --- nodes & edges (build conventions) --------------------------------
    kg_nodes = [
        {"id": "subject", "type": "Subject", "label": display_subject},
    ]
    for key, meta in sections_tbl.items():
        kg_nodes.append({"id": "sec" + key, "type": "Section", "section": key,
                         "label": meta["label"]})
    for key, defs in subtopics_tbl.items():
        for sid, title in defs:
            kg_nodes.append({"id": sid, "type": "SubTopic", "section": key, "label": title})
    for pt in points_list:
        short = len(pt["id"]) <= 12
        node = {
            "id": "p:" + pt["id"], "pointId": pt["id"], "type": "SpecificationPoint",
            "label": pt["id"] if short else (pt["text"][:48] + "…"
                                             if len(pt["text"]) > 48 else pt["text"]),
            "statement": pt["text"],
        }
        if pt.get("applicability"):
            node["applicability"] = pt["applicability"]
        kg_nodes.append(node)

    edges = [["subject", "sec" + key, "hier"] for key in subtopics_tbl]
    for key, defs in subtopics_tbl.items():
        for sid, _ in defs:
            edges.append(["sec" + key, sid, "hier"])
            for pid in point_subs.get(sid, []):
                edges.append([sid, "p:" + pid, "hier"])

    # --- v1.3: prerequisite / related edges from the committed snapshot ---
    # Projects the operator-validated T-C11 store + the inferred-prototype
    # curation onto the point graph. Courses without a snapshot: no-op.
    prereq_edges, prereq_meta, prereq_validated = load_prerequisites(
        slug, qual_code, seen_pid)
    edges.extend(prereq_edges)

    # --- final validation (contract + referential integrity) --------------
    ids = {n["id"] for n in kg_nodes}
    if len(ids) != len(kg_nodes):
        raise ExportError(f"{slug}: duplicate node ids")
    for n in kg_nodes:
        if n["type"] not in NODE_TYPES:
            raise ExportError(f"{slug}: node {n['id']} has non-contract type {n['type']}")
    for e in edges:
        if e[2] not in EDGE_TYPES:
            raise ExportError(f"{slug}: edge {e} has non-contract type {e[2]}")
        if e[0] not in ids or e[1] not in ids:
            raise ExportError(f"{slug}: dangling edge {e[0]} -> {e[1]}")
    mapped = sum(len(v) for v in point_subs.values())
    if mapped != len(points_list):
        raise ExportError(f"{slug}: mapping covers {mapped}/{len(points_list)} points")
    point_sub_nodes = sum(1 for e in edges if e[2] == "hier" and e[1].startswith("p:"))
    if point_sub_nodes != len(points_list):
        raise ExportError(f"{slug}: hier point edges {point_sub_nodes} != points {len(points_list)}")

    by_type = collections.Counter(n["type"] for n in kg_nodes)
    by_edge = collections.Counter(e[2] for e in edges)
    payload = {
        "meta": {
            "contract": f"GRAPH_CONTRACT v{CONTRACT_VERSION}",
            "course": slug,
            "board": "Pearson Edexcel",
            "level": display_level,
            "subject": display_subject,
            "code": display_code,
            "curriculumCode": qual_code,
            "syllabusVersion": cur.get("syllabusVersion"),
            "source": f"content/{slug}/curriculum.json (curriculum truth, RULE_DERIVED)",
            "exporter": ("scripts/kg_export.py v1.4 (prerequisite projection + "
                         "reversed-pair governance + applicability passthrough)"
                         if unit_layer else
                         "scripts/kg_export.py v1.4 (prerequisite projection + "
                         "reversed-pair governance)"),
            "generatedUtc": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "notes": ("v1.4: hier edges from curriculum truth; prerequisite/related "
                      "edges from the committed T-C11 prerequisite snapshot where "
                      "one exists (operator-validated projection + inferred-prototype "
                      "tier, provenance in meta.prerequisites; reversed cross-product "
                      "pairs suppressed or demoted to rel per the anchor-evidence "
                      "pass) — nothing is invented. "
                      "SpecificationPoint nodes "
                      "and points carry the canonical applicability object "
                      "(printed paper/unit/tier/coursework homes, T-KG-16) "
                      "verbatim from the pinned parse; absent where not derived."
                      + (" Unit layer: printed UNIT nodes export as Sections, "
                         "topics as SubTopics; the curriculum SUBTOPIC layer is "
                         "consumed as the point-mapping level." if unit_layer else "")),
            "counts": {
                "nodes": len(kg_nodes),
                "edges": len(edges),
                "byType": dict(sorted(by_type.items())),
                "byEdgeType": dict(sorted(by_edge.items())),
                "specPoints": by_type["SpecificationPoint"],
            },
            **({"prerequisites": prereq_meta} if prereq_meta else {}),
        },
        # build table shapes (consumed by the loader fork)
        "subjectLabel": display_subject,
        "subjectAnchor": [750, 420],
        "sections": sections_tbl,
        "subtopics": subtopics_tbl,
        "points": points_list,
        "pointSubtopics": {k: v for k, v in point_subs.items()},
        "subPointCounts": {k: len(v) for k, v in point_subs.items()},
        "sectionAnchors": {key: list(section_anchor(int(key) - 1, len(sections_tbl)))
                           for key in sections_tbl},
        "nodes": kg_nodes,
        "edges": edges,
        # per-pair keys of the operator-validated prerequisite tier — the
        # renderer fork's provenance panel reads this to label tiers honestly
        # (only present when a prerequisite snapshot exists — no-snapshot
        # courses keep the exact v1.2 payload shape)
        **({"prereqValidated": prereq_validated} if prereq_validated else {}),
    }
    return payload


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--qual", action="append", default=[],
                    help="course slug to export (repeatable; default: all)")
    ap.add_argument("--check-only", action="store_true", help="validate, write nothing")
    args = ap.parse_args()

    slugs = args.qual
    if not slugs:
        slugs = sorted(p.parent.name for p in CONTENT.glob("*/curriculum.json"))
        if not slugs:
            print("no content bundles found", file=sys.stderr)
            return 2

    registry: dict[str, dict] = {}
    reg_path = CONTENT / "courses.json"
    if reg_path.exists():
        reg_data = json.loads(reg_path.read_text(encoding="utf-8"))
        for entry in (reg_data if isinstance(reg_data, list) else reg_data.get("courses", [])):
            if isinstance(entry, dict) and entry.get("slug"):
                registry[entry["slug"]] = entry

    if not args.check_only:
        OUT_DIR.mkdir(parents=True, exist_ok=True)

    index = []
    failures = 0
    for slug in slugs:
        try:
            payload = export_course(slug, registry)
            counts = payload["meta"]["counts"]
            index.append({
                "slug": slug,
                "subject": payload["meta"]["subject"],
                "code": payload["meta"]["code"],
                "counts": {
                    "nodes": counts["nodes"],
                    "edges": counts["edges"],
                    "specPoints": counts["specPoints"],
                },
            })
            print(f"  ok  {slug:70s} {counts['nodes']:5d} nodes  {counts['edges']:5d} edges  "
                  f"{counts['byType'].get('SubTopic', 0):3d} subs  {counts['specPoints']:4d} pts")
            if not args.check_only:
                out = OUT_DIR / f"{slug}.json"
                out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                               encoding="utf-8")
        except (ExportError, FileNotFoundError, json.JSONDecodeError) as exc:
            failures += 1
            print(f"FAIL  {slug}: {exc}", file=sys.stderr)

    if not args.check_only and not args.qual:
        index_path = OUT_DIR / "index.json"
        index_path.write_text(json.dumps({"generatedFrom": "content/courses.json + "
                                          "curriculum bundles", "courses": index},
                                         ensure_ascii=False, separators=(",", ":")),
                              encoding="utf-8")
        print(f"index: {len(index)} courses -> {index_path}")

    print(f"\n{len(slugs) - failures}/{len(slugs)} courses ok"
          + (" (check-only)" if args.check_only else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
