/**
 * kg-explorer host adapters (hub port, teacher console 2026-09-28).
 *
 * Ported from syllabai-web's kg-explorer/adapters.ts (v75 explorer, sessions
 * 129/131) — trimmed to the ONE host the hub's teacher console needs:
 * `classGraphHost` (Class Intelligence's class graph over real core
 * aggregates). The web-only hosts (learner state / mastery map / history /
 * curriculum concept graph) and the web applicability-chip import stay on web.
 */

import type { ClassKnowledgeGraphView, ClassOverviewView } from "@/lib/types";
import type { KGXEdge, KGXGraph, KGXHost, KGXNode, KGXNodeType, KGXPanelSection } from "./types";

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

// ── F-072 — class knowledge-graph heatmap over the real class payload ────

/** backend NodeType.name() → the KGX family the engine draws */
const KG_NODE_TYPE: Record<string, KGXNodeType> = {
  SUBJECT: "ROOT",
  UNIT: "UNIT",
  TOPIC: "TOPIC",
  SUBTOPIC: "SPEC",
  CONCEPT: "CONCEPT",
  PRACTICAL: "PRACTICAL",
  QUESTION: "QUESTION",
  PAPER: "PAPER",
};

/** the shared backend band vocabulary → the §13.1 words teachers read */
const BAND_LABEL: Record<string, string> = {
  LOW: "Weak",
  DEVELOPING: "Developing",
  SECURE: "Secure",
  UNMEASURED: "Unmeasured",
};

/**
 * The F-072 host: the core ClassKnowledgeGraphView verbatim into KGX —
 * the SAME graph component as every other surface (no second KG
 * implementation), a projection of the read model, nothing invented.
 * The coverage lens states teaching coverage first (solid band ring =
 * taught, dashed grey = not yet taught, ringless = no coverage recorded);
 * the panel shows the §13.3 distribution so a polarized class cannot hide
 * behind its mean.
 */
export function classKnowledgeGraphHost(view: ClassKnowledgeGraphView): KGXHost {
  const wireById = new Map(view.nodes.map((n) => [n.id, n]));
  // the wire carries the tree as childIds — derive parent pointers once
  const parentOf = new Map<string, string>();
  for (const n of view.nodes) {
    for (const childId of n.childIds) parentOf.set(childId, n.id);
  }

  const nodes: KGXNode[] = view.nodes.map((n) => {
    const parent = parentOf.get(n.id);
    const parentNode = parent ? wireById.get(parent) : undefined;
    const badge =
      n.coverageState === "taught"
        ? BAND_LABEL[n.meanBand] ?? n.meanBand
        : n.coverageState === "not-taught"
          ? "Not taught"
          : "No coverage";
    const subtitleParts: string[] = [];
    if (n.type === "SUBTOPIC") {
      // spec point: the parent topic is the orientation
      if (parentNode) subtitleParts.push(parentNode.title);
    } else if (n.specPoints > 0) {
      subtitleParts.push(
        `${n.taughtSpecPoints} of ${n.specPoints} spec points marked taught`,
      );
    }
    return {
      id: n.id,
      type: KG_NODE_TYPE[n.type] ?? "CONCEPT",
      title: n.title,
      code: n.code,
      parentId: parent ?? null,
      subtitle: subtitleParts.length ? subtitleParts.join(" · ") : null,
      badge,
      // the backend mean is the EFFECTIVE (decayed) mean — feed both slots
      mastery: n.meanMastery,
      effectiveMastery: n.meanMastery,
      attempts: n.attempts > 0 ? n.attempts : null,
      correct: n.correctCount > 0 ? n.correctCount : null,
      learnersMeasured: n.learnersMeasured,
      coverageState: n.coverageState,
      distribution: {
        struggling: n.strugglingCount,
        developing: n.developingCount,
        proficient: n.proficientCount,
      },
      misconception:
        n.learnersWithActiveMisconception > 0
          ? {
              probability: Math.min(1, n.learnersWithActiveMisconception / Math.max(1, n.learnersMeasured)),
              active: true,
            }
          : null,
      detail: n.description,
    };
  });

  // prerequisite edges verbatim; endpoints must exist (the engine invariant
  // the student-KG service also enforces — skip, never guess)
  const present = new Set(nodes.map((n) => n.id));
  const edges: KGXEdge[] = view.prerequisiteEdges
    .filter((e) => present.has(e.prerequisiteId) && present.has(e.nodeId))
    .map((e) => ({
      from: e.prerequisiteId,
      to: e.nodeId,
      kind: "pre" as const,
      label: "REQUIRES_PREREQUISITE",
    }));

  return {
    graph: { nodes, edges },
    lenses: [
      {
        id: "coverage",
        label: "Coverage × understanding",
        metric: "class-coverage",
        hint: "solid ring = taught (band = class mean) · dashed grey = not yet taught · no ring = no coverage recorded",
      },
      {
        id: "class",
        label: "Class mastery",
        metric: "class",
        hint: "ring = class mean mastery band (graded evidence, enrolled members only)",
      },
      {
        id: "misconception",
        label: "Misconceptions",
        metric: "misconception",
        hint: "red = nodes where enrolled learners carry active misconceptions",
      },
      {
        id: "structure",
        label: "Curriculum",
        metric: "structure",
        hint: "the plain paper graph",
      },
    ],
    defaultLensId: "coverage",
    panelSections: (n) => {
      const node = wireById.get(n.id);
      if (!node) return [];
      const sections: KGXPanelSection[] = [];

      // §13.4 teaching status — verbatim for spec points, derived elsewhere
      const statusValue =
        node.coverageState === "taught"
          ? "Taught"
          : node.coverageState === "not-taught"
            ? "Not taught yet"
            : "No coverage recorded";
      sections.push({
        title: "Teaching status",
        rows: [{ label: "Status", value: statusValue }],
        note:
          node.type === "SUBTOPIC"
            ? undefined
            : node.specPoints > 0
              ? `Derived from spec points: ${node.taughtSpecPoints} of ${node.specPoints} marked taught (${node.recordedSpecPoints} recorded).`
              : "No specification points under this node.",
      });

      // §13.3 class understanding — the distribution, not just the mean
      if (node.learnersMeasured > 0 && node.meanMastery != null) {
        const measured = node.learnersMeasured;
        sections.push({
          title: "Class understanding",
          rows: [
            { label: "Mean (after decay)", value: `${Math.round(node.meanMastery * 100)}%` },
            {
              label: "Students measured",
              value: `${measured} of ${view.learnersEnrolled} enrolled`,
            },
          ],
          bars: [
            {
              label: "Struggling (low)",
              value: node.strugglingCount / measured,
              caption: `${node.strugglingCount} of ${measured}`,
            },
            {
              label: "Developing",
              value: node.developingCount / measured,
              caption: `${node.developingCount} of ${measured}`,
            },
            {
              label: "Proficient (secure)",
              value: node.proficientCount / measured,
              caption: `${node.proficientCount} of ${measured}`,
            },
          ],
        });
      } else {
        sections.push({
          title: "Class understanding",
          note: "No enrolled student has evidence on this node yet — honestly unmeasured, never zero.",
        });
      }

      if (node.attempts > 0) {
        sections.push({
          title: "Evidence",
          rows: [
            { label: "Evidence-backed attempts", value: String(node.attempts) },
            { label: "Correct", value: String(node.correctCount) },
            {
              label: "Accuracy",
              value: `${Math.round((node.correctCount / node.attempts) * 100)}%`,
            },
            {
              label: "Active misconceptions",
              value: `${node.learnersWithActiveMisconception} learner${node.learnersWithActiveMisconception === 1 ? "" : "s"}`,
            },
          ],
        });
      }
      return sections;
    },
    caption:
      "Member-only aggregation: only this class's enrolled students count — independent students never enter these numbers. Grey/dashed means not yet taught (a teaching-coverage state, NOT a mastery state).",
  };
}
