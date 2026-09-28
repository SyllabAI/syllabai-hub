/**
 * KGX — the normalized graph contract the Knowledge Graph Explorer renders.
 *
 * Ported from the operator's v75 standalone visualizer
 * (syllabai-openhuman-edexcel-chemistry-v75-explainer-lasso-minimap.html):
 * the renderer speaks ONLY this shape, and every host surface (Mastery Map,
 * My State, History, teacher Curriculum Graph, Class Intelligence) adapts its
 * existing backend read model into it. No view invents graph truth — the
 * adapters are projections of the same read models the table views render.
 */

/** Node families the engine knows how to draw (radius, tint, icon defaults). */
export type KGXNodeType =
  | "ROOT" // subject root — largest
  | "UNIT" // curriculum unit / section
  | "TOPIC" // curriculum topic
  | "SUBTOPIC" // optional deeper level
  | "SPEC" // specification point / leaf knowledge node
  | "CONCEPT" // graph-derived concept (teacher concept graph)
  | "PRACTICAL" // practical-skill node (teacher concept graph)
  | "MISCONCEPTION" // misconception node (drawn with the red mark)
  | "QUESTION" // question bank artifact (history lens)
  | "LEARNER" // learner node (class lens)
  | "PAPER"; // exam paper artifact

/** Edge kinds — each has a distinct stroke grammar (v75). */
export type KGXEdgeKind = "hier" | "pre" | "rel" | "assess" | "state";

export interface KGXNode {
  id: string;
  type: KGXNodeType;
  title: string;
  code?: string | null;
  /** second line in the detail panel (e.g. parent title, paper meta) */
  subtitle?: string | null;
  /** small chip next to the title in the panel (e.g. mastery band) */
  badge?: string | null;
  /** parent id — drives the structural layout + breadcrumbs */
  parentId?: string | null;

  // ── overlays (all optional; lenses decide what is emphasized) ────────────
  mastery?: number | null; // 0..1 — stored BKT estimate
  effectiveMastery?: number | null; // 0..1 — after Ebbinghaus decay
  attempts?: number | null;
  correct?: number | null;
  reviewDue?: boolean;
  reviewReason?: string | null;
  misconception?: { probability: number; active: boolean } | null;
  tutorAsks?: number | null;
  /** teacher concept graph: VALIDATED / SUGGESTED / … */
  validationStatus?: string | null;
  /** class lens: how many learners are represented by this aggregate */
  learnersMeasured?: number | null;

  /** extra panel rows (label/value) — facts only, host-authored */
  meta?: { label: string; value: string }[];
  /** longer panel paragraph (explanation, provenance summary, …) */
  detail?: string | null;
}

export interface KGXEdge {
  from: string;
  to: string;
  kind: KGXEdgeKind;
  /** panel label for the edge (e.g. "REQUIRES_PREREQUISITE") */
  label?: string | null;
  validationStatus?: string | null;
  provenance?: string | null;
}

export interface KGXGraph {
  nodes: KGXNode[];
  edges: KGXEdge[];
}

/** What a lens emphasizes — the engine colors/flags nodes accordingly. */
export type KGXMetric =
  | "structure" // no overlay tint — plain paper graph
  | "mastery" // state ring by stored mastery band
  | "effective" // ring by decayed (effective) mastery
  | "review" // review-due pulses
  | "misconception" // active-misconception marks emphasized
  | "activity" // attempts badge + correctness tint
  | "class" // class mean mastery band + signal counts
  | "validation"; // VALIDATED solid / SUGGESTED dashed emphasis

export interface KGXLens {
  id: string;
  label: string;
  metric: KGXMetric;
  /** node types this lens shows (default: all types in the graph) */
  types?: KGXNodeType[];
  /** lens-level hint line rendered under the lens bar */
  hint?: string;
}

/** Data-driven panel sections (the engine renders these below the header). */
export interface KGXPanelSection {
  title: string;
  rows?: { label: string; value: string }[];
  bars?: { label: string; value: number; caption?: string }[]; // value 0..1
  chips?: string[];
  note?: string;
}

/** Host-provided action button on a node panel (callback closes over React). */
export interface KGXAction {
  id: string;
  label: string;
  onSelect: (nodeId: string) => void;
}

export interface KGXHost {
  graph: KGXGraph;
  lenses: KGXLens[];
  defaultLensId?: string;
  /** per-node panel sections beyond the engine's standard overlay block */
  panelSections?: (node: KGXNode) => KGXPanelSection[];
  /** action buttons per node (e.g. "Practice this topic") */
  nodeActions?: (node: KGXNode) => KGXAction[];
  /** fired when the selection becomes a two-node compare */
  compareSections?: (a: KGXNode, b: KGXNode) => KGXPanelSection[];
  /** optional caption under the graph (honesty line) */
  caption?: string;
}
