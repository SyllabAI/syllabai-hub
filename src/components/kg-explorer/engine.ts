/**
 * KGExplorerEngine — an imperative SVG engine ported from the operator's v75
 * standalone visualizer (openhuman-edexcel-chemistry-kg, "explainer · lasso ·
 * minimap"). Mounted inside a React wrapper (KGExplorer.tsx) which owns the
 * lifecycle; the engine owns the DOM it creates, the camera, the simulation
 * and all interaction state.
 *
 * Ported interaction grammar (v73-v75):
 * - anchored-relaxation simulation (home spring + collision + edge springs)
 * - pan / zoom-to-pointer / node drag with physics reheat
 * - lenses (host-defined) + relation-kind filters
 * - search with results, breadcrumbs, semantic-zoom labels
 * - node panel (data-driven sections + host actions) and EDGE panel
 *   (the v75 edge explainer: what the edge means, how to read it, provenance)
 * - exploration: neighborhood expansion, connected-only, A→B path trace with
 *   numbered badges, exploration trail (back/forward)
 * - multi-select: Shift+click, rectangle lasso (Shift+drag or armed), pins,
 *   two-node compare, selection bar
 * - minimap: live dot cloud + viewport rectangle, drag to pan, click to focus
 * - keyboard navigation (family moves, /, Esc, +/-, f, l, m, p, c, t)
 *
 * Deliberately NOT ported (documented, not silent): saved graph views +
 * camera fly-to restore animation (v74), inline spec-card morphing, the
 * command palette, and the demo intervention-cycle animation — the host
 * surfaces provide their own summaries and drill-downs.
 */
import { computeAnchors, type AnchoredNode } from "./layout";
import { KGX_CSS } from "./styles";
import type {
  KGXEdge,
  KGXEdgeKind,
  KGXGraph,
  KGXHost,
  KGXNode,
  KGXNodeType,
  KGXPanelSection,
} from "./types";

const NS = "http://www.w3.org/2000/svg";
const TYPE_RADIUS: Record<KGXNodeType, number> = {
  ROOT: 34,
  UNIT: 24,
  TOPIC: 17,
  SUBTOPIC: 13,
  SPEC: 7,
  CONCEPT: 11,
  PRACTICAL: 9,
  MISCONCEPTION: 9,
  QUESTION: 9,
  LEARNER: 10,
  PAPER: 15,
};
const TYPE_COLOR: Record<KGXNodeType, string> = {
  ROOT: "#6656a9",
  UNIT: "#2a8b8a",
  TOPIC: "#3d79a6",
  SUBTOPIC: "#3d79a6",
  SPEC: "#3d79a6",
  CONCEPT: "#4a9b70",
  PRACTICAL: "#c38422",
  MISCONCEPTION: "#b85a52",
  QUESTION: "#c38422",
  LEARNER: "#4a9b70",
  PAPER: "#c38422",
};
const TYPE_LABEL: Record<KGXNodeType, string> = {
  ROOT: "Subject",
  UNIT: "Unit",
  TOPIC: "Topic",
  SUBTOPIC: "Subtopic",
  SPEC: "Spec point",
  CONCEPT: "Concept",
  PRACTICAL: "Practical",
  MISCONCEPTION: "Misconception",
  QUESTION: "Question",
  LEARNER: "Learner",
  PAPER: "Exam paper",
};
const EDGE_KIND_LABEL: Record<KGXEdgeKind, { name: string; meaning: string; read: string }> = {
  hier: {
    name: "Part of curriculum",
    meaning: "The source node is a structural child of the target — this is the official curriculum containment, not a learning claim.",
    read: "Read it as file-system containment: everything inside the parent belongs to that part of the syllabus.",
  },
  pre: {
    name: "Requires prerequisite",
    meaning: "The source topic depends on the target: understanding the target first measurably helps with the source.",
    read: "Read the arrow as “learn the target first”. It points from the dependent topic back to its prerequisite.",
  },
  rel: {
    name: "Related concept",
    meaning: "A semantic link between two nodes that are not in a parent–child or prerequisite relationship — they illuminate each other.",
    read: "Read it as “see also” — useful for revision pairing, not a learning order.",
  },
  assess: {
    name: "Assessed by",
    meaning: "The target node is assessment material (a question or paper) that measures the source knowledge.",
    read: "Read it as “this is where this knowledge gets examined”.",
  },
  state: {
    name: "Learner-state link",
    meaning: "This edge carries the learner's own measured state — for example a misconception node attached to the topic it corrupts.",
    read: "Read it as “my state on the source is described by the target”.",
  },
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(NS, tag) as SVGElementTagNameMap[K];
}
function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}
function bandColor(v: number | null | undefined): string | null {
  if (v == null) return null;
  if (v < 0.55) return "#c85b78";
  if (v < 0.7) return "#c38422";
  if (v < 0.85) return "#4a9b70";
  return "#2a8b8a";
}
function bandLabel(v: number | null | undefined): string {
  if (v == null) return "Not measured";
  if (v < 0.55) return "Weak";
  if (v < 0.7) return "Developing";
  if (v < 0.85) return "Good";
  return "Strong";
}

interface RT extends AnchoredNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
interface EFE extends KGXEdge {
  id: string;
  rtFrom: string;
  rtTo: string;
}

export interface KGXOptions {
  height?: number;
  title?: string;
  subtitle?: string;
}

export class KGExplorerEngine {
  private host: KGXHost;
  private opts: Required<KGXOptions>;
  private container: HTMLElement;

  private svg!: SVGSVGElement;
  private rootG!: SVGGElement;
  private edgeG!: SVGGElement;
  private nodeG!: SVGGElement;
  private lassoG!: SVGGElement;
  private defs!: SVGDefsElement;

  private hudSub!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private resultsBox!: HTMLElement;
  private lensBar!: HTMLElement;
  private relBar!: HTMLElement;
  private trailBar!: HTMLElement;
  private controls!: HTMLElement;
  private crumbs!: HTMLElement;
  private statusEl!: HTMLElement;
  private selBar!: HTMLElement;
  private selInfo!: HTMLElement;
  private panel!: HTMLElement;
  private panelBody!: HTMLElement;
  private miniBox!: HTMLElement;
  private miniSvg!: SVGSVGElement;
  private lassoHint!: HTMLElement;
  private captionEl!: HTMLElement;

  private W = 1200;
  private H = 640;

  private nodes: RT[] = [];
  private nodeById = new Map<string, RT>();
  private edges: EFE[] = [];
  private nodeEls = new Map<string, SVGGElement>();

  private lensId = "";
  private relFilters = new Set<KGXEdgeKind>();
  private tx = 0;
  private ty = 0;
  private scale = 1;
  private alpha = 0;
  private raf = 0;
  private simRunning = false;

  private selected: string | null = null;
  private selectedEdge: EFE | null = null;
  private hovered: string | null = null;
  private keyboardId: string | null = null;
  private drag:
    | { kind: "pan"; x: number; y: number; moved: boolean; pointerId: number }
    | { kind: "node"; id: string; x: number; y: number; moved: boolean; pointerId: number }
    | { kind: "lasso"; x: number; y: number; moved: boolean; pointerId: number }
    | null = null;
  private lasso: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private lassoArmed = false;
  private miniOpen = true;
  private connectedOnly = false;
  private connectedSet: Set<string> | null = null;
  private connectedRoot: string | null = null;
  private pinned = new Set<string>();
  private multiSelect = new Set<string>();
  private compare: { a: string; b: string } | null = null;
  // v75 reveal gating: deeper levels stay hidden until their parent is
  // double-clicked (the reference's isSpecRevealed / state.expanded)
  private expanded = new Set<string>();
  private structuralKids = new Map<string, KGXNode[]>();
  // v75 `appearing`: nodes mid-reveal glide parent→home outside the physics
  private appearing = new Map<
    string,
    { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number }
  >();
  private appearRaf = 0;
  private trace: { active: boolean; stage: "from" | "to"; from: string | null; nodes: string[] } = {
    active: false,
    stage: "from",
    from: null,
    nodes: [],
  };
  private trail: string[] = [];
  private trailPos = -1;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private listeners: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = [];
  private destroyed = false;

  constructor(container: HTMLElement, host: KGXHost, options?: KGXOptions) {
    this.container = container;
    this.host = host;
    this.opts = {
      height: options?.height ?? 620,
      title: options?.title ?? "Knowledge graph explorer",
      subtitle: options?.subtitle ?? "",
    };
    this.injectStyles();
    this.buildDom();
    this.rebuild();
    this.bindGlobal();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.appearRaf);
    this.appearRaf = 0;
    this.appearing.clear();
    this.resizeObserver?.disconnect();
    for (const [t, ev, fn] of this.listeners) t.removeEventListener(ev, fn);
    this.listeners = [];
    this.container.innerHTML = "";
  }

  setHost(host: KGXHost): void {
    this.host = host;
    this.rebuild();
  }

  // ── construction ─────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById("kgx-styles")) return;
    const style = el("style");
    style.id = "kgx-styles";
    style.textContent = KGX_CSS;
    document.head.appendChild(style);
  }

  private buildDom(): void {
    const root = el("div", "kgx");
    root.style.height = `${this.opts.height}px`;
    this.container.appendChild(root);

    this.svg = svgEl("svg");
    this.svg.setAttribute("class", "kgx-svg");
    this.svg.setAttribute("tabindex", "0");
    this.svg.setAttribute("role", "application");
    this.svg.setAttribute("aria-label", `${this.opts.title} — graph canvas. Arrow keys move between nodes, Enter opens details, Escape clears.`);
    root.appendChild(this.svg);

    this.defs = svgEl("defs");
    const marker = svgEl("marker");
    marker.setAttribute("id", "kgxArrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto-start-reverse");
    const path = svgEl("path");
    path.setAttribute("d", "M 0 1 L 9 5 L 0 9 z");
    path.setAttribute("fill", "#4b6f88");
    marker.appendChild(path);
    this.defs.appendChild(marker);
    const traceMarker = svgEl("marker");
    traceMarker.setAttribute("id", "kgxTraceArrow");
    traceMarker.setAttribute("viewBox", "0 0 10 10");
    traceMarker.setAttribute("refX", "9");
    traceMarker.setAttribute("refY", "5");
    traceMarker.setAttribute("markerWidth", "7");
    traceMarker.setAttribute("markerHeight", "7");
    traceMarker.setAttribute("orient", "auto-start-reverse");
    const tpath = svgEl("path");
    tpath.setAttribute("d", "M 0 1 L 9 5 L 0 9 z");
    tpath.setAttribute("fill", "#6656a9");
    traceMarker.appendChild(tpath);
    this.defs.appendChild(traceMarker);
    this.svg.appendChild(this.defs);

    this.rootG = svgEl("g");
    this.edgeG = svgEl("g");
    this.nodeG = svgEl("g");
    this.rootG.append(this.edgeG, this.nodeG);
    this.svg.appendChild(this.rootG);
    this.lassoG = svgEl("g");
    this.lassoG.setAttribute("aria-hidden", "true");
    this.svg.appendChild(this.lassoG);

    const hud = el("div", "kgx-hud");
    hud.appendChild(el("div", "t", this.opts.title));
    this.hudSub = el("div", "s", this.opts.subtitle);
    hud.appendChild(this.hudSub);
    root.appendChild(hud);

    const searchWrap = el("div", "kgx-search");
    this.searchInput = el("input") as HTMLInputElement;
    this.searchInput.type = "search";
    this.searchInput.placeholder = "Search nodes…  ( / )";
    this.searchInput.setAttribute("aria-label", "Search graph nodes");
    searchWrap.appendChild(this.searchInput);
    root.appendChild(searchWrap);
    this.resultsBox = el("div", "kgx-results");
    this.resultsBox.style.display = "none";
    root.appendChild(this.resultsBox);

    this.lensBar = el("div", "kgx-lensbar");
    this.lensBar.setAttribute("role", "tablist");
    root.appendChild(this.lensBar);

    this.relBar = el("div", "kgx-relbar");
    root.appendChild(this.relBar);

    this.trailBar = el("div", "kgx-trail");
    root.appendChild(this.trailBar);

    this.controls = el("div", "kgx-controls");
    root.appendChild(this.controls);

    this.crumbs = el("div", "kgx-crumbs");
    this.crumbs.style.display = "none";
    root.appendChild(this.crumbs);

    this.statusEl = el("div", "kgx-status");
    this.statusEl.style.display = "none";
    root.appendChild(this.statusEl);

    this.selBar = el("div", "kgx-selbar");
    this.selInfo = el("span");
    this.selBar.appendChild(this.selInfo);
    root.appendChild(this.selBar);

    this.panel = el("div", "kgx-panel");
    const closeBtn = el("button", "close", "×");
    closeBtn.setAttribute("aria-label", "Close details");
    closeBtn.type = "button";
    this.panel.appendChild(closeBtn);
    this.panelBody = el("div");
    this.panel.appendChild(this.panelBody);
    root.appendChild(this.panel);

    this.lassoHint = el("div", "kgx-lasso-hint", "Lasso armed — drag on empty canvas to select the enclosed nodes (Esc cancels)");
    root.appendChild(this.lassoHint);

    this.miniBox = el("div", "kgx-minimap");
    this.miniSvg = svgEl("svg");
    this.miniSvg.setAttribute("width", "180");
    this.miniSvg.setAttribute("height", "102");
    this.miniBox.appendChild(this.miniSvg);
    root.appendChild(this.miniBox);

    this.captionEl = el("div", "kgx-caption");
    root.appendChild(this.captionEl);

    closeBtn.addEventListener("click", () => this.clearSelection());
    this.searchInput.addEventListener("input", () => this.renderSearchResults());
    this.searchInput.addEventListener("keydown", (e) => this.onSearchKey(e as KeyboardEvent));

    this.svg.addEventListener("wheel", (e) => this.onWheel(e as WheelEvent), { passive: false });
    this.svg.addEventListener("pointerdown", (e) => this.onPointerDown(e as PointerEvent));
    this.svg.addEventListener("pointermove", (e) => this.onPointerMove(e as PointerEvent));
    this.svg.addEventListener("pointerup", (e) => this.onPointerUp(e as PointerEvent));
    this.svg.addEventListener("pointercancel", (e) => this.onPointerUp(e as PointerEvent));
    this.svg.addEventListener("dblclick", (e) => this.onDblClick(e as MouseEvent));
    this.svg.addEventListener("keydown", (e) => this.onKey(e as KeyboardEvent));
    this.svg.addEventListener("mouseleave", () => {
      if (this.hovered) {
        this.hovered = null;
        this.refresh();
      }
    });
    this.miniBox.addEventListener("pointerdown", (e) => this.onMiniDown(e as PointerEvent));
    this.miniBox.addEventListener("pointermove", (e) => this.onMiniMove(e as PointerEvent));
    this.miniBox.addEventListener("pointerup", () => (this.drag = null));

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(root);
  }

  private bindGlobal(): void {
    // No global listeners needed today — kept for symmetry with destroy().
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    if (w > 0) {
      this.W = w;
      this.H = this.opts.height;
      this.svg.setAttribute("viewBox", `0 0 ${this.W} ${this.H}`);
      this.updateMinimap();
    }
  }

  // ── data (re)build ───────────────────────────────────────────────────────

  private rebuild(): void {
    const graph: KGXGraph = this.host.graph;
    const anchored = computeAnchors(graph);
    this.nodes = anchored.map((a) => ({ ...a, x: a.homeX, y: a.homeY, vx: 0, vy: 0 }));
    this.nodeById = new Map(this.nodes.map((n) => [n.id, n]));

    const hierEdges: EFE[] = [];
    for (const n of this.nodes) {
      // misconceptions are state overlays, never curriculum structure —
      // they link to their parent as a state edge below
      if (n.type === "MISCONCEPTION") continue;
      if (n.parentId && this.nodeById.has(n.parentId)) {
        hierEdges.push({
          from: n.id,
          to: n.parentId,
          kind: "hier",
          label: "Part of curriculum",
          id: `h|${n.id}|${n.parentId}`,
          rtFrom: n.id,
          rtTo: n.parentId,
        });
      }
    }
    // host-supplied semantic edges (prerequisites, state links, provenance)
    const semantic: EFE[] = [];
    for (const e of graph.edges) {
      const from = e.from;
      const to = e.to;
      if (!this.nodeById.has(from) || !this.nodeById.has(to)) continue;
      semantic.push({ ...e, id: `${e.kind}|${from}|${to}`, rtFrom: from, rtTo: to });
    }
    // misconception → parent state edges: parentId collars the node in the
    // layout; the link itself is always a state edge (never hierarchy), and
    // the host's own state edge wins when it supplied a richer label
    for (const n of this.nodes) {
      if (n.type === "MISCONCEPTION" && n.parentId && this.nodeById.has(n.parentId)) {
        const has = semantic.some(
          (h) => (h.rtFrom === n.id && h.rtTo === n.parentId) || (h.rtFrom === n.parentId && h.rtTo === n.id),
        );
        if (!has) {
          semantic.push({
            from: n.id,
            to: n.parentId,
            kind: "state",
            label: "Misconception attached to topic",
            id: `state|${n.id}|${n.parentId}`,
            rtFrom: n.id,
            rtTo: n.parentId,
          });
        }
      }
    }
    this.edges = [...hierEdges, ...semantic];
    this.relFilters = new Set(this.edges.map((e) => e.kind));

    // structural children (curriculum tree, misconceptions excluded — they
    // follow their parent as state overlays) drive expand/collapse + badges
    this.structuralKids = new Map();
    for (const n of this.nodes) {
      if (n.type === "MISCONCEPTION" || !n.parentId) continue;
      const arr = this.structuralKids.get(n.parentId);
      if (arr) arr.push(n);
      else this.structuralKids.set(n.parentId, [n]);
    }
    this.expanded = new Set();

    // reset interaction state
    this.selected = null;
    this.selectedEdge = null;
    this.hovered = null;
    this.keyboardId = this.nodes[0]?.id ?? null;
    this.pinned = new Set();
    this.multiSelect = new Set();
    this.compare = null;
    this.connectedOnly = false;
    this.connectedSet = null;
    this.connectedRoot = null;
    this.trace = { active: false, stage: "from", from: null, nodes: [] };
    this.trail = [];
    this.trailPos = -1;

    this.buildLensBar();
    this.buildRelBar();
    this.buildTrailBar();
    this.buildControls();
    this.captionEl.textContent = this.host.caption ?? "";
    this.updateSelBar();
    this.panel.classList.remove("show");
    this.crumbs.style.display = "none";

    this.rebuildNodeDom();
    this.fitView();
    this.bootSim();
    this.refresh();
    this.updateMinimap();
    const collapsed = this.nodes.filter((n) => this.collapsedChildCount(n) > 0).length;
    this.status(
      collapsed > 0
        ? "Double-click a node with a +badge to reveal its items · search jumps anywhere"
        : "Explore · search or select a node",
    );
  }

  private rebuildNodeDom(): void {
    this.nodeG.innerHTML = "";
    this.nodeEls.clear();
    const visible = new Set(this.activeNodes().map((n) => n.id));
    for (const n of this.nodes) {
      if (!visible.has(n.id)) continue;
      const g = this.nodeSvg(n);
      this.nodeG.appendChild(g);
      this.nodeEls.set(n.id, g);
    }
  }

  private activeNodes(): RT[] {
    const lens = this.currentLens();
    const types = new Set<KGXNodeType>(lens.types ?? this.allTypes());
    return this.nodes.filter((n) => {
      if (!types.has(n.type)) return false;
      if (!this.isRevealed(n)) return false;
      if (this.connectedOnly && this.connectedSet) {
        return this.connectedSet.has(n.id) || this.pinned.has(n.id);
      }
      return true;
    });
  }

  private allTypes(): KGXNodeType[] {
    return [...new Set(this.nodes.map((n) => n.type))];
  }

  private currentLens() {
    return this.host.lenses.find((l) => l.id === this.lensId) ?? this.host.lenses[0];
  }

  private activeEdges(): EFE[] {
    const visible = new Set(this.activeNodes().map((n) => n.id));
    return this.edges.filter(
      (e) => this.relFilters.has(e.kind) && visible.has(e.rtFrom) && visible.has(e.rtTo),
    );
  }

  // ── chrome builders ──────────────────────────────────────────────────────

  private buildLensBar(): void {
    this.lensBar.innerHTML = "";
    const def = this.host.defaultLensId ?? this.host.lenses[0]?.id;
    if (!this.lensId || !this.host.lenses.some((l) => l.id === this.lensId)) this.lensId = def;
    for (const lens of this.host.lenses) {
      const b = el("button", "kgx-btn" + (lens.id === this.lensId ? " active" : ""), lens.label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(lens.id === this.lensId));
      b.addEventListener("click", () => {
        this.lensId = lens.id;
        this.buildLensBar();
        this.buildRelBar();
        this.rebuildNodeDom();
        this.fitView();
        this.bootSim();
        this.refresh();
        this.updateMinimap();
        this.status(lens.hint ?? `Lens: ${lens.label}`);
      });
      this.lensBar.appendChild(b);
    }
    const hint = this.currentLens()?.hint;
    this.hudSub.textContent = [this.opts.subtitle, hint].filter(Boolean).join(" · ");
  }

  private buildRelBar(): void {
    this.relBar.innerHTML = "";
    const kinds = [...new Set(this.edges.map((e) => e.kind))];
    if (kinds.length <= 1) return;
    for (const kind of kinds) {
      const wrap = el("button", "kgx-btn" + (this.relFilters.has(kind) ? " active" : ""));
      wrap.type = "button";
      const key = el("span", `relKey ${kind}`);
      wrap.appendChild(key);
      wrap.appendChild(document.createTextNode(EDGE_KIND_LABEL[kind].name));
      wrap.title = `${EDGE_KIND_LABEL[kind].name} — ${this.edges.filter((e) => e.kind === kind).length} edges`;
      wrap.addEventListener("click", () => {
        if (this.relFilters.has(kind)) this.relFilters.delete(kind);
        else this.relFilters.add(kind);
        this.buildRelBar();
        this.refresh();
      });
      this.relBar.appendChild(wrap);
    }
  }

  private buildTrailBar(): void {
    this.trailBar.innerHTML = "";
    const back = el("button", "kgx-btn", "‹ Back");
    const fwd = el("button", "kgx-btn", "Forward ›");
    back.type = fwd.type = "button";
    back.disabled = this.trailPos <= 0;
    fwd.disabled = this.trailPos >= this.trail.length - 1;
    back.addEventListener("click", () => this.goTrail(-1));
    fwd.addEventListener("click", () => this.goTrail(1));
    this.trailBar.append(back, fwd);
  }

  private buildControls(): void {
    this.controls.innerHTML = "";
    const mk = (label: string, title: string, fn: () => void, toggle = false) => {
      const b = el("button", "kgx-btn", label);
      b.type = "button";
      b.title = title;
      b.addEventListener("click", () => {
        fn();
        if (toggle) b.classList.toggle("on");
      });
      this.controls.appendChild(b);
      return b;
    };
    mk("+", "Zoom in (key: +)", () => this.zoomBy(1.25));
    mk("−", "Zoom out (key: −)", () => this.zoomBy(0.8));
    mk("⤢", "Fit graph to view (key: f)", () => this.fitView());
    const lassoBtn = mk("◌", "Arm lasso — then drag on empty canvas (or Shift+drag anytime). Key: l", () => {
      this.lassoArmed = !this.lassoArmed;
      this.lassoHint.classList.toggle("show", this.lassoArmed);
    });
    lassoBtn.addEventListener("click", () => lassoBtn.classList.toggle("on"));
    const miniBtn = mk("▣", "Toggle minimap (key: m)", () => {
      this.miniOpen = !this.miniOpen;
      this.miniBox.style.display = this.miniOpen ? "" : "none";
      miniBtn.classList.toggle("on", this.miniOpen);
    });
    miniBtn.classList.toggle("on", this.miniOpen);
    const connBtn = mk("◍", "Connected-only: keep just the selected node's neighborhood (key: c)", () => {
      this.toggleConnected();
      connBtn.classList.toggle("on", this.connectedOnly);
    });
    connBtn.classList.toggle("on", this.connectedOnly);
    mk("⇄", "Trace a path between two nodes (key: t)", () => this.beginTrace());
  }

  // ── camera ───────────────────────────────────────────────────────────────

  private applyTransform(): void {
    this.rootG.setAttribute("transform", `translate(${this.tx} ${this.ty}) scale(${this.scale})`);
    this.updateMinimap();
  }

  private fitView(): void {
    const ns = this.activeNodes();
    if (!ns.length) {
      this.tx = this.W / 2;
      this.ty = this.H / 2;
      this.scale = 1;
      this.applyTransform();
      return;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of ns) {
      if (n.x < x0) x0 = n.x;
      if (n.x > x1) x1 = n.x;
      if (n.y < y0) y0 = n.y;
      if (n.y > y1) y1 = n.y;
    }
    const pad = 70;
    const w = Math.max(60, x1 - x0);
    const h = Math.max(60, y1 - y0);
    this.scale = Math.max(0.32, Math.min(2.4, Math.min((this.W - pad * 2) / w, (this.H - pad * 2) / h)));
    this.tx = this.W / 2 - ((x0 + x1) / 2) * this.scale;
    this.ty = this.H / 2 - ((y0 + y1) / 2) * this.scale;
    this.applyTransform();
  }

  private zoomBy(f: number): void {
    const next = Math.max(0.32, Math.min(3.3, this.scale * f));
    const mx = this.W / 2;
    const my = this.H / 2;
    this.tx = mx - (mx - this.tx) * (next / this.scale);
    this.ty = my - (my - this.ty) * (next / this.scale);
    this.scale = next;
    this.applyTransform();
    this.refresh();
  }

  private centerOn(n: RT, targetScale?: number): void {
    const s = Math.max(0.9, Math.min(2.2, targetScale ?? Math.max(1.15, this.scale + 0.25)));
    this.tx = this.W / 2 - n.x * s;
    this.ty = this.H / 2 - n.y * s;
    this.scale = s;
    this.applyTransform();
    this.refresh();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const next = Math.max(0.32, Math.min(3.3, this.scale * factor));
    this.tx = mx - (mx - this.tx) * (next / this.scale);
    this.ty = my - (my - this.ty) * (next / this.scale);
    this.scale = next;
    this.applyTransform();
    this.refresh();
  }

  // ── simulation (v75 anchored relaxation) ────────────────────────────────

  /** initial mount — v75 bootSimulation() */
  private bootSim(): void {
    this.alpha = 0.9;
    if (!this.simRunning) {
      this.simRunning = true;
      this.raf = requestAnimationFrame(() => this.simTick());
    }
  }

  /** v75 reheat(a=.28): nudge the physics without resetting it — interactions
   * use small values (0.12–0.18), drags 0.85–0.95, reveals NONE (the appear
   * animation is the motion; reheating after a reveal is what blows flowers
   * apart — measured in session-131) */
  private reheat(a = 0.28): void {
    this.alpha = Math.max(this.alpha || 0, a);
    if (!this.simRunning) {
      this.simRunning = true;
      this.raf = requestAnimationFrame(() => this.simTick());
    }
  }

  private simTick(): void {
    if (this.destroyed) return;
    let a = this.alpha || 0;
    // v75: nodes mid-reveal are EXCLUDED from the physics — they glide from
    // their parent to their home via the appear animation instead of
    // exploding out of a multi-node collision at the spawn point
    const nodes = this.activeNodes().filter((n) => !this.appearing.has(n.id));
    const nodeSet = new Set(nodes.map((n) => n.id));
    const edges = this.activeEdges();
    const draggedId = this.drag?.kind === "node" ? this.drag.id : null;

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const nDrag = n.id === draggedId;
      let fx = 0;
      let fy = 0;
      if (!nDrag) {
        fx += (n.homeX - n.x) * 0.022;
        fy += (n.homeY - n.y) * 0.022;
      }
      for (let j = i + 1; j < nodes.length; j++) {
        const m = nodes[j];
        const mDrag = m.id === draggedId;
        const dx = n.x - m.x;
        const dy = n.y - m.y;
        // v75: collisionRadius(a) + collisionRadius(b) + 8
        const minDist = TYPE_RADIUS[n.type] + TYPE_RADIUS[m.type] + 8;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const d2 = dx * dx + dy * dy + 180;
        const gap = Math.max(0, minDist - dist);
        const f = 18000 / d2 + Math.min(18, gap * 0.9);
        const inv = 1 / Math.sqrt(d2);
        const rfx = dx * inv * f;
        const rfy = dy * inv * f;
        if (!nDrag) {
          fx += rfx;
          fy += rfy;
        }
        if (!mDrag) {
          m.vx -= rfx * a;
          m.vy -= rfy * a;
        }
      }
      if (!nDrag) {
        n.vx += fx * a;
        n.vy += fy * a;
      }
    }

    // v75 edge springs — targets keyed to the hierarchy level of the link:
    // subject↔child 205, section↔child 120, subtopic↔child 72, deeper 38;
    // prerequisites 115 / other relations 145 (state collars 55)
    for (const e of edges) {
      const n = this.nodeById.get(e.rtFrom);
      const m = this.nodeById.get(e.rtTo);
      if (!n || !m || !nodeSet.has(n.id) || !nodeSet.has(m.id)) continue;
      const nDrag = n.id === draggedId;
      const mDrag = m.id === draggedId;
      const dx = m.x - n.x;
      const dy = m.y - n.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const isRoot = n.type === "ROOT" || m.type === "ROOT";
      const isUnit = n.type === "UNIT" || m.type === "UNIT";
      const isTopic = n.type === "TOPIC" || m.type === "TOPIC";
      const target =
        e.kind === "hier"
          ? isRoot
            ? 205
            : isUnit
              ? 120
              : isTopic
                ? 72
                : 38
          : e.kind === "pre"
            ? 115
            : e.kind === "state"
              ? 55
              : 145;
      const k = e.kind === "hier" ? 0.028 : e.kind === "pre" ? 0.012 : 0.008;
      const f = (d - target) * k;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      if (!nDrag) {
        n.vx += fx * a;
        n.vy += fy * a;
      }
      if (!mDrag) {
        m.vx -= fx * a;
        m.vy -= fy * a;
      }
    }

    for (const n of nodes) {
      if (n.id === draggedId) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= 0.84;
      n.vy *= 0.84;
      n.x += n.vx;
      n.y += n.vy;
    }
    this.updatePositions();
    a *= 0.94;
    this.alpha = a;
    if (a > 0.012) {
      this.raf = requestAnimationFrame(() => this.simTick());
    } else {
      this.simRunning = false;
      this.updatePositions();
      this.updateMinimap();
    }
  }

  private depth(n: RT): number {
    let d = 0;
    let cur: RT | undefined = n;
    const guard = new Set<string>();
    while (cur?.parentId && !guard.has(cur.id)) {
      guard.add(cur.id);
      cur = this.nodeById.get(cur.parentId);
      d += 1;
    }
    return d;
  }

  private updatePositions(): void {
    for (const n of this.activeNodes()) {
      const g = this.nodeEls.get(n.id);
      if (g) g.setAttribute("transform", `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`);
    }
    this.drawEdges();
  }

  // ── rendering ────────────────────────────────────────────────────────────

  private nodeSvg(n: RT): SVGGElement {
    const g = svgEl("g");
    g.setAttribute("class", "node");
    g.setAttribute("transform", `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`);
    g.dataset.id = n.id;
    const r = TYPE_RADIUS[n.type];
    const color = TYPE_COLOR[n.type];

    const halo = svgEl("circle");
    halo.setAttribute("class", "halo");
    halo.setAttribute("r", String(r + 5));
    halo.setAttribute("stroke", color);
    g.appendChild(halo);

    const body = svgEl("circle");
    body.setAttribute("class", "body");
    body.setAttribute("r", String(r));
    body.setAttribute("stroke", color);
    if (n.validationStatus && n.validationStatus !== "VALIDATED") {
      body.setAttribute("stroke-dasharray", "3 3");
    }
    g.appendChild(body);

    // state ring by lens metric
    const ring = this.ringFor(n);
    if (ring) {
      const rc = svgEl("circle");
      rc.setAttribute("class", "stateRing");
      rc.setAttribute("r", String(r + 3.4));
      rc.setAttribute("stroke", ring);
      if (this.currentLens().metric === "validation" && n.validationStatus !== "VALIDATED") {
        rc.setAttribute("stroke-dasharray", "2 3");
      }
      g.appendChild(rc);
    }
    if (n.reviewDue) {
      const pulse = svgEl("circle");
      pulse.setAttribute("class", "reviewPulse");
      pulse.setAttribute("r", String(r + 8));
      g.appendChild(pulse);
    }
    if (n.type === "MISCONCEPTION" || (n.misconception?.active ?? false)) {
      const mark = svgEl("path");
      const mr = Math.min(6, r * 0.7);
      mark.setAttribute("class", "misconMark");
      mark.setAttribute("d", `M ${n.x + r + 1} ${n.y - r - 1} l ${mr * 1.6} 0 l ${-mr * 0.8} ${mr * 1.4} z`);
      mark.setAttribute("transform", `translate(${-n.x} ${-n.y})`); // path built in absolute node space
      g.appendChild(mark);
    }
    if (this.currentLens().metric === "activity" && n.attempts != null && n.attempts > 0) {
      const bc = svgEl("circle");
      bc.setAttribute("cx", String(r - 1));
      bc.setAttribute("cy", String(-r + 1));
      bc.setAttribute("r", "6.5");
      bc.setAttribute("fill", "#4e585d");
      g.appendChild(bc);
      const bt = svgEl("text");
      bt.setAttribute("class", "attemptsBadge");
      bt.setAttribute("x", String(r - 1));
      bt.setAttribute("y", String(-r + 3.6));
      bt.setAttribute("text-anchor", "middle");
      bt.textContent = String(n.attempts > 99 ? "99+" : n.attempts);
      g.appendChild(bt);
    }

    const label = svgEl("text");
    label.setAttribute("class", "label");
    label.setAttribute("y", String(r + 13));
    label.setAttribute("text-anchor", "middle");
    label.textContent = this.shortLabel(n);
    g.appendChild(label);

    // +N badge: hidden structural children await a double-click (v75's
    // subtopic spec-count hint)
    const hiddenKids = this.collapsedChildCount(n);
    if (hiddenKids > 0) {
      const bc = svgEl("circle");
      bc.setAttribute("cx", String(-r + 2));
      bc.setAttribute("cy", String(r - 2));
      bc.setAttribute("r", "7");
      bc.setAttribute("fill", TYPE_COLOR[n.type] ?? "#3d79a6");
      g.appendChild(bc);
      const bt = svgEl("text");
      bt.setAttribute("class", "expandBadge");
      bt.setAttribute("x", String(-r + 2));
      bt.setAttribute("y", String(r - 2 + 3.2));
      bt.setAttribute("text-anchor", "middle");
      bt.textContent = `+${hiddenKids > 99 ? "99" : hiddenKids}`;
      g.appendChild(bt);
    }

    g.setAttribute(
      "aria-label",
      `${TYPE_LABEL[n.type]} ${n.title}${n.code ? ` (${n.code})` : ""}${
        n.mastery != null ? `, mastery ${Math.round(n.mastery * 100)}%` : ""
      }${this.collapsedChildCount(n) > 0 ? ", double-click to expand" : ""}`,
    );
    g.setAttribute("tabindex", "-1");

    g.addEventListener("pointerenter", () => {
      this.hovered = n.id;
      this.refresh();
    });
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.trace.active) {
        this.traceClick(n.id);
        return;
      }
      if (e.shiftKey) {
        if (this.multiSelect.has(n.id)) this.multiSelect.delete(n.id);
        else this.multiSelect.add(n.id);
        this.updateSelBar();
        this.refresh();
        return;
      }
      this.selectNode(n.id);
    });
    return g;
  }

  private ringFor(n: RT): string | null {
    const metric = this.currentLens().metric;
    switch (metric) {
      case "mastery":
        return bandColor(n.mastery ?? null);
      case "effective":
        return bandColor(n.effectiveMastery ?? n.mastery ?? null);
      case "class":
        return bandColor(n.mastery ?? null);
      case "review":
        return n.reviewDue ? "#c85b78" : null;
      case "misconception":
        if (n.misconception?.active) return "#b85a52";
        return n.type === "MISCONCEPTION" && n.mastery != null ? bandColor(n.mastery) : null;
      case "activity": {
        if (n.attempts == null || n.attempts <= 0 || n.correct == null) return null;
        return bandColor(n.correct / n.attempts);
      }
      case "validation":
        return n.validationStatus === "VALIDATED" ? "#4a9b70" : n.validationStatus ? "#a09a8c" : null;
      default:
        return null;
    }
  }

  private shortLabel(n: RT): string {
    const t = n.title.length > 26 ? `${n.title.slice(0, 24)}…` : n.title;
    return n.code ? `${n.code}` : t;
  }

  private shouldLabel(n: RT): boolean {
    if (this.selected === n.id || this.hovered === n.id) return true;
    if (n.type === "ROOT" || n.type === "UNIT" || n.type === "TOPIC" || n.type === "PAPER") return true;
    // v75 hides SpecificationPoint labels below scale 1.02 on its 1500-unit
    // canvas; scaled to this canvas the equivalent threshold is ~1.25
    return this.scale >= 1.25;
  }

  private edgePath(e: EFE): string {
    const a = this.nodeById.get(e.rtFrom);
    const b = this.nodeById.get(e.rtTo);
    if (!a || !b) return "";
    if (e.kind === "hier") {
      return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ox = (-dy / len) * Math.min(26, len * 0.14);
    const oy = (dx / len) * Math.min(26, len * 0.14);
    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${(mx + ox).toFixed(1)} ${(my + oy).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }

  private drawEdges(): void {
    const edges = this.activeEdges();
    const focusNeighborhood = this.focusSet();
    let html = "";
    for (const e of edges) {
      const a = this.nodeById.get(e.rtFrom);
      const b = this.nodeById.get(e.rtTo);
      if (!a || !b) continue;
      const isActive =
        this.selectedEdge?.id === e.id ||
        (this.selected != null && (e.rtFrom === this.selected || e.rtTo === this.selected)) ||
        (this.hovered != null && (e.rtFrom === this.hovered || e.rtTo === this.hovered));
      const onTrace = this.trace.nodes.length > 1 && this.edgeOnTrace(e);
      let dim = false;
      if (focusNeighborhood) {
        dim = !(focusNeighborhood.has(e.rtFrom) && focusNeighborhood.has(e.rtTo));
      }
      if (onTrace) dim = false;
      const classes = [
        "edge",
        e.kind,
        isActive ? "active" : "",
        onTrace ? "tracePath" : "",
        dim ? "dim" : "",
        e.validationStatus && e.validationStatus !== "VALIDATED" ? "suggested" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const marker =
        e.kind === "pre" && !dim ? ' marker-end="url(#kgxArrow)"' : onTrace ? ' marker-end="url(#kgxTraceArrow)"' : "";
      html += `<path class="${classes}" d="${this.edgePath(e)}"${marker} data-id="${escapeHtml(e.id)}"></path>`;
    }
    this.edgeG.innerHTML = html;
    // edge click → explainer (delegated)
    this.edgeG.querySelectorAll("path").forEach((p) => {
      p.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const id = (p as SVGPathElement).dataset.id;
        const edge = this.edges.find((x) => x.id === id);
        if (edge) this.selectEdge(edge);
      });
    });
  }

  private edgeOnTrace(e: EFE): boolean {
    const nodes = this.trace.nodes;
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      if (
        (e.rtFrom === a && e.rtTo === b) ||
        (e.rtFrom === b && e.rtTo === a)
      ) {
        return true;
      }
    }
    return false;
  }

  private focusSet(): Set<string> | null {
    if (this.trace.active && this.trace.nodes.length) return new Set(this.trace.nodes);
    if (this.selected == null) return null;
    const set = new Set<string>([this.selected, ...this.pinned, ...this.multiSelect]);
    for (const e of this.activeEdges()) {
      if (e.rtFrom === this.selected) set.add(e.rtTo);
      if (e.rtTo === this.selected) set.add(e.rtFrom);
    }
    return set;
  }

  refresh(): void {
    const focus = this.focusSet();
    for (const n of this.activeNodes()) {
      const g = this.nodeEls.get(n.id);
      if (!g) continue;
      const cls = ["node"];
      if (n.id === this.selected) cls.push("selected");
      if (n.id === this.hovered) cls.push("hovered");
      if (this.pinned.has(n.id)) cls.push("pinned");
      if (this.trace.nodes.includes(n.id)) cls.push("traceHalo");
      if (focus && !focus.has(n.id)) cls.push("dim");
      g.setAttribute("class", cls.join(" "));
      const label = g.querySelector(".label");
      if (label) {
        (label as SVGTextElement).textContent = this.shouldLabel(n) ? this.shortLabel(n) : "";
      }
    }
    this.drawEdges();
    this.updateMinimap();
    this.updateSelBar();
  }

  // ── selection / panel ────────────────────────────────────────────────────

  selectNode(id: string, center = true): void {
    const n = this.nodeById.get(id);
    if (!n) return;
    this.selectedEdge = null;
    this.selected = id;
    this.keyboardId = id;
    this.recordTrail(id);
    this.buildTrailBar();
    this.openNodePanel(n);
    this.updateCrumbs(n);
    if (center) this.centerOn(n);
    this.refresh();
  }

  selectEdge(edge: EFE): void {
    this.selectedEdge = edge;
    this.openEdgePanel(edge);
    this.refresh();
  }

  clearSelection(): void {
    this.selected = null;
    this.selectedEdge = null;
    this.multiSelect.clear();
    this.compare = null;
    this.trace = { active: false, stage: "from", from: null, nodes: [] };
    this.panel.classList.remove("show");
    this.crumbs.style.display = "none";
    this.updateSelBar();
    this.refresh();
  }

  private recordTrail(id: string): void {
    if (this.trail[this.trailPos] === id) return;
    this.trail = this.trail.slice(0, this.trailPos + 1);
    this.trail.push(id);
    if (this.trail.length > 60) this.trail.shift();
    this.trailPos = this.trail.length - 1;
  }

  private goTrail(delta: number): void {
    const next = this.trailPos + delta;
    if (next < 0 || next >= this.trail.length) return;
    this.trailPos = next;
    this.navigate(this.trail[next]);
    this.buildTrailBar();
  }

  private updateCrumbs(n: RT): void {
    const chain: RT[] = [];
    const guard = new Set<string>();
    let cur: RT | undefined = n;
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      chain.unshift(cur);
      cur = cur.parentId ? this.nodeById.get(cur.parentId) : undefined;
    }
    if (chain.length <= 1) {
      this.crumbs.style.display = "none";
      return;
    }
    this.crumbs.innerHTML = chain
      .map((c, i) => {
        const label = escapeHtml(c.code || c.title);
        return i < chain.length - 1
          ? `<span class="c" data-id="${escapeHtml(c.id)}">${label}</span><span class="sep">›</span>`
          : `<span>${label}</span>`;
      })
      .join("");
    this.crumbs.style.display = "block";
    this.crumbs.querySelectorAll(".c").forEach((c) => {
      c.addEventListener("click", () => this.navigate((c as HTMLElement).dataset.id!));
    });
  }

  private sectionHtml(s: KGXPanelSection): string {
    let h = `<div class="sect">${escapeHtml(s.title)}</div>`;
    for (const r of s.rows ?? []) {
      h += `<div class="prow"><span>${escapeHtml(r.label)}</span><b>${escapeHtml(r.value)}</b></div>`;
    }
    for (const b of s.bars ?? []) {
      const cls = b.value < 0.55 ? "weak" : b.value < 0.7 ? "warn" : "good";
      h += `<div class="prow" style="margin-bottom:0"><span>${escapeHtml(b.label)}</span><b>${pct(b.value)}</b></div>`;
      h += `<div class="pbar ${cls}"><i style="width:${Math.max(2, Math.round((b.value ?? 0) * 100))}%"></i></div>`;
      if (b.caption) h += `<div class="note" style="margin-top:-6px">${escapeHtml(b.caption)}</div>`;
    }
    if (s.chips?.length) {
      h += `<div class="chips">${s.chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("")}</div>`;
    }
    if (s.note) h += `<div class="note">${escapeHtml(s.note)}</div>`;
    return h;
  }

  private overlaySection(n: RT): KGXPanelSection | null {
    const rows: { label: string; value: string }[] = [];
    const bars: { label: string; value: number; caption?: string }[] = [];
    if (n.mastery != null) {
      rows.push({ label: "Stored mastery (BKT)", value: pct(n.mastery) });
      bars.push({ label: "Stored mastery", value: n.mastery, caption: bandLabel(n.mastery) });
    }
    if (n.effectiveMastery != null) {
      rows.push({ label: "Effective mastery (after decay)", value: pct(n.effectiveMastery) });
      if (n.mastery != null && n.effectiveMastery < n.mastery - 0.001) {
        bars.push({
          label: "Effective after decay",
          value: n.effectiveMastery,
          caption: `${pct(n.mastery - n.effectiveMastery)} forgotten since last practice`,
        });
      }
    }
    if (n.attempts != null) rows.push({ label: "Attempts", value: String(n.attempts) });
    if (n.correct != null && n.attempts) {
      rows.push({ label: "Correct", value: `${n.correct}/${n.attempts}` });
    }
    if (n.learnersMeasured != null) rows.push({ label: "Learners measured", value: String(n.learnersMeasured) });
    if (n.tutorAsks != null && n.tutorAsks > 0) rows.push({ label: "Tutor asks (engagement)", value: String(n.tutorAsks) });
    if (n.reviewDue) rows.push({ label: "Review due", value: n.reviewReason ?? "Yes" });
    if (n.misconception) {
      rows.push({
        label: n.misconception.active ? "Active misconception" : "Misconception probability",
        value: pct(n.misconception.probability),
      });
    }
    if (n.validationStatus) rows.push({ label: "Validation", value: n.validationStatus });
    if (!rows.length && !bars.length) return null;
    return { title: "Measured state", rows, bars };
  }

  private openNodePanel(n: RT): void {
    this.compare = null;
    let h = `<h3>${escapeHtml(n.title)}</h3>`;
    h += `<div class="ptype">${TYPE_LABEL[n.type]}${n.code ? ` · ${escapeHtml(n.code)}` : ""}</div>`;
    if (n.subtitle) h += `<div class="note">${escapeHtml(n.subtitle)}</div>`;
    if (n.badge) h += `<div class="chips"><span class="chip">${escapeHtml(n.badge)}</span></div>`;
    const overlay = this.overlaySection(n);
    if (overlay) h += this.sectionHtml(overlay);
    if (n.detail) h += `<div class="sect">About</div><div class="note">${escapeHtml(n.detail)}</div>`;
    for (const s of this.host.panelSections?.(n) ?? []) h += this.sectionHtml(s);
    const actions = this.host.nodeActions?.(n) ?? [];
    if (actions.length) {
      h += `<div class="actions" id="kgx-actions"></div>`;
    }
    const pinBtnId = "kgx-pin";
    h += `<div class="actions" style="margin-top:8px"><button id="${pinBtnId}">${
      this.pinned.has(n.id) ? "Unpin node" : "Pin node"
    }</button></div>`;
    this.panelBody.innerHTML = h;
    this.panel.classList.add("show");
    for (const a of actions) {
      const btn = el("button", "", a.label);
      btn.type = "button";
      btn.addEventListener("click", () => a.onSelect(n.id));
      this.panelBody.querySelector("#kgx-actions")?.appendChild(btn);
    }
    this.panelBody.querySelector(`#${pinBtnId}`)?.addEventListener("click", () => {
      if (this.pinned.has(n.id)) this.pinned.delete(n.id);
      else this.pinned.add(n.id);
      this.openNodePanel(n);
      this.refresh();
    });
  }

  private openEdgePanel(e: EFE): void {
    const meta = EDGE_KIND_LABEL[e.kind];
    const a = this.nodeById.get(e.rtFrom);
    const b = this.nodeById.get(e.rtTo);
    let h = `<h3>${escapeHtml(meta.name)}</h3>`;
    h += `<div class="ptype">Edge · ${escapeHtml(e.label ?? e.kind)}</div>`;
    h += `<div class="note"><span class="edgeKind">${escapeHtml(a?.code || a?.title || e.rtFrom.slice(0, 8))}</span> → <span class="edgeKind">${escapeHtml(
      b?.code || b?.title || e.rtTo.slice(0, 8),
    )}</span></div>`;
    h += `<div class="sect">What it means</div><div class="note">${escapeHtml(meta.meaning)}</div>`;
    h += `<div class="sect">How to read it</div><div class="note">${escapeHtml(meta.read)}</div>`;
    if (e.validationStatus) {
      h += `<div class="sect">Validation</div><div class="note">${escapeHtml(e.validationStatus)}</div>`;
    }
    if (e.provenance) {
      h += `<div class="sect">Provenance</div><div class="quote">${escapeHtml(e.provenance)}</div>`;
    }
    this.panelBody.innerHTML = h;
    this.panel.classList.add("show");
  }

  private updateSelBar(): void {
    const n = this.multiSelect.size;
    if (!n) {
      this.selBar.classList.remove("show");
      return;
    }
    this.selBar.classList.add("show");
    this.selInfo.textContent = `${n} node${n === 1 ? "" : "s"} selected`;
    if (this.selBar.querySelectorAll("button").length === 0 || (this.selBar.dataset.count !== String(n))) {
      this.selBar.dataset.count = String(n);
      this.selBar.querySelectorAll("button").forEach((b) => b.remove());
      const clear = el("button", "kgx-btn", "Clear");
      clear.type = "button";
      clear.addEventListener("click", () => {
        this.multiSelect.clear();
        this.compare = null;
        this.updateSelBar();
        this.refresh();
      });
      this.selBar.appendChild(clear);
      if (n === 2) {
        const cmp = el("button", "kgx-btn", "Compare");
        cmp.type = "button";
        cmp.addEventListener("click", () => this.openCompare());
        this.selBar.appendChild(cmp);
      }
    } else if (n !== 2) {
      const cmp = this.selBar.querySelectorAll("button")[1];
      if (cmp) cmp.remove();
    }
  }

  private openCompare(): void {
    const ids = [...this.multiSelect];
    const a = this.nodeById.get(ids[0]);
    const b = this.nodeById.get(ids[1]);
    if (!a || !b) return;
    this.compare = { a: a.id, b: b.id };
    const shared = this.sharedNeighbors(a, b);
    let h = `<h3>Compare</h3><div class="ptype">Two-node comparison</div>`;
    const row = (label: string, va: string, vb: string) =>
      `<div class="prow"><span>${escapeHtml(label)}</span><b>${escapeHtml(va)} · ${escapeHtml(vb)}</b></div>`;
    h += row("Node", a.code || a.title, b.code || b.title);
    if (a.mastery != null || b.mastery != null) {
      h += row("Mastery", pct(a.mastery), pct(b.mastery));
      h += row("Band", bandLabel(a.mastery), bandLabel(b.mastery));
    }
    if (a.attempts != null || b.attempts != null) h += row("Attempts", String(a.attempts ?? "—"), String(b.attempts ?? "—"));
    if (a.reviewDue || b.reviewDue) h += row("Review due", a.reviewDue ? "Yes" : "No", b.reviewDue ? "Yes" : "No");
    if (shared.length) {
      h += `<div class="sect">Shared neighbours</div><div class="chips">${shared
        .map((s) => `<span class="chip">${escapeHtml(s)}</span>`)
        .join("")}</div>`;
    }
    for (const s of this.host.compareSections?.(a, b) ?? []) h += this.sectionHtml(s);
    this.panelBody.innerHTML = h;
    this.panel.classList.add("show");
  }

  private sharedNeighbors(a: RT, b: RT): string[] {
    const na = new Set<string>();
    for (const e of this.activeEdges()) {
      if (e.rtFrom === a.id) na.add(e.rtTo);
      if (e.rtTo === a.id) na.add(e.rtFrom);
    }
    const out: string[] = [];
    for (const e of this.activeEdges()) {
      const other = e.rtFrom === b.id ? e.rtTo : e.rtTo === b.id ? e.rtFrom : null;
      if (other && na.has(other)) {
        const n = this.nodeById.get(other);
        out.push(n ? (n.code || n.title) : other);
      }
    }
    return [...new Set(out)];
  }

  // ── search ───────────────────────────────────────────────────────────────

  private renderSearchResults(): void {
    const q = this.searchInput.value.trim().toLowerCase();
    if (!q) {
      this.resultsBox.style.display = "none";
      this.resultsBox.innerHTML = "";
      return;
    }
    const hits = this.nodes
      .filter((n) => n.title.toLowerCase().includes(q) || (n.code ?? "").toLowerCase().includes(q))
      .slice(0, 12);
    if (!hits.length) {
      this.resultsBox.innerHTML = `<div class="r">No matching nodes.</div>`;
      this.resultsBox.style.display = "block";
      return;
    }
    this.resultsBox.innerHTML = hits
      .map(
        (n) =>
          `<div class="r" data-id="${escapeHtml(n.id)}"><strong>${escapeHtml(n.title)}</strong><small>${escapeHtml(
            TYPE_LABEL[n.type] + (n.code ? ` · ${n.code}` : ""),
          )}</small></div>`,
      )
      .join("");
    this.resultsBox.style.display = "block";
    this.resultsBox.querySelectorAll(".r").forEach((r) => {
      r.addEventListener("click", () => {
        this.navigate((r as HTMLElement).dataset.id!);
        this.resultsBox.style.display = "none";
        this.searchInput.value = "";
      });
    });
  }

  private onSearchKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.searchInput.value = "";
      this.resultsBox.style.display = "none";
      this.svg.focus();
      return;
    }
    if (e.key === "Enter") {
      const first = this.resultsBox.querySelector(".r");
      (first as HTMLElement | null)?.click?.();
    }
    e.stopPropagation();
  }

  // ── pointer interactions ─────────────────────────────────────────────────

  private toViewBox(cx: number, cy: number): { x: number; y: number } | null {
    const rect = this.svg.getBoundingClientRect();
    const sx = rect.width / this.W;
    const sy = rect.height / this.H;
    const s = Math.min(sx, sy);
    return { x: ((cx - rect.left) / s - this.tx) / this.scale, y: ((cy - rect.top) / s - this.ty) / this.scale };
  }

  private onPointerDown(e: PointerEvent): void {
    this.svg.focus({ preventScroll: true });
    const target = e.target as Element;
    const nodeEl = target.closest?.(".node") as SVGGElement | null;
    if (nodeEl && this.nodeEls.has(nodeEl.dataset.id!)) {
      const id = nodeEl.dataset.id!;
      const n = this.nodeById.get(id)!;
      this.drag = { kind: "node", id, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };
      try {
        this.svg.setPointerCapture(e.pointerId);
      } catch {
        /* older browsers */
      }
      this.bootSim();
      return;
    }
    if (e.shiftKey || this.lassoArmed) {
      this.startLasso(e);
      return;
    }
    this.drag = { kind: "pan", x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };
    this.svg.classList.add("grabbing");
    try {
      this.svg.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.drag) {
      return;
    }
    if (this.drag.pointerId !== e.pointerId) return;
    if (this.drag.kind === "pan") {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.drag.moved = true;
      const rect = this.svg.getBoundingClientRect();
      const sx = rect.width / this.W;
      const s = Math.min(sx, rect.height / this.H);
      this.tx += dx / s;
      this.ty += dy / s;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.applyTransform();
      return;
    }
    if (this.drag.kind === "node") {
      const n = this.nodeById.get(this.drag.id);
      if (!n) return;
      const p = this.toViewBox(e.clientX, e.clientY);
      if (p) {
        n.x = p.x;
        n.y = p.y;
        this.drag.moved = true;
        this.updatePositions();
        this.updateMinimap();
      }
      return;
    }
    if (this.drag.kind === "lasso") {
      this.updateLasso(e);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    this.svg.classList.remove("grabbing");
    if (!d) return;
    this.drag = null;
    if (d.kind === "lasso") {
      this.finishLasso(e);
      return;
    }
    if (d.kind === "pan" && !d.moved) {
      // click on empty canvas — clear unless a trace is in progress
      if (!this.trace.active) this.clearSelection();
      else this.status("Trace: click a node (Esc cancels)");
    }
    if (d.kind === "node" && !d.moved) {
      // click handled by the node's own click handler
    }
    if (d.kind === "node" && d.moved) {
      this.reheat(0.95); // v75 pointerup reheat
    }
  }

  // ── reveal gating (v75 isSpecRevealed) ─────────────────────────────────

  /**
   * A node is revealed when it sits within the first two levels (root,
   * clusters, cluster members — the reference's subject/sections/subtopics),
   * or when every ancestor link below that level has been expanded.
   * Misconceptions follow their parent (state overlay, not structure).
   */
  private isRevealed(n: RT): boolean {
    if (this.depth(n) <= 2) return true;
    const p = n.parentId ? this.nodeById.get(n.parentId) : undefined;
    if (!p) return true; // orphan — the origin ring keeps it visible
    if (n.type === "MISCONCEPTION") return this.isRevealed(p);
    return this.expanded.has(p.id) && this.isRevealed(p);
  }

  /** hidden structural children of n (drives the +N badge) — children at
   * depth ≤ 2 are always visible, so only deeper layers count */
  private collapsedChildCount(n: RT): number {
    if (this.expanded.has(n.id)) return 0;
    const kids = this.structuralKids.get(n.id);
    if (!kids?.length) return 0;
    let c = 0;
    for (const k of kids) {
      const rt = this.nodeById.get(k.id);
      if (rt && this.depth(rt) > 2) c++;
    }
    return c;
  }

  private expandNode(id: string): void {
    if (this.expanded.has(id) || !this.structuralKids.get(id)?.length) return;
    const n = this.nodeById.get(id);
    const revealed = n ? this.collapsedChildCount(n) : 0;
    this.expanded.add(id);
    this.rebuildNodeDom();
    this.bloomFrom(id); // glide parent→home; appearTick reheat settles after
    this.refresh();
    this.status(`Expanded ${n?.title ?? id} — ${revealed} items (double-click to collapse)`);
  }

  private collapseNode(id: string): void {
    this.expanded.delete(id);
    // prune references to nodes that just became hidden
    this.pruneHiddenRefs();
    this.rebuildNodeDom();
    this.reheat(0.12); // v75 small-interaction reheat
    this.refresh();
    this.status(`Collapsed ${this.nodeById.get(id)?.title ?? id}`);
  }

  /**
   * v75 reveal bloom (revealNodesAnimated): newly revealed children glide
   * from their parent's CURRENT position to parent + local ring offset over
   * ~820ms, OUTSIDE the physics. No reheat afterwards — the bloom IS the
   * motion (a 0.9-alpha settle pass is what explodes the flower).
   */
  private startAppear(
    entries: { id: string; fx: number; fy: number; tx: number; ty: number }[],
  ): void {
    const now = performance.now();
    for (const en of entries) {
      const n = this.nodeById.get(en.id);
      if (!n) continue;
      n.x = en.fx;
      n.y = en.fy;
      n.vx = 0;
      n.vy = 0;
      this.appearing.set(en.id, { fx: en.fx, fy: en.fy, tx: en.tx, ty: en.ty, t0: now, dur: 820 });
    }
    if (this.appearing.size && !this.appearRaf) {
      this.appearRaf = requestAnimationFrame(() => this.appearTick());
    }
  }

  private appearTick(): void {
    if (this.destroyed) {
      this.appearRaf = 0;
      return;
    }
    const now = performance.now();
    for (const [id, ap] of this.appearing) {
      const n = this.nodeById.get(id);
      if (!n) {
        this.appearing.delete(id);
        continue;
      }
      const p = (now - ap.t0) / ap.dur;
      if (p >= 1) {
        n.x = ap.tx;
        n.y = ap.ty;
        n.vx = 0;
        n.vy = 0;
        this.appearing.delete(id);
        continue;
      }
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic — fast out, gentle settle
      n.x = ap.fx + (ap.tx - ap.fx) * e;
      n.y = ap.fy + (ap.ty - ap.fy) * e;
    }
    this.updatePositions();
    this.updateMinimap();
    if (this.appearing.size) {
      this.appearRaf = requestAnimationFrame(() => this.appearTick());
    } else {
      this.appearRaf = 0;
      // v75's post-reveal nudge magnitude (0.018 — the specMorph reheat):
      // eases genuine overlaps without moving anything meaningfully. The
      // 0.9 boot here was measured to explode the flower (session-131).
      this.reheat(0.018);
    }
  }

  /** glide entries when `pid` expands: structural children + misconceptions
   * collared on them; targets = parent's current pos + local ring offset
   * (v75's renderPos(parent) + localX/localY invariant) */
  private bloomEntries(pid: string): { id: string; fx: number; fy: number; tx: number; ty: number }[] {
    const p = this.nodeById.get(pid);
    if (!p) return [];
    const out: { id: string; fx: number; fy: number; tx: number; ty: number }[] = [];
    for (const k of this.structuralKids.get(pid) ?? []) {
      const kn = this.nodeById.get(k.id);
      if (!kn) continue;
      out.push({
        id: k.id,
        fx: p.x,
        fy: p.y,
        tx: p.x + (kn.homeX - p.homeX),
        ty: p.y + (kn.homeY - p.homeY),
      });
      for (const g of this.nodes) {
        if (g.type === "MISCONCEPTION" && g.parentId === k.id) {
          out.push({
            id: g.id,
            fx: p.x,
            fy: p.y,
            tx: p.x + (g.homeX - p.homeX),
            ty: p.y + (g.homeY - p.homeY),
          });
        }
      }
    }
    return out;
  }

  /** newly revealed children glide from the parent to their local targets */
  private bloomFrom(id: string): void {
    this.startAppear(this.bloomEntries(id));
  }

  /** expand the ancestor chain of a hidden target (search / panel jumps) */
  private revealChain(id: string): void {
    const chain: string[] = [];
    const guard = new Set<string>();
    let cur = this.nodeById.get(id);
    while (cur?.parentId && !guard.has(cur.id)) {
      guard.add(cur.id);
      const p = this.nodeById.get(cur.parentId);
      if (!p) break;
      // only levels with hidden layers below (depth ≥ 2 parents gate depth ≥ 3)
      if (this.depth(p) >= 2 && !this.expanded.has(p.id)) chain.push(p.id);
      cur = p;
    }
    if (!chain.length) return;
    for (const pid of chain) {
      this.expanded.add(pid);
      this.bloomFrom(pid);
    }
    this.rebuildNodeDom();
  }

  /** reveal + select — the reference's revealAncestorsForNode + selectNode */
  private navigate(id: string): void {
    this.revealChain(id);
    this.selectNode(id);
  }

  /**
   * v75 expandScopeNode: a scope node (root / unit) double-clicked with any
   * hidden descendant blooms the WHOLE subtree below it; with everything
   * already open, it collapses the scope back to the gated default.
   */
  private toggleScope(id: string): void {
    const descendants: string[] = [];
    const collect = (pid: string) => {
      for (const k of this.structuralKids.get(pid) ?? []) {
        descendants.push(k.id);
        collect(k.id);
      }
    };
    collect(id);
    const withKids = descendants.filter((d) => (this.structuralKids.get(d)?.length ?? 0) > 0);
    const anyHidden = descendants.some((d) => {
      const rt = this.nodeById.get(d);
      return rt ? !this.isRevealed(rt) : false;
    });
    if (anyHidden) {
      for (const d of withKids) {
        this.expanded.add(d);
        this.bloomFrom(d);
      }
    } else {
      for (const d of withKids) this.expanded.delete(d);
    }
    this.pruneHiddenRefs();
    this.rebuildNodeDom();
    if (!anyHidden) this.reheat(0.12); // collapse nudge; blooms animate themselves
    this.refresh();
    const n = this.nodeById.get(id);
    this.status(
      anyHidden
        ? `Expanded all of ${n?.title ?? id} — ${descendants.length} nodes (double-click to collapse the scope)`
        : `Collapsed ${n?.title ?? id} back to its topics`,
    );
  }

  /** drop selection/pin/compare/keyboard references to now-hidden nodes */
  private pruneHiddenRefs(): void {
    const visible = new Set(this.activeNodes().map((n) => n.id));
    this.multiSelect = new Set([...this.multiSelect].filter((x) => visible.has(x)));
    this.pinned = new Set([...this.pinned].filter((x) => visible.has(x)));
    if (this.compare && (!visible.has(this.compare.a) || !visible.has(this.compare.b))) {
      this.compare = null;
      // the compare content lives in the shared panel — hide it
      this.panel.classList.remove("show");
    }
    if (this.selected && !visible.has(this.selected)) {
      this.selected = null;
      this.selectedEdge = null;
      this.panel.classList.remove("show");
      this.crumbs.style.display = "none";
    }
    if (this.keyboardId && !visible.has(this.keyboardId)) {
      this.keyboardId = this.selected ?? [...visible][0] ?? null;
    }
  }

  private onDblClick(e: MouseEvent): void {
    const target = e.target as Element;
    const nodeEl = target.closest?.(".node") as SVGGElement | null;
    if (nodeEl && nodeEl.dataset.id) {
      const id = nodeEl.dataset.id;
      const n = this.nodeById.get(id);
      if (!n) return;
      // 1) own hidden children → reveal them (v75 SubTopic double-click)
      if (this.collapsedChildCount(n) > 0) {
        this.expandNode(id);
        return;
      }
      // 2) expanded with nothing left hidden → collapse own children
      if (this.expanded.has(id)) {
        this.collapseNode(id);
        return;
      }
      // 3) scope nodes (root / unit) bulk-toggle their subtree (v75
      //    Section/Subject double-click)
      if (this.depth(n) <= 1 && (this.structuralKids.get(id)?.length ?? 0) > 0) {
        this.toggleScope(id);
        return;
      }
      // 4) leaf → neighborhood exploration stays on double-click
      this.exploreNeighborhood(id);
      return;
    }
    this.fitView();
  }

  // ── lasso (v75) ──────────────────────────────────────────────────────────

  private startLasso(e: PointerEvent): void {
    const rect = this.svg.getBoundingClientRect();
    const sx = rect.width / this.W;
    const s = Math.min(sx, rect.height / this.H);
    const x = (e.clientX - rect.left) / s;
    const y = (e.clientY - rect.top) / s;
    this.drag = { kind: "lasso", x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };
    this.lasso = { x0: x, y0: y, x1: x, y1: y };
    try {
      this.svg.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    this.lassoG.innerHTML = "";
    const r = svgEl("rect");
    r.setAttribute("x", String(x));
    r.setAttribute("y", String(y));
    r.setAttribute("width", "0");
    r.setAttribute("height", "0");
    r.setAttribute("fill", "rgba(102,86,169,.08)");
    r.setAttribute("stroke", "#6656a9");
    r.setAttribute("stroke-dasharray", "4 4");
    this.lassoG.appendChild(r);
    this.lassoHint.classList.add("show");
  }

  private updateLasso(e: PointerEvent): void {
    const rect = this.svg.getBoundingClientRect();
    const sx = rect.width / this.W;
    const s = Math.min(sx, rect.height / this.H);
    const x = (e.clientX - rect.left) / s;
    const y = (e.clientY - rect.top) / s;
    if (!this.lasso) return;
    this.lasso.x1 = x;
    this.lasso.y1 = y;
    const r = this.lassoG.firstChild as SVGRectElement | null;
    if (!r) return;
    r.setAttribute("x", String(Math.min(this.lasso.x0, x)));
    r.setAttribute("y", String(Math.min(this.lasso.y0, y)));
    r.setAttribute("width", String(Math.abs(x - this.lasso.x0)));
    r.setAttribute("height", String(Math.abs(y - this.lasso.y0)));
  }

  private finishLasso(e: PointerEvent): void {
    const l = this.lasso;
    this.lasso = null;
    this.lassoG.innerHTML = "";
    const wasArmed = this.lassoArmed;
    this.lassoArmed = false;
    this.lassoHint.classList.remove("show");
    if (!l) return;
    const w = Math.abs(l.x1 - l.x0);
    const h = Math.abs(l.y1 - l.y0);
    if (w < 6 && h < 6) {
      if (wasArmed) this.status("Lasso armed — drag on empty canvas to select the enclosed nodes");
      return;
    }
    const x0 = Math.min(l.x0, l.x1);
    const x1 = Math.max(l.x0, l.x1);
    const y0 = Math.min(l.y0, l.y1);
    const y1 = Math.max(l.y0, l.y1);
    const rect = this.svg.getBoundingClientRect();
    const sx = rect.width / this.W;
    const s = Math.min(sx, rect.height / this.H);
    const inside = this.activeNodes().filter((n) => {
      const px = n.x * this.scale + this.tx;
      const py = n.y * this.scale + this.ty;
      return px >= x0 * s && px <= x1 * s && py >= y0 * s && py <= y1 * s;
    });
    for (const n of inside) this.multiSelect.add(n.id);
    this.updateSelBar();
    this.refresh();
    this.status(
      inside.length
        ? `Lasso · ${inside.length} node${inside.length === 1 ? "" : "s"} inside · selection now ${this.multiSelect.size}`
        : "Lasso · no nodes inside the rectangle",
    );
  }

  // ── minimap (v75) ────────────────────────────────────────────────────────

  private miniBounds(): { x0: number; y0: number; x1: number; y1: number } {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of this.activeNodes()) {
      if (n.x < x0) x0 = n.x;
      if (n.x > x1) x1 = n.x;
      if (n.y < y0) y0 = n.y;
      if (n.y > y1) y1 = n.y;
    }
    if (x0 === Infinity) return { x0: 0, y0: 0, x1: this.W, y1: this.H };
    const pad = Math.max(60, (x1 - x0) * 0.06);
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }

  private updateMinimap(): void {
    if (!this.miniOpen || !this.miniBox.isConnected) return;
    const b = this.miniBounds();
    const bw = Math.max(1, b.x1 - b.x0);
    const bh = Math.max(1, b.y1 - b.y0);
    const MX = 180;
    const MY = 102;
    const mx = (x: number) => ((x - b.x0) / bw) * MX;
    const my = (y: number) => ((y - b.y0) / bh) * MY;
    let out = "";
    const dotR = (t: KGXNodeType) => (t === "ROOT" ? 3.4 : t === "UNIT" ? 2.6 : t === "TOPIC" || t === "PAPER" ? 2.2 : 1.1);
    for (const t of this.allTypes()) {
      let d = "";
      for (const n of this.activeNodes()) {
        if (n.type !== t) continue;
        const r = dotR(t);
        const X = mx(n.x).toFixed(1);
        const Y = my(n.y).toFixed(1);
        d += `M ${Number(X) - r} ${Y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z `;
      }
      if (d) {
        out += `<path fill="${TYPE_COLOR[t]}" opacity=".55" d="${d.trim()}"/>`;
      }
    }
    let sel = "";
    for (const n of this.activeNodes()) {
      if (!this.multiSelect.has(n.id) && !this.pinned.has(n.id) && n.id !== this.selected && n.id !== this.keyboardId) {
        continue;
      }
      const r = dotR(n.type) + 1.4;
      const X = mx(n.x).toFixed(1);
      const Y = my(n.y).toFixed(1);
      sel += `M ${Number(X) - r} ${Y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z `;
    }
    if (sel) out += `<path class="miniSel" opacity=".85" d="${sel.trim()}"/>`;
    const wx0 = -this.tx / this.scale;
    const wy0 = -this.ty / this.scale;
    const wx1 = (this.W - this.tx) / this.scale;
    const wy1 = (this.H - this.ty) / this.scale;
    const rx = Math.max(0, mx(wx0));
    const ry = Math.max(0, my(wy0));
    const rw = Math.min(MX, mx(wx1)) - rx;
    const rh = Math.min(MY, my(wy1)) - ry;
    out += `<rect class="miniRect" x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${Math.max(2, rw).toFixed(1)}" height="${Math.max(2, rh).toFixed(1)}"/>`;
    this.miniSvg.setAttribute("viewBox", `0 0 ${MX} ${MY}`);
    this.miniSvg.innerHTML = out;
  }

  private onMiniDown(e: PointerEvent): void {
    e.stopPropagation();
    this.miniNavigate(e);
    this.miniBox.setPointerCapture(e.pointerId);
  }

  private onMiniMove(e: PointerEvent): void {
    if (e.buttons & 1) this.miniNavigate(e);
  }

  private miniNavigate(e: PointerEvent): void {
    const b = this.miniBounds();
    const bw = Math.max(1, b.x1 - b.x0);
    const bh = Math.max(1, b.y1 - b.y0);
    const rect = this.miniSvg.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const gx = b.x0 + fx * bw;
    const gy = b.y0 + fy * bh;
    this.tx = this.W / 2 - gx * this.scale;
    this.ty = this.H / 2 - gy * this.scale;
    this.applyTransform();
    this.refresh();
  }

  // ── exploration (v73/v75) ───────────────────────────────────────────────

  private exploreNeighborhood(id: string): void {
    const set = new Set<string>([id]);
    for (const e of this.activeEdges()) {
      if (e.rtFrom === id) set.add(e.rtTo);
      if (e.rtTo === id) set.add(e.rtFrom);
    }
    this.connectedOnly = true;
    this.connectedRoot = id;
    this.connectedSet = set;
    this.rebuildNodeDom();
    this.reheat(0.15); // v75 exploration reheat
    this.refresh();
    this.status(`Exploring ${this.nodeById.get(id)?.title ?? id} — ${set.size} connected nodes (c restores the full graph)`);
    this.selectNode(id, true);
  }

  private toggleConnected(): void {
    this.connectedOnly = !this.connectedOnly;
    if (this.connectedOnly) {
      const anchor = this.selected ?? this.keyboardId ?? this.nodes[0]?.id;
      if (anchor) {
        this.exploreNeighborhood(anchor);
        return;
      }
    }
    this.connectedSet = null;
    this.connectedRoot = null;
    this.rebuildNodeDom();
    this.reheat(0.15);
    this.fitView();
    this.refresh();
  }

  private beginTrace(): void {
    this.trace = { active: true, stage: "from", from: null, nodes: [] };
    this.status("Trace: click the START node (Esc cancels)");
    this.refresh();
  }

  private traceClick(id: string): void {
    if (this.trace.stage === "from") {
      this.trace.from = id;
      this.trace.stage = "to";
      this.status(`Trace from ${this.nodeById.get(id)?.title ?? id} — click the END node`);
      this.selected = id;
      this.refresh();
      return;
    }
    const from = this.trace.from;
    if (!from) return;
    if (from === id) {
      this.status("Trace: start and end are the same node");
      return;
    }
    const path = this.bfsPath(from, id);
    if (!path) {
      this.status("Trace: no path between those nodes through the visible edges");
      return;
    }
    this.trace.active = true;
    this.trace.stage = "from";
    this.trace.nodes = path;
    this.selected = path[0];
    this.applyTraceBadges();
    this.refresh();
    this.status(`Path traced · ${path.length} nodes · ${path.length - 1} hops — Esc clears`);
  }

  private bfsPath(from: string, to: string): string[] | null {
    const adj = new Map<string, string[]>();
    for (const e of this.activeEdges()) {
      if (!adj.has(e.rtFrom)) adj.set(e.rtFrom, []);
      if (!adj.has(e.rtTo)) adj.set(e.rtTo, []);
      adj.get(e.rtFrom)!.push(e.rtTo);
      adj.get(e.rtTo)!.push(e.rtFrom);
    }
    const prev = new Map<string, string>([[from, ""]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === to) {
        const path = [to];
        let p = prev.get(to);
        while (p) {
          path.unshift(p);
          p = prev.get(p);
        }
        return path;
      }
      for (const nxt of adj.get(cur) ?? []) {
        if (!prev.has(nxt)) {
          prev.set(nxt, cur);
          queue.push(nxt);
        }
      }
    }
    return null;
  }

  private applyTraceBadges(): void {
    for (const g of this.nodeEls.values()) g.querySelectorAll(".pathBadge").forEach((b) => b.remove());
    this.trace.nodes.forEach((id, i) => {
      const n = this.nodeById.get(id);
      const g = this.nodeEls.get(id);
      if (!n || !g) return;
      const badge = svgEl("circle");
      badge.setAttribute("class", "pathBadge");
      badge.setAttribute("cx", String(TYPE_RADIUS[n.type] + 7));
      badge.setAttribute("cy", String(-TYPE_RADIUS[n.type] - 7));
      badge.setAttribute("r", "7");
      badge.setAttribute("fill", "#6656a9");
      g.appendChild(badge);
      const t = svgEl("text");
      t.setAttribute("class", "pathBadge");
      t.setAttribute("x", String(TYPE_RADIUS[n.type] + 7));
      t.setAttribute("y", String(-TYPE_RADIUS[n.type] - 4));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", "#fff");
      t.setAttribute("stroke", "none");
      t.textContent = String(i + 1);
      g.appendChild(t);
    });
  }

  // ── keyboard ─────────────────────────────────────────────────────────────

  private visibleKeyboardNodes(): RT[] {
    return this.activeNodes().filter((n) => n.x != null);
  }

  private familyOf(n: RT): { parent: RT | null; children: RT[]; siblings: RT[] } {
    const parent = n.parentId ? (this.nodeById.get(n.parentId) ?? null) : null;
    const children = this.activeNodes().filter((c) => c.parentId === n.id);
    const siblings = parent ? this.activeNodes().filter((s) => s.parentId === parent.id) : [];
    return { parent, children, siblings };
  }

  private onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const nodes = this.visibleKeyboardNodes();
    if (!nodes.length) return;
    if (!this.keyboardId || !nodes.some((n) => n.id === this.keyboardId)) {
      this.keyboardId = nodes[0].id;
    }
    const cur = this.nodeById.get(this.keyboardId)!;
    const fam = this.familyOf(cur);
    const move = (next: RT | null) => {
      if (next) {
        this.keyboardId = next.id;
        this.refresh();
      }
    };
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        move(fam.parent);
        break;
      case "ArrowDown":
        e.preventDefault();
        move(fam.children[0] ?? null);
        break;
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        const i = fam.siblings.findIndex((s) => s.id === cur.id);
        const ni = e.key === "ArrowLeft" ? i - 1 : i + 1;
        if (ni >= 0 && ni < fam.siblings.length) move(fam.siblings[ni]);
        break;
      }
      case "Enter":
        e.preventDefault();
        this.selectNode(cur.id);
        break;
      case "Escape":
        if (this.trace.active) {
          this.trace = { active: false, stage: "from", from: null, nodes: [] };
          this.applyTraceBadges();
        }
        this.clearSelection();
        break;
      case "/":
        e.preventDefault();
        this.searchInput.focus();
        break;
      case "+":
      case "=":
        this.zoomBy(1.25);
        break;
      case "-":
      case "_":
        this.zoomBy(0.8);
        break;
      case "f":
      case "F":
        this.fitView();
        break;
      case "l":
      case "L":
        this.lassoArmed = !this.lassoArmed;
        this.lassoHint.classList.toggle("show", this.lassoArmed);
        break;
      case "m":
      case "M":
        this.miniOpen = !this.miniOpen;
        this.miniBox.style.display = this.miniOpen ? "" : "none";
        break;
      case "p":
      case "P":
        if (this.selected) {
          if (this.pinned.has(this.selected)) this.pinned.delete(this.selected);
          else this.pinned.add(this.selected);
          this.refresh();
        }
        break;
      case "c":
      case "C":
        this.toggleConnected();
        break;
      case "t":
      case "T":
        this.beginTrace();
        break;
      default:
        break;
    }
  }

  // ── status ───────────────────────────────────────────────────────────────

  private status(msg: string): void {
    this.statusEl.textContent = msg;
    this.statusEl.style.display = "block";
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusEl.style.display = "none";
    }, 3800);
  }
}
