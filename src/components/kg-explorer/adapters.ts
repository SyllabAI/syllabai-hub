/**
 * kg-explorer host adapters (hub port, teacher console 2026-09-28).
 *
 * Ported from syllabai-web's kg-explorer/adapters.ts (v75 explorer, sessions
 * 129/131) — trimmed to the ONE host the hub's teacher console needs:
 * `classGraphHost` (Class Intelligence's class graph over real core
 * aggregates). The web-only hosts (learner state / mastery map / history /
 * curriculum concept graph) and the web applicability-chip import stay on web.
 */

import type { ClassOverviewView } from "@/lib/types";
import type { KGXEdge, KGXGraph, KGXHost, KGXNode, KGXPanelSection } from "./types";

// ── Class Intelligence — class aggregates over the topic graph ────────────

export function classGraphHost(
  overview: ClassOverviewView,
  drill?: {
    topicNodeId: string;
    affectedLearners: { displayName: string; mastery: number | null; reason: string }[];
  } | null,
  opts?: { onOpenDrillDown?: (topic: ClassOverviewView["topics"][number]) => void },
): KGXHost {
  // build UNIT→TOPIC hierarchy from parentCode (the aggregate carries it)
  const unitByCode = new Map<string, { id: string; title: string }>();
  for (const t of overview.topics) {
    if (t.parentCode && !unitByCode.has(t.parentCode)) {
      unitByCode.set(t.parentCode, { id: `unit:${t.parentCode}`, title: t.parentTitle ?? t.parentCode });
    }
  }
  const rootId = `root:${overview.rootCode}`;

  const nodes: KGXNode[] = [
    {
      id: rootId,
      type: "ROOT",
      title: overview.rootCode,
      parentId: null,
      subtitle: `${overview.enrolledLearners} enrolled · ${overview.learnersWithEvidence} with evidence`,
    },
  ];
  for (const [id, u] of unitByCode) {
    nodes.push({ id: u.id, type: "UNIT", title: u.title, code: id, parentId: rootId });
  }
  for (const t of overview.topics) {
    const parentId = t.parentCode ? `unit:${t.parentCode}` : rootId;
    nodes.push({
      id: t.nodeId,
      type: "TOPIC",
      title: t.title,
      code: t.code,
      parentId,
      mastery: t.meanMastery,
      learnersMeasured: t.learnersMeasured,
      attempts: t.evidenceBackedAttempts,
      reviewDue: t.dueReviews > 0,
      reviewReason: t.dueReviews > 0 ? `${t.dueReviews} reviews due` : null,
      misconception:
        t.learnersWithActiveMisconception > 0
          ? {
              probability: Math.min(1, t.activeMisconceptionSignals / Math.max(1, t.learnersMeasured)),
              active: true,
            }
          : null,
      tutorAsks: t.tutorEngagements,
      badge: t.masteryBand,
      subtitle: `${t.servableQuestions} servable questions`,
    });
  }

  // weak-prerequisite edges: prerequisite → each dependent topic that exists
  const edges: KGXEdge[] = [];
  const topicById = new Map(overview.topics.map((t) => [t.nodeId, t]));
  for (const w of overview.weakPrerequisites) {
    for (const dep of w.dependents) {
      if (!topicById.has(dep.nodeId) || dep.nodeId === w.prerequisiteNodeId) continue;
      edges.push({
        from: w.prerequisiteNodeId,
        to: dep.nodeId,
        kind: "pre",
        label: "Weak prerequisite for",
        provenance: `prereq mean ${w.meanMastery != null ? Math.round(w.meanMastery * 100) + "%" : "—"} · dependent mean ${dep.meanMastery != null ? Math.round(dep.meanMastery * 100) + "%" : "—"}`,
      });
    }
  }

  return {
    graph: { nodes, edges },
    lenses: [
      {
        id: "class",
        label: "Class mastery",
        metric: "class",
        hint: "ring = class mean mastery band (graded evidence only)",
      },
      {
        id: "misconception",
        label: "Misconceptions",
        metric: "misconception",
        hint: "red = topics with learners carrying active misconceptions",
      },
      {
        id: "review",
        label: "Reviews due",
        metric: "review",
        hint: "pulsing = topics with due spaced-repetition reviews",
      },
      {
        id: "engagement",
        label: "Engagement",
        metric: "structure",
        hint: "tutor asks shown in the panel — engagement, never weakness",
      },
    ],
    defaultLensId: "class",
    panelSections: (n) => {
      const t = topicById.get(n.id);
      if (!t) return [];
      const sections: KGXPanelSection[] = [
        {
          title: "Class aggregate",
          rows: [
            { label: "Learners measured", value: `${t.learnersMeasured}/${overview.learnersWithEvidence || overview.enrolledLearners}` },
            { label: "Mean mastery", value: t.meanMastery != null ? `${Math.round(t.meanMastery * 100)}%` : "—" },
            { label: "Band", value: t.masteryBand },
            { label: "Evidence-backed attempts", value: String(t.evidenceBackedAttempts) },
            { label: "Active misconceptions", value: `${t.learnersWithActiveMisconception} learners · ${t.activeMisconceptionSignals} signals` },
            { label: "Tutor asks", value: String(t.tutorEngagements) },
            { label: "Due reviews", value: String(t.dueReviews) },
          ],
        },
      ];
      if (drill && drill.topicNodeId === n.id && drill.affectedLearners.length) {
        sections.push({
          title: "Affected learners (drill-down)",
          note: drill.affectedLearners
            .slice(0, 10)
            .map(
              (l) =>
                `${l.displayName}: ${l.mastery != null ? Math.round(l.mastery * 100) + "%" : "unmeasured"} · ${l.reason.replaceAll("_", " ").toLowerCase()}`,
            )
            .join("\n"),
        });
      }
      return sections;
    },
    nodeActions: opts?.onOpenDrillDown
      ? (n) => {
          const t = topicById.get(n.id);
          return t ? [{ id: "drill", label: "Open drill-down", onSelect: () => opts.onOpenDrillDown!(t) }] : [];
        }
      : undefined,
    caption:
      "Class-level facts only: mastery from graded BKT evidence, misconceptions from BDT estimates, tutor asks are engagement — never weakness (productization sprint §4).",
  };
}
