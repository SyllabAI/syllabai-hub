"use client";

/**
 * PdfPane — mobile-first PDF viewer over pdf.js (pdfjs-dist v4).
 *
 * Why a custom viewer (decided with the user): native <iframe> PDF embeds are
 * unreliable on Android Chrome and iOS Safari; canvas rendering works
 * everywhere a demo student is likely to be.
 *
 * Performance architecture (v2 — the v1 viewer felt choppy; measured causes
 * were: doc.cleanup() on every scroll frame, canvases destroyed mid-scroll
 * with no hysteresis, offsetTop loops per scroll frame, layout driven through
 * React state, and the whole doc being re-fetched when a pane was toggled):
 *
 *   - fit-width by default (recomputed on container resize), zoom on top of fit;
 *   - IntersectionObserver page tracking — zero work per scroll frame; the
 *     "center page" is recomputed only when the near-zone (rootMargin 300%)
 *     intersection set changes, with a passive-scroll fallback for ancient
 *     browsers;
 *   - virtualised window: pages within RENDER_RADIUS of the center hold a
 *     canvas, rendered NEAREST-FIRST; a hysteresis band keeps canvases alive
 *     out to CLEAR_RADIUS and an idle sweep (SWEEP_DELAY_MS after the last
 *     window change) frees anything beyond it — no canvas is ever destroyed
 *     mid-scroll, so no blank flashes;
 *   - pdf.js caches are NEVER wiped while mounted (no doc.cleanup()) — pages
 *     re-entering the window re-render instantly from the warm cache;
 *   - double-buffered painting: every render draws into a detached canvas and
 *     swaps atomically on completion, so zoom/resize re-fits never blank the
 *     document (the old canvas stays visible until the new one lands), and
 *     scroll position is preserved through the zoom by scaling the anchor;
 *   - layout sizes are imperative (holder inline styles via refs), NOT React
 *     state — rendering a page triggers zero re-renders; React state is only
 *     phase/numPages/currentPage/zoom;
 *   - the document SURVIVES pane toggling: hidden split panes (mobile A/B,
 *     desktop QP|MS|Split) keep their doc, canvases and scroll position —
 *     active=false merely pauses tracking; teardown happens only on url/
 *     retry/unmount.
 *
 * Text architecture (v3 — Ctrl+F / selection / per-question scoring support):
 *
 *   - a BACKGROUND INDEXER extracts each page's text content once (lazily —
 *     started only when search opens or when a consumer asks for lines via
 *     the imperative handle), cached as {TextContent, page-meta}; it never
 *     refetches bytes (the doc is already in memory) and yields per page so
 *     it never blocks the worker's render queue;
 *   - each canvas page gets a pdf.js TextLayer overlay (transparent spans —
 *     native selection/copy) sized off the SAME --scale-factor CSS var the
 *     library expects; re-attached automatically when the indexer catches up
 *     with a page that already painted;
 *   - Ctrl+F/Cmd+F (or the toolbar search button) opens a per-pane find bar;
 *     co-existing panes (QP|MS split) coordinate through a module-level
 *     "last-interacted pane wins" registry so the shortcut never opens two
 *     bars;
 *   - matches are computed over a pure line model (lib/pdf-lines.ts) with
 *     whitespace-flexible case-insensitive matching, highlighted via
 *     interpolated rects (lib/pdf-lines.matchRects) on every page, and
 *     navigated prev/next with smooth scroll;
 *   - the same line model, at scale 1, feeds question-structure detection
 *     (lib/ms-questions.ts) — the lazy per-paper alternative to a repo-wide
 *     question index.
 *
 * PDFs stream straight from the syllabai-pastpapers corpus on
 * raw.githubusercontent.com (CORS-enabled); nothing is proxied or vendored
 * except the version-matched pdf.js worker (public/pdfjs/).
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildLines,
  findInLines,
  findRegex,
  matchRects,
  type ItemGeom,
  type PdfLine,
} from "@/lib/pdf-lines";

type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;
type PdfPage = import("pdfjs-dist").PDFPageProxy;
type RenderTask = import("pdfjs-dist").RenderTask;
/** root types re-export TextLayer/Util but not TextContent — take it from api.d.ts */
type TextContent = import("pdfjs-dist/types/src/display/api").TextContent;
type PdfjsNamespace = typeof import("pdfjs-dist");

export interface PdfPaneProps {
  url: string;
  /** download/open fallback link (the same raw corpus URL) */
  downloadUrl?: string;
  label: string;
  /** when false (hidden split pane) tracking pauses; the loaded doc stays */
  active: boolean;
  className?: string;
}

/** Imperative surface for consumers (mock scoring / question jump). */
export interface PdfPaneHandle {
  /**
   * Full-document line model at scale 1 (relative geometry only — enough for
   * column/margin heuristics). Resolves null when the doc never loads.
   * Starts the background indexer on first call; later calls are instant.
   */
  extractLines: () => Promise<Array<{ page: number; lines: PdfLine[] }> | null>;
  /** Smooth-scroll a page into view (question jump). */
  scrollToPage: (n: number) => void;
}

/** Pages holding a canvas: center ± RENDER_RADIUS (nearest-first). */
const RENDER_RADIUS = 3;
/** Hysteresis: canvases survive out to center ± CLEAR_RADIUS … */
const CLEAR_RADIUS = 6;
/** … but never more than MAX_CANVASES at once (desktop wide-pane safety). */
const MAX_CANVASES = 9;
/** Idle delay before the sweep frees canvases beyond the hysteresis band. */
const SWEEP_DELAY_MS = 350;
/** Cap on waiting for a pane's doc to load before extractLines gives up. */
const DOC_WAIT_TIMEOUT_MS = 30_000;

type Phase = "loading" | "ready" | "error";

interface PageMeta {
  /** viewport transform at scale 1 — all later scales compose linearly */
  vt: number[];
  baseW: number;
  baseH: number;
}

interface Match {
  page: number;
  lineIdx: number;
  start: number;
  end: number;
}

// ── Ctrl+F routing across co-existing panes (QP + MS share a page) ──────────
// One document-level keydown for the whole app; the pane the user last
// interacted with wins, else the first ready pane. No pane ever opens two
// bars — open() broadcasts a close to the others.
interface FindHost {
  open: () => void;
  close: () => void;
  canOpen: () => boolean;
}
const findHosts = new Set<FindHost>();
let lastFindHost: FindHost | null = null;
let findKeydownInstalled = false;

function installFindKeydown() {
  if (findKeydownInstalled || typeof window === "undefined") return;
  findKeydownInstalled = true;
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "f" || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const host =
        lastFindHost && lastFindHost.canOpen()
          ? lastFindHost
          : [...findHosts].find((h) => h.canOpen());
      if (!host) return; // no ready pane — let the browser find proceed
      e.preventDefault();
      host.open();
    },
    true,
  );
}

/** Fetch-or-create an absolutely-positioned aux layer inside a holder. */
function ensureAux(holder: HTMLDivElement, cls: string): HTMLDivElement {
  const existing = holder.querySelector<HTMLDivElement>(`:scope > .${cls}`);
  if (existing) return existing;
  const el = document.createElement("div");
  el.className = cls;
  return el;
}

export const PdfPane = forwardRef<PdfPaneHandle, PdfPaneProps>(function PdfPane(
  { url, downloadUrl, label, active, className },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const holderRefs = useRef(new Map<number, HTMLDivElement>());
  const docRef = useRef<PdfDoc | null>(null);
  const tasksRef = useRef(new Map<number, RenderTask>());
  /** pages currently holding a live canvas */
  const canvasesRef = useRef(new Set<number>());
  const centerRef = useRef(1);
  const aspectRef = useRef(297 / 210); // A4 portrait fallback (h/w)
  const zoomRef = useRef(1);
  const anchorRef = useRef<{ top: number; pageH: number; at: number } | null>(null);
  const sweepTimerRef = useRef<number | null>(null);
  const rafRef = useRef(0);

  // ── text index (v3) ──────────────────────────────────────────────────────
  const pdfjsNsRef = useRef<PdfjsNamespace | null>(null);
  /** page → full TextContent (items + styles; reused by the TextLayer) */
  const itemsRef = useRef(new Map<number, TextContent>());
  /** page → scale-1 viewport transform + page box (for scale composition) */
  const pageMetaRef = useRef(new Map<number, PageMeta>());
  /** "page@scale" → visual lines (cleared on zoom/resize refits) */
  const linesCacheRef = useRef(new Map<string, PdfLine[]>());
  /** page → live pdf.js TextLayer (cancelled on sweep/refit/teardown) */
  const textLayersRef = useRef(new Map<unknown, { cancel: () => void }>()); // keyed like tasks
  const indexGenRef = useRef(0);
  const fullTextPromiseRef = useRef<Promise<boolean> | null>(null);
  const pendingReadyRef = useRef<Array<(ok: boolean) => void>>([]);

  // ── find state (refs mirror state for imperative paths) ─────────────────
  const matchesRef = useRef<Match[]>([]);
  const matchIdxRef = useRef(0);
  const findOpenRef = useRef(false);
  const queryRef = useRef("");
  const phaseRef = useRef<Phase>("loading");
  const activeRef = useRef(active);
  const numPagesRef = useRef(0);
  const selfHostRef = useRef<FindHost | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  // ── react state (kept minimal; layout itself is imperative) ──────────────
  const [reloadKey, setReloadKey] = useState(0);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  /** zoom multiplier on fit-width — ref for render math, state for the toolbar */
  const [zoomPct, setZoomPct] = useState(100);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [matchInfo, setMatchInfo] = useState<{ count: number; index: number } | null>(null);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);

  // ── fullscreen (per-pane "the PDF is the screen") ────────────────────────
  // Element.requestFullscreen is unsupported on iPhone Safari (and older
  // Android WebView), so the button only renders when the API exists; Esc /
  // the browser UI exits as usual.
  const [canFullscreen, setCanFullscreen] = useState(false);
  useEffect(() => {
    setCanFullscreen(
      typeof rootRef.current?.requestFullscreen === "function" &&
        !/iP(hone|ad|od)/.test(navigator.userAgent),
    );
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void el.requestFullscreen().catch(() => undefined);
    }
  }, []);

  // ── geometry ─────────────────────────────────────────────────────────────
  /** Fit scale for a page of width baseW at the current zoom. */
  const scaleFor = useCallback((baseW: number) => {
    const w = scrollRef.current?.clientWidth ?? 800;
    const avail = Math.max(240, w - 24);
    return Math.min(4, (avail / baseW) * zoomRef.current);
  }, []);

  const fitFor = useCallback(
    (page: PdfPage) => {
      const base = page.getViewport({ scale: 1 });
      const scale = scaleFor(base.width);
      return { scale, cssW: Math.round(base.width * scale), cssH: Math.round(base.height * scale) };
    },
    [scaleFor],
  );

  /** Size every canvas-less holder from the container width + page-1 aspect. */
  const applyPlaceholderStyles = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const avail = Math.max(240, scroller.clientWidth - 24);
    const w = Math.round(avail * zoomRef.current);
    const h = Math.round(w * aspectRef.current);
    for (const [n, el] of holderRefs.current) {
      if (canvasesRef.current.has(n)) continue;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }
  }, []);

  // ── line model (pure math over the cached text index) ────────────────────
  const linesFor = useCallback((n: number, scale: number): PdfLine[] => {
    const key = `${n}@${scale.toFixed(4)}`;
    const hit = linesCacheRef.current.get(key);
    if (hit) return hit;
    const tc = itemsRef.current.get(n);
    const meta = pageMetaRef.current.get(n);
    const ns = pdfjsNsRef.current;
    if (!tc || !meta || !ns) return [];
    const outer = ns.Util.transform([scale, 0, 0, scale, 0, 0], meta.vt);
    const geoms: ItemGeom[] = [];
    for (const it of tc.items) {
      if (!("str" in it) || it.str.length === 0) continue;
      const m = ns.Util.transform(outer, it.transform);
      geoms.push({
        str: it.str,
        x: m[4],
        y: m[5],
        h: Math.hypot(m[2], m[3]),
        w: it.width * scale,
      });
    }
    const lines = buildLines(geoms, n);
    linesCacheRef.current.set(key, lines);
    return lines;
  }, []);

  // ── find: painting, scrolling, matching ──────────────────────────────────
  const paintHighlights = useCallback(() => {
    const matches = matchesRef.current;
    const pagesWithMatches = new Set(matches.map((m) => m.page));
    for (const [n, holder] of holderRefs.current) {
      let layer = holder.querySelector<HTMLDivElement>(":scope > .pp-hl-layer");
      if (!pagesWithMatches.has(n)) {
        if (layer) layer.replaceChildren();
        continue;
      }
      const meta = pageMetaRef.current.get(n);
      if (!meta) continue;
      const lines = linesFor(n, scaleFor(meta.baseW));
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "pp-hl-layer";
        holder.appendChild(layer);
      }
      layer.replaceChildren();
      matches.forEach((m, i) => {
        if (m.page !== n) return;
        const line = lines[m.lineIdx];
        if (!line) return;
        for (const r of matchRects(line, m.start, m.end)) {
          const div = document.createElement("div");
          div.className = i === matchIdxRef.current ? "pp-hl pp-hl-current" : "pp-hl";
          div.style.left = `${r.x}px`;
          div.style.top = `${r.y}px`;
          div.style.width = `${r.w}px`;
          div.style.height = `${r.h}px`;
          layer.appendChild(div);
        }
      });
    }
  }, [linesFor, scaleFor]);

  const scrollToMatch = useCallback(
    (i: number) => {
      const m = matchesRef.current[i];
      const sc = scrollRef.current;
      if (!m || !sc) return;
      const holder = holderRefs.current.get(m.page);
      const meta = pageMetaRef.current.get(m.page);
      if (!holder || !meta) return;
      const lines = linesFor(m.page, scaleFor(meta.baseW));
      const line = lines[m.lineIdx];
      const rects = line ? matchRects(line, m.start, m.end) : [];
      const targetY = rects.length > 0 ? rects[0].y : 0;
      // coordinate-space-safe delta (same trick as scrollToPage)
      const delta = holder.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      setCurrentPage(m.page);
      sc.scrollTo({
        top: Math.max(0, sc.scrollTop + delta + targetY - sc.clientHeight * 0.3),
        behavior: "smooth",
      });
    },
    [linesFor, scaleFor],
  );

  const recomputeMatches = useCallback(
    (jump: boolean) => {
      const q = queryRef.current.trim();
      if (!q) {
        matchesRef.current = [];
        matchIdxRef.current = 0;
        setMatchInfo(null);
        paintHighlights();
        return;
      }
      const re = findRegex(q);
      const out: Match[] = [];
      for (let p = 1; p <= numPagesRef.current; p++) {
        if (!itemsRef.current.has(p)) continue;
        const meta = pageMetaRef.current.get(p);
        if (!meta) continue;
        const lines = linesFor(p, scaleFor(meta.baseW));
        for (const h of findInLines(lines, re)) {
          out.push({ page: p, lineIdx: h.lineIdx, start: h.start, end: h.end });
        }
      }
      matchesRef.current = out;
      if (out.length === 0) {
        matchIdxRef.current = 0;
      } else if (jump) {
        const from = Math.max(1, centerRef.current);
        const idx = out.findIndex((m) => m.page >= from);
        matchIdxRef.current = idx >= 0 ? idx : 0;
        scrollToMatch(matchIdxRef.current);
      } else if (matchIdxRef.current >= out.length) {
        matchIdxRef.current = 0;
        scrollToMatch(0);
      }
      setMatchInfo({ count: out.length, index: matchIdxRef.current });
      paintHighlights();
    },
    [linesFor, scaleFor, paintHighlights, scrollToMatch],
  );

  // ── text layer overlay (selection) ───────────────────────────────────────
  const renderTextLayerInto = useCallback(
    (holder: HTMLDivElement, n: number, page: PdfPage, scale: number) => {
      const ns = pdfjsNsRef.current;
      if (!ns) return;
      textLayersRef.current.get(n)?.cancel();
      textLayersRef.current.delete(n);
      const tl = ensureAux(holder, "pp-textLayer");
      tl.replaceChildren();
      const tc = itemsRef.current.get(n);
      if (!tc) return; // indexer will attach it once the page is extracted
      try {
        const layer = new ns.TextLayer({
          textContentSource: tc,
          container: tl,
          viewport: page.getViewport({ scale }),
        });
        textLayersRef.current.set(n, layer);
        void layer.render().catch(() => {
          /* cancelled or pane detached */
        });
      } catch {
        /* page gone — ignore */
      }
    },
    [],
  );

  // ── idle sweep: free canvases beyond the hysteresis band (never mid-scroll)
  const scheduleSweep = useCallback(() => {
    if (sweepTimerRef.current !== null) return; // already pending — coalesce
    sweepTimerRef.current = window.setTimeout(() => {
      sweepTimerRef.current = null;
      const center = centerRef.current;
      // farthest-first: band-escapees always freed; then overflow down to cap
      const ordered = [...canvasesRef.current].sort(
        (a, b) => Math.abs(b - center) - Math.abs(a - center),
      );
      let live = canvasesRef.current.size;
      for (const n of ordered) {
        const beyondBand = Math.abs(n - center) > CLEAR_RADIUS;
        if (!beyondBand && live <= MAX_CANVASES) break; // closest pages survive
        tasksRef.current.get(n)?.cancel();
        tasksRef.current.delete(n);
        textLayersRef.current.get(n)?.cancel();
        textLayersRef.current.delete(n);
        canvasesRef.current.delete(n);
        holderRefs.current.get(n)?.replaceChildren();
        live--;
      }
    }, SWEEP_DELAY_MS);
  }, []);

  // ── rendering (double-buffered: paint detached, swap atomically) ─────────
  const renderPage = useCallback(
    async (n: number) => {
      const doc = docRef.current;
      const holder = holderRefs.current.get(n);
      if (!doc || !holder || !holder.isConnected) return;
      tasksRef.current.get(n)?.cancel(); // supersede any in-flight render
      let page: PdfPage;
      try {
        page = await doc.getPage(n);
      } catch {
        return; // doc destroyed while unmounting
      }
      if (docRef.current !== doc || !holder.isConnected) return;
      const { scale, cssW, cssH } = fitFor(page);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.className = "block";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const task = page.render({ canvasContext: ctx, viewport }) as RenderTask;
      tasksRef.current.set(n, task);
      try {
        await task.promise;
      } catch {
        if (tasksRef.current.get(n) === task) tasksRef.current.delete(n);
        return; // cancelled or transient
      }
      if (tasksRef.current.get(n) !== task) return; // superseded by a newer render
      tasksRef.current.delete(n);
      // wandered far off-viewport while painting → don't mount, sweep will not
      if (Math.abs(n - centerRef.current) > CLEAR_RADIUS) return;
      holder.replaceChildren(canvas);
      holder.style.width = `${cssW}px`;
      holder.style.height = `${cssH}px`;
      // pdf.js TextLayer positions spans with calc(var(--scale-factor) * Npx)
      holder.style.setProperty("--scale-factor", String(scale));
      const hl = ensureAux(holder, "pp-hl-layer");
      const tl = ensureAux(holder, "pp-textLayer");
      holder.append(hl, tl);
      canvasesRef.current.add(n);
      // zoom/resize scroll preservation: on the center page's first swap,
      // scale scrollTop by the height ratio so the same content stays in view
      const anchor = anchorRef.current;
      if (anchor && n === centerRef.current && Date.now() - anchor.at < 3000 && anchor.pageH > 0) {
        anchorRef.current = null;
        const sc = scrollRef.current;
        if (sc) sc.scrollTop = Math.round((anchor.top * cssH) / anchor.pageH);
      }
      renderTextLayerInto(holder, n, page, scale);
      paintHighlights();
      scheduleSweep();
    },
    [fitFor, scheduleSweep, renderTextLayerInto, paintHighlights],
  );

  /** Render wanted pages (center ± RENDER_RADIUS, nearest-first). */
  const syncWindow = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const center = centerRef.current;
    for (let d = 0; d <= RENDER_RADIUS; d++) {
      for (const n of d === 0 ? [center] : [center - d, center + d]) {
        if (n < 1 || n > doc.numPages) continue;
        if (canvasesRef.current.has(n) || tasksRef.current.has(n)) continue;
        void renderPage(n);
      }
    }
    scheduleSweep();
  }, [renderPage, scheduleSweep]);

  /** Zoom/resize re-fit: re-render in-radius canvases at the new scale while
   * the old ones stay visible (double buffering), re-style placeholders. */
  const refreeze = useCallback(() => {
    const doc = docRef.current;
    const scroller = scrollRef.current;
    if (!doc || !scroller) return;
    const center = centerRef.current;
    const pageH = holderRefs.current.get(center)?.offsetHeight ?? 0;
    anchorRef.current = { top: scroller.scrollTop, pageH, at: Date.now() };
    linesCacheRef.current.clear(); // scale-dependent geometry is now stale
    for (const n of [...canvasesRef.current]) {
      if (Math.abs(n - center) <= RENDER_RADIUS) void renderPage(n);
    }
    applyPlaceholderStyles();
    recomputeMatches(false);
    scheduleSweep();
  }, [renderPage, applyPlaceholderStyles, recomputeMatches, scheduleSweep]);

  // ── background text indexer (lazy — search/consumers pull it) ────────────
  const runIndexer = useCallback(
    (doc: PdfDoc) => {
      if (fullTextPromiseRef.current) return fullTextPromiseRef.current;
      const gen = ++indexGenRef.current;
      const p = (async () => {
        for (let n = 1; n <= doc.numPages; n++) {
          if (gen !== indexGenRef.current || docRef.current !== doc) return false;
          if (itemsRef.current.has(n)) continue;
          try {
            const page = await doc.getPage(n);
            if (gen !== indexGenRef.current || docRef.current !== doc) return false;
            const tc = await page.getTextContent();
            if (gen !== indexGenRef.current || docRef.current !== doc) return false;
            itemsRef.current.set(n, tc);
            const vp1 = page.getViewport({ scale: 1 });
            pageMetaRef.current.set(n, {
              vt: vp1.transform as number[],
              baseW: vp1.width,
              baseH: vp1.height,
            });
            // a page that already painted needs its selection layer now
            const holder = holderRefs.current.get(n);
            if (holder && canvasesRef.current.has(n) && holder.isConnected) {
              renderTextLayerInto(holder, n, page, scaleFor(vp1.width));
            }
            if (findOpenRef.current) {
              setIndexProgress({ done: n, total: doc.numPages });
              recomputeMatches(false);
            }
          } catch {
            /* page extraction failed — skip, never block the rest */
          }
        }
        if (findOpenRef.current) setIndexProgress(null);
        return docRef.current === doc;
      })();
      fullTextPromiseRef.current = p;
      void p.then((ok) => {
        if (!ok && fullTextPromiseRef.current === p) fullTextPromiseRef.current = null;
      });
      return p;
    },
    [renderTextLayerInto, scaleFor, recomputeMatches],
  );

  /** Resolve once every page's text is indexed (false on load failure/timeout). */
  const ensureFullText = useCallback((): Promise<boolean> => {
    const cached = fullTextPromiseRef.current;
    if (cached) return cached;
    const doc = docRef.current;
    if (doc) return runIndexer(doc);
    if (phaseRef.current === "error") return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => settle(false), DOC_WAIT_TIMEOUT_MS);
      const settle = (ok: boolean) => {
        window.clearTimeout(timer);
        const arr = pendingReadyRef.current;
        const i = arr.indexOf(settle);
        if (i >= 0) arr.splice(i, 1);
        resolve(ok);
      };
      pendingReadyRef.current.push(settle);
    }).then((ok) => {
      const d = ok ? docRef.current : null;
      return d ? runIndexer(d) : false;
    });
  }, [runIndexer]);

  const extractLines = useCallback(async (): Promise<
    Array<{ page: number; lines: PdfLine[] }> | null
  > => {
    const ok = await ensureFullText();
    if (!ok || !docRef.current) return null;
    const out: Array<{ page: number; lines: PdfLine[] }> = [];
    for (let n = 1; n <= docRef.current.numPages; n++) {
      out.push({ page: n, lines: linesFor(n, 1) });
    }
    return out;
  }, [ensureFullText, linesFor]);

  // ── center-page tracking ─────────────────────────────────────────────────
  const computeCenter = useCallback((): number | null => {
    const scroller = scrollRef.current;
    if (!scroller) return null;
    // rect-based (NOT offsetTop — holders live in a different coordinate
    // space whenever the scroller isn't their offsetParent); converted to
    // scroller-relative offsets so scrollTop/clientHeight compare correctly
    const sr = scroller.getBoundingClientRect();
    const mid = scroller.clientHeight / 2;
    let best = 1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [n, el] of holderRefs.current) {
      const r = el.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) continue; // hidden pane
      const top = r.top - sr.top;
      const bottom = top + r.height;
      const dist = mid < top ? top - mid : mid > bottom ? mid - bottom : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    return best;
  }, []);

  const onNearChange = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const c = computeCenter();
      if (c != null && c !== centerRef.current) {
        centerRef.current = c;
        setCurrentPage(c);
      }
      syncWindow();
    });
  }, [computeCenter, syncWindow]);

  // ── load document (loads once per url/retry; survives active toggles) ────
  useEffect(() => {
    if (!active) return;
    if (docRef.current) return; // re-activated pane — doc, canvases, scroll kept
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        pdfjsNsRef.current = pdfjs;
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        numPagesRef.current = doc.numPages;
        const p1 = await doc.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        aspectRef.current = vp.height / vp.width;
        setNumPages(doc.numPages);
        centerRef.current = 1;
        setCurrentPage(1);
        setPhase("ready");
        const waiting = pendingReadyRef.current.splice(0);
        for (const fn of waiting) fn(true);
        syncWindow(); // holders may not exist yet — the ready-kick re-runs this
      } catch (err) {
        if (cancelled) return;
        setErrorMsg((err as Error)?.message ?? "Could not load the PDF");
        setPhase("error");
        const waiting = pendingReadyRef.current.splice(0);
        for (const fn of waiting) fn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, active, reloadKey, syncWindow]);

  /** Hard teardown — only on url/retry change or unmount (NOT on toggles). */
  useEffect(() => {
    /* eslint-disable react-hooks/exhaustive-deps -- teardown reads the LATEST
       ref state by design (the unmount sweep of every tracked render
       layers, tasks and caches must all be torn down); snapshotting
       ref.current into effect-body locals — the rule's suggested pattern —
       would capture EMPTY mount-time containers and leak every render since.
       Ported verbatim from the demo's verified pdf.js lifecycle. */
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (sweepTimerRef.current !== null) {
        window.clearTimeout(sweepTimerRef.current);
        sweepTimerRef.current = null;
      }
      indexGenRef.current++;
      fullTextPromiseRef.current = null;
      const waiting = pendingReadyRef.current.splice(0);
      for (const fn of waiting) fn(false);
      for (const t of tasksRef.current.values()) t.cancel();
      tasksRef.current.clear();
      for (const l of textLayersRef.current.values()) {
        try {
          l.cancel();
        } catch {
          /* already dead */
        }
      }
      textLayersRef.current.clear();
      canvasesRef.current.clear();
      holderRefs.current.clear();
      anchorRef.current = null;
      itemsRef.current.clear();
      pageMetaRef.current.clear();
      linesCacheRef.current.clear();
      matchesRef.current = [];
      matchIdxRef.current = 0;
      const doc = docRef.current;
      docRef.current = null;
      void doc?.destroy();
    };
  }, [url, reloadKey]);

  /** When the doc becomes ready the placeholder divs must exist in the DOM
   * before any canvas can mount into them — re-kick the window post-commit
   * (also covers a pane re-activating in split view). */
  useEffect(() => {
    if (phase !== "ready" || !active) return;
    applyPlaceholderStyles();
    syncWindow();
  }, [phase, active, applyPlaceholderStyles, syncWindow]);

  // ── near-zone tracking: IntersectionObserver (passive-scroll fallback) ───
  useEffect(() => {
    if (phase !== "ready" || !active) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (typeof IntersectionObserver === "undefined") {
      const onScroll = () => onNearChange();
      scroller.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => scroller.removeEventListener("scroll", onScroll);
    }
    const io = new IntersectionObserver(() => onNearChange(), {
      root: scroller,
      rootMargin: "300% 0px",
      threshold: 0,
    });
    for (const el of holderRefs.current.values()) io.observe(el);
    onNearChange();
    return () => {
      io.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [phase, active, numPages, onNearChange]);

  // ── resize → re-fit placeholders now, re-render debounced ────────────────
  useEffect(() => {
    if (phase !== "ready" || !active) return;
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    let lastW = scroller.clientWidth;
    let t: number | null = null;
    const ro = new ResizeObserver(() => {
      const w = scroller.clientWidth;
      if (Math.abs(w - lastW) < 8) return; // scrollbar jitter
      lastW = w;
      applyPlaceholderStyles();
      if (t !== null) window.clearTimeout(t);
      t = window.setTimeout(() => {
        t = null;
        refreeze();
      }, 150);
    });
    ro.observe(scroller);
    return () => {
      ro.disconnect();
      if (t !== null) window.clearTimeout(t);
    };
  }, [phase, active, applyPlaceholderStyles, refreeze]);

  // ── ref mirrors + find-bar registration ──────────────────────────────────
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    findOpenRef.current = findOpen;
    if (findOpen) findInputRef.current?.focus();
  }, [findOpen]);

  useEffect(() => {
    installFindKeydown();
    const host: FindHost = {
      open: () => {
        for (const other of findHosts) {
          if (other !== host) other.close();
        }
        setFindOpen(true);
        requestAnimationFrame(() => findInputRef.current?.focus());
      },
      close: () => setFindOpen(false),
      canOpen: () => activeRef.current && phaseRef.current === "ready",
    };
    selfHostRef.current = host;
    findHosts.add(host);
    return () => {
      findHosts.delete(host);
      if (lastFindHost === host) lastFindHost = null;
      if (selfHostRef.current === host) selfHostRef.current = null;
    };
  }, []);

  // repaint highlight rects when the visible match / zoom changes
  useEffect(() => {
    if (phase !== "ready") return;
    paintHighlights();
  }, [phase, matchInfo, zoomPct, paintHighlights]);

  // ── find handlers ────────────────────────────────────────────────────────
  const openFindAndIndex = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => findInputRef.current?.focus());
    if (!fullTextPromiseRef.current) {
      const doc = docRef.current;
      if (doc) runIndexer(doc);
    }
  }, [runIndexer]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    matchesRef.current = [];
    matchIdxRef.current = 0;
    setMatchInfo(null);
    paintHighlights();
  }, [paintHighlights]);

  const onFindQueryChange = useCallback(
    (v: string) => {
      setFindQuery(v);
      queryRef.current = v;
      recomputeMatches(true);
    },
    [recomputeMatches],
  );

  const stepMatch = useCallback(
    (dir: 1 | -1) => {
      const count = matchesRef.current.length;
      if (count === 0) return;
      const next = (matchIdxRef.current + dir + count) % count;
      matchIdxRef.current = next;
      setMatchInfo({ count, index: next });
      scrollToMatch(next);
      paintHighlights();
    },
    [scrollToMatch, paintHighlights],
  );

  /** Keep the "last-interacted pane" pointer honest for Ctrl+F routing. */
  const claimSelf = useCallback(() => {
    if (selfHostRef.current) lastFindHost = selfHostRef.current;
  }, []);

  // ── imperative handle ────────────────────────────────────────────────────
  const scrollToPage = useCallback((n: number) => {
    const el = holderRefs.current.get(n);
    const scroller = scrollRef.current;
    if (el && scroller) {
      // rect-based, coordinate-space-safe (see computeCenter)
      const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: scroller.scrollTop + delta - 8, behavior: "smooth" });
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      extractLines,
      scrollToPage,
    }),
    [extractLines, scrollToPage],
  );

  // ── toolbar actions ──────────────────────────────────────────────────────
  const zoomBy = useCallback(
    (factor: number) => {
      const next = Math.min(3, Math.max(1, zoomRef.current * factor));
      if (next === zoomRef.current) return;
      zoomRef.current = next;
      setZoomPct(Math.round(next * 100));
      refreeze();
    },
    [refreeze],
  );

  const resetFit = useCallback(() => {
    if (zoomRef.current === 1) return;
    zoomRef.current = 1;
    setZoomPct(100);
    refreeze();
  }, [refreeze]);

  /** Stable holder ref — sizes the placeholder on mount without React state.
   * (React 19 ref-cleanup form: the returned fn runs on unmount.) */
  const holderRefCb = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const n = Number(el.dataset.page);
    holderRefs.current.set(n, el);
    if (!canvasesRef.current.has(n) && !el.style.width) {
      const avail = Math.max(240, (el.parentElement?.clientWidth ?? 800) - 24);
      const w = Math.round(avail * zoomRef.current);
      el.style.width = `${w}px`;
      el.style.height = `${Math.round(w * aspectRef.current)}px`;
    }
    return () => {
      holderRefs.current.delete(n);
    };
  }, []);

  const findCountLabel = (() => {
    if (!findQuery.trim()) return "";
    if (!matchInfo || matchInfo.count === 0) {
      return indexProgress
        ? `no hits · indexing ${indexProgress.done}/${indexProgress.total}`
        : "no matches";
    }
    const base = `${matchInfo.index + 1}/${matchInfo.count}`;
    return indexProgress ? `${base} · indexing…` : base;
  })();

  return (
    <div
      ref={rootRef}
      className={cn(
        "pp-pane relative flex min-h-0 flex-col overflow-hidden rounded-lg border bg-muted/30",
        className,
      )}
      onPointerDownCapture={claimSelf}
      onFocusCapture={claimSelf}
    >
      {/* toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-background/95 px-2 py-1.5 print:hidden">
        <span className="mr-1 min-w-0 truncate text-xs font-semibold" title={label}>
          {label}
        </span>
        {phase === "ready" && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              <ChevronUp className="size-3.5" aria-hidden />
            </Button>
            <span className="min-w-14 text-center font-mono text-[11px] tabular-nums">
              {currentPage} / {numPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))}
              disabled={currentPage >= numPages}
              aria-label="Next page"
            >
              <ChevronDown className="size-3.5" aria-hidden />
            </Button>
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={() => zoomBy(1 / 1.25)}
              aria-label="Zoom out"
              disabled={zoomPct <= 100}
              title={`Zoom: ${zoomPct}% of fit width`}
            >
              <Minus className="size-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={() => zoomBy(1.25)}
              aria-label="Zoom in"
              title={`Zoom: ${zoomPct}% of fit width`}
            >
              <Plus className="size-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={resetFit}
              aria-label="Reset to fit width"
              disabled={zoomPct <= 100}
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </Button>
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={() => (findOpen ? closeFind() : openFindAndIndex())}
              aria-label="Find in document"
              aria-pressed={findOpen}
              title="Find (Ctrl+F)"
            >
              <Search className="size-3.5" aria-hidden />
            </Button>
            {canFullscreen && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 px-0"
                onClick={toggleFullscreen}
                aria-label="Fullscreen"
                title="Fullscreen"
              >
                <Maximize2 className="size-3.5" aria-hidden />
              </Button>
            )}
          </div>
        )}
        {downloadUrl && (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-muted"
            aria-label={`Open or download ${label}`}
          >
            <Download className="size-3.5" aria-hidden />
            PDF
          </a>
        )}
      </div>

      {/* find bar (Ctrl+F / toolbar search) */}
      {phase === "ready" && findOpen && (
        <div
          role="search"
          aria-label={`Find in ${label}`}
          className="absolute right-2 top-11 z-30 flex items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-md backdrop-blur"
        >
          <Search className="ml-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => onFindQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeFind();
              }
            }}
            placeholder="Find in document…"
            aria-label="Find in document"
            autoComplete="off"
            className="h-9 w-32 bg-transparent text-xs outline-none placeholder:text-muted-foreground sm:w-44"
          />
          <span
            className="whitespace-nowrap px-0.5 text-[11px] tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            {findCountLabel}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 px-0"
            onClick={() => stepMatch(-1)}
            disabled={!matchInfo || matchInfo.count === 0}
            aria-label="Previous match"
          >
            <ChevronUp className="size-3.5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 px-0"
            onClick={() => stepMatch(1)}
            disabled={!matchInfo || matchInfo.count === 0}
            aria-label="Next match"
          >
            <ChevronDown className="size-3.5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 px-0"
            onClick={closeFind}
            aria-label="Close search"
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      )}

      {/* content */}
      {phase === "loading" && (
        <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
          Loading {label}…
        </div>
      )}
      {phase === "error" && (
        <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle className="size-6 text-amber-500" aria-hidden />
          <p className="max-w-xs text-sm text-muted-foreground">
            Couldn&apos;t load <span className="font-medium">{label}</span>
            {errorMsg ? ` — ${errorMsg}` : ""}. The archive may be briefly unavailable.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPhase("loading");
                setErrorMsg(null);
                setReloadKey((k) => k + 1);
              }}
            >
              Retry
            </Button>
            {downloadUrl && (
              <a href={downloadUrl} target="_blank" rel="noreferrer">
                <Button size="sm" variant="ghost">
                  Open raw PDF
                </Button>
              </a>
            )}
          </div>
        </div>
      )}
      {phase === "ready" && (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {Array.from({ length: numPages }, (_, i) => {
            const n = i + 1;
            return (
              <div
                key={n}
                data-page={n}
                ref={holderRefCb}
                className="relative mx-auto mb-3 rounded bg-background shadow-sm"
              />
            );
          })}
          <p className="pb-2 pt-1 text-center text-[10px] text-muted-foreground">
            End of document · {numPages} page{numPages === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </div>
  );
});
