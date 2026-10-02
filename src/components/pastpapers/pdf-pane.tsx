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
 *   - fit-width by default (recomputed on container resize), zoom on top of
 *     fit — including the BELOW-fit overview steps (75/50/25%), s141+s142;
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
 * Viewer affordances (v4 — operator audit s140):
 *
 *   - the page indicator is an INPUT — type a page, Enter (jumps farther than
 *     2.5 viewports are instant, not an animated 30k-px scroll);
 *   - the loading state shows real download progress (pdf.js onProgress) and
 *     a stalled load fails honestly after LOAD_TIMEOUT_MS (Retry / open raw);
 *   - zoom is a round ladder (25→300%) clamped to MAX_RENDER_SCALE / fit so
 *     the shown % is always the rendered % (the old 1.25^n steps drifted to
 *     156/195/244% and silently capped at scale 4 on wide panes); s141 added
 *     the below-fit overview steps (75/50/25% — 25% is the thumbnail view)
 *     — pages center in the wider scroller (mx-auto) and every scale
 *     computation composes with a multiplier < 1;
 *   - FIT PRESETS (s142): the ladder multiplies either fit-width (default)
 *     or fit-page — the toolbar's segmented control swaps the base, zoom
 *     resets to 100% of the new base, and every geometry path (scaleFor,
 *     placeholders, the honest ceiling, the resize observer) reads the mode;
 *   - TWO-PAGE SPREAD (s143): wide panes pair facing pages [1|2][3|4]… into
 *     one scroll flow — each page fits half the width (fit-page frames the
 *     pair); the toggle appears only when the pane is wide enough, a pane
 *     shrinking below the threshold auto-offs the layout (without erasing
 *     the choice — widening again restores it), and prev/next step by pair;
 *   - VIEWING PREFERENCES (s143): the whole setup — fit base, zoom step,
 *     rotation, spread — persists in localStorage and is restored on the
 *     next paper, validated against TODAY's constants so a stale record
 *     falls back field-by-field (no resume-at-page-N across papers: that
 *     gets surprising on papers of different lengths);
 *   - ROTATION (90° steps): canvases/text layers re-render through rotated
 *     pdf.js viewports while the line model stays in unrotated space —
 *     highlight/scroll-to-match rects map through rotRect() (pure 90°-step
 *     geometry, derived from pdf.js's own viewport transform);
 *   - the pages region is a focusable role=region (arrow keys scroll,
 *     +/−/0 zoom); each page holder is a labelled role=img; unpainted
 *     placeholders carry a "Page N" ghost (CSS .pp-holder:empty).
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
  BookOpen,
  ChevronDown,
  ChevronUp,
  Download,
  Frame,
  Loader2,
  Maximize2,
  Minus,
  MoveHorizontal,
  Plus,
  RotateCcw,
  RotateCw,
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
import { prettyBytes } from "@/lib/pastpapers-shared";

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
  /** F-022 tranche 2: deep-linked landing page — the pane scrolls there once
   *  the doc is ready and the page holders exist (one-shot; page 1 = no-op) */
  initialPage?: number;
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
/**
 * Hard cap on a stalled document LOAD before the honest error state (Retry /
 * Open raw PDF) replaces the spinner (operator audit s140: a wedged fetch
 * used to spin forever — raw.githubusercontent hiccups need an exit).
 */
const LOAD_TIMEOUT_MS = 45_000;
/**
 * Zoom ladder — multipliers on the active fit base, honest round steps (the
 * old 1.25^n ladder showed 156% / 195% / 244%). Clamped per-pane by
 * MAX_RENDER_SCALE / fit so the shown % is always the rendered %.
 * s141 (operator: "Ability to zoom out the pdf a bit more"): the ladder
 * descends BELOW fit-width — 75% and 50% overview steps. Holders center via
 * mx-auto in the wider scroller; scaleFor, placeholder widths and the
 * scroll-anchor ratio all compose with multipliers < 1.
 * s142 (operator: "push the floor lower (25% thumbnail view), add a fit-page
 * preset alongside fit-width"): 25% joins as the thumbnail floor, and the
 * base the ladder multiplies is either fit-width or fit-page (FitMode).
 */
const ZOOM_LADDER = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
/** Ladder index of 100% — the default zoom and the `0` key's reset target. */
const FIT_LADDER_IDX = ZOOM_LADDER.indexOf(1);
/** Lowest ladder step, as a toolbar percentage (the zoom-out button's floor). */
const MIN_ZOOM_PCT = Math.round(ZOOM_LADDER[0] * 100);
/** pdf.js render-scale ceiling (canvas memory guard; also honesty cap). */
const MAX_RENDER_SCALE = 4;
type Rot = 0 | 90 | 180 | 270;
/** The fit base the zoom ladder multiplies: fill the pane's width, or frame
 *  the whole page (width AND height) inside the scroller (s142). */
type FitMode = "width" | "page";
/** The flex row's gap-3 gutter between facing pages, in px (s143). */
const SPREAD_GAP = 12;
/** Scroller content width needed to OFFER the two-page spread (s143): below
 *  this a pair of pages is two unreadable slivers — a portrait phone pane or
 *  one half of the desktop QP|MS split never shows the toggle. */
const SPREAD_MIN_W = 800;

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

/** Fetch-or-create an absolutely-positioned aux layer inside a holder.
 * (s140 audit: the create branch used to return a DETACHED node — it worked
 * only because every caller pre-appended; now appending is the helper's own
 * job, so a future caller can never render an invisible layer.) */
function ensureAux(holder: HTMLDivElement, cls: string): HTMLDivElement {
  const existing = holder.querySelector<HTMLDivElement>(`:scope > .${cls}`);
  if (existing) return existing;
  const el = document.createElement("div");
  el.className = cls;
  holder.appendChild(el);
  return el;
}

/**
 * Map a highlight rect from the user-unrotated page space (the line model's
 * coordinate space) into on-screen space at the current user rotation.
 * Rotations are multiples of 90°, so the result stays axis-aligned; w0/h0 are
 * the UNROTATED page box at the SAME scale as the rect's coordinates (pdf.js
 * applies one uniform scale to the rotated and unrotated viewports alike —
 * derivation from pdf.js getViewport's transform for viewBox [0,0,W,H]:
 * rot 90: (x,y)→(H0−y,x), rot 180: (x,y)→(W0−x,H0−y), rot 270: (x,y)→(y,W0−x)).
 */
function rotRect(
  r: { x: number; y: number; w: number; h: number },
  rot: Rot,
  w0: number,
  h0: number,
): { x: number; y: number; w: number; h: number } {
  switch (rot) {
    case 90:
      return { x: h0 - r.y - r.h, y: r.x, w: r.h, h: r.w };
    case 180:
      return { x: w0 - r.x - r.w, y: h0 - r.y - r.h, w: r.w, h: r.h };
    case 270:
      return { x: r.y, y: w0 - r.x - r.w, w: r.h, h: r.w };
    default:
      return r;
  }
}

// ── viewing preferences (s143): ONE localStorage record per browser, shared
// by every pane and every paper — "the viewer's setup", not per-document
// state. Fields are validated against TODAY's constants on read, so a record
// written by an older build (shorter ladder, no spread) degrades safely.
const PREFS_KEY = "pp-viewer-prefs-v1";
interface PpPrefs {
  fit: FitMode;
  /** ladder MULTIPLIER — portable across papers, it is relative to the fit base */
  zoom: number;
  rot: Rot;
  spread: boolean;
}
const DEFAULT_PREFS: PpPrefs = { fit: "width", zoom: 1, rot: 0, spread: false };

function readPrefs(): PpPrefs {
  const d = DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<PpPrefs>;
    return {
      fit: p.fit === "page" || p.fit === "width" ? p.fit : d.fit,
      zoom:
        typeof p.zoom === "number" && ZOOM_LADDER.includes(p.zoom) ? p.zoom : d.zoom,
      rot: p.rot === 90 || p.rot === 180 || p.rot === 270 ? p.rot : d.rot,
      spread: typeof p.spread === "boolean" ? p.spread : d.spread,
    };
  } catch {
    return d; // storage disabled or a corrupt record — defaults
  }
}

function writePrefs(p: PpPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode et al. — viewing works, it just isn't remembered */
  }
}

export const PdfPane = forwardRef<PdfPaneHandle, PdfPaneProps>(function PdfPane(
  { url, downloadUrl, label, active, initialPage, className },
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
  /** user rotation offset (0/90/180/270, composes with each page's own rotate) */
  const rotRef = useRef<Rot>(0);
  /** zoom ladder index (ZOOM_LADDER) — ref for math, state mirrors in zoomPct */
  const zoomIdxRef = useRef(FIT_LADDER_IDX);
  /** active fit base (s142) — ref for render math, state mirrors in fitMode */
  const fitModeRef = useRef<FitMode>("width");
  /** two-page spread (s143) — ref for render math (availBox halves per page),
   *  state mirrors in `spread` */
  const spreadRef = useRef(false);
  /** the user's spread INTENT — only an explicit toolbar toggle changes it;
   *  a too-narrow pane auto-offs the LAYOUT but keeps the intent, so widening
   *  back restores the pairing (and the stored preference never erases) */
  const spreadWantedRef = useRef(false);
  /** scroll anchor across a spread toggle (same height-ratio trick as zoom) */
  const spreadAnchorRef = useRef<{ top: number; pageH: number; at: number } | null>(null);
  /** previous spread value — the ready-kick effect resets the canvas ledger
   *  only when a toggle actually rebuilt the holder rows (s143) */
  const prevSpreadRef = useRef(false);
  /** page-1 unrotated box (honest zoom ceiling + placeholder aspect) */
  const base1Ref = useRef<{ w: number; h: number } | null>(null);

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

  // F-022 tranche 2 — one-shot deep-link landing (the effect itself lives
  // below, after scrollToPage's declaration). Captured once per mount — the
  // URL param is not expected to change in place.
  const initialPageRef = useRef(initialPage);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  /** zoom multiplier on the active fit base — ref for render math, state for the toolbar */
  const [zoomPct, setZoomPct] = useState(100);
  /** the fit base itself (width | page) — toolbar state, mirror in fitModeRef */
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [rot, setRot] = useState<Rot>(0);
  /** two-page spread layout (s143) — toolbar/JSX state, mirror in spreadRef */
  const [spread, setSpread] = useState(false);
  /** the pane is wide enough to offer spread (tracked by the resize observer) */
  const [spreadAvail, setSpreadAvail] = useState(false);
  /** the prefs restore ran — gates the writer so the mount pass can't clobber */
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  /** download progress for the loading state (pdf.js onProgress) */
  const [loadProg, setLoadProg] = useState<{ loaded: number; total: number } | null>(null);
  /** the page-number input's draft (committed on Enter/blur, synced on scroll) */
  const [pageDraft, setPageDraft] = useState("1");
  const pageInputRef = useRef<HTMLInputElement>(null);
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

  // ── viewing preferences (s143): restore on mount, write on every change ──
  // The restore runs BEFORE the doc can finish loading (effects fire before
  // any network promise resolves), so the first placeholder sizing and the
  // first renders already use the user's fit base, zoom step and rotation.
  // Spread is validated later against the pane's measured width (the resize
  // observer auto-offs it when too narrow — intent preserved, see spreadWantedRef).
  useEffect(() => {
    const p = readPrefs();
    fitModeRef.current = p.fit;
    setFitMode(p.fit);
    const zi = ZOOM_LADDER.indexOf(p.zoom);
    zoomIdxRef.current = zi >= 0 ? zi : FIT_LADDER_IDX;
    zoomRef.current = ZOOM_LADDER[zoomIdxRef.current];
    setZoomPct(Math.round(ZOOM_LADDER[zoomIdxRef.current] * 100));
    rotRef.current = p.rot;
    setRot(p.rot);
    spreadWantedRef.current = p.spread;
    spreadRef.current = p.spread;
    setSpread(p.spread);
    setPrefsHydrated(true);
  }, []);

  useEffect(() => {
    if (!prefsHydrated) return;
    writePrefs({
      fit: fitMode,
      zoom: zoomPct / 100, // the ladder value (zoomPct = round(ladder×100))
      rot,
      // the INTENT, not the layout: a narrow-pane auto-off must never erase
      // the user's wide-screen choice (spreadWantedRef, s143)
      spread: spreadWantedRef.current,
    });
  }, [prefsHydrated, fitMode, zoomPct, rot, spread]);

  // ── geometry ─────────────────────────────────────────────────────────────
  /** On-screen page width at the current user rotation (what fit-width fits). */
  const rotW = useCallback(
    (meta: { baseW: number; baseH: number }) =>
      rotRef.current % 180 === 90 ? meta.baseH : meta.baseW,
    [],
  );

  /** On-screen page height at the current user rotation (what fit-page needs). */
  const rotH = useCallback(
    (meta: { baseW: number; baseH: number }) =>
      rotRef.current % 180 === 90 ? meta.baseW : meta.baseH,
    [],
  );

  /** The PER-PAGE fit box (s143): the scroller's content width minus the px-3
   *  gutters — halved (minus the 12px mate gutter) in two-page spread — and
   *  its height minus the py-3 gutters AND one mb-3 page gap, so a fit-page
   *  page plus its margin stays whole in view (s142). */
  const availBox = useCallback(() => {
    const el = scrollRef.current;
    const raw = Math.max(240, (el?.clientWidth ?? 800) - 24);
    return {
      w: spreadRef.current ? Math.max(120, (raw - SPREAD_GAP) / 2) : raw,
      h: Math.max(160, (el?.clientHeight ?? 600) - 36),
    };
  }, []);

  /** Fit scale for a page of on-screen (rotated) box w×h at the current zoom:
   *  fit-width fills the pane's width; fit-page takes the smaller of the
   *  width/height ratios so the WHOLE page is framed (s142). */
  const scaleFor = useCallback(
    (w: number, h: number) => {
      const avail = availBox();
      const base =
        fitModeRef.current === "page" ? Math.min(avail.w / w, avail.h / h) : avail.w / w;
      return Math.min(MAX_RENDER_SCALE, base * zoomRef.current);
    },
    [availBox],
  );

  const fitFor = useCallback(
    (page: PdfPage) => {
      const base = page.getViewport({
        scale: 1,
        rotation: (page.rotate + rotRef.current) % 360,
      });
      const scale = scaleFor(base.width, base.height);
      return { scale, cssW: Math.round(base.width * scale), cssH: Math.round(base.height * scale) };
    },
    [scaleFor],
  );

  /** Honest ceiling: the ladder step must never exceed MAX_RENDER_SCALE × the
   *  fit scale, or the shown % would lie about what actually rendered. Lives
   *  in the geometry section (not by the toolbar) — the ready-kick effect
   *  needs it to clamp a RESTORED zoom step before the first paint (s143). */
  const maxZoomMult = useCallback(() => {
    const b = base1Ref.current;
    if (!b) return ZOOM_LADDER[ZOOM_LADDER.length - 1];
    const avail = availBox();
    const w = rotRef.current % 180 === 90 ? b.h : b.w;
    const h = rotRef.current % 180 === 90 ? b.w : b.h;
    const fit1 =
      fitModeRef.current === "page" ? Math.min(avail.w / w, avail.h / h) : avail.w / w;
    return Math.max(1, Math.min(ZOOM_LADDER[ZOOM_LADDER.length - 1], MAX_RENDER_SCALE / fit1));
  }, [availBox]);

  /** Size every canvas-less holder from the container width + page aspect.
   * (s140: uses the page's OWN indexed meta when available — mixed-size
   * papers no longer all borrow page 1's aspect.) */
  const applyPlaceholderStyles = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const avail = availBox();
    const swapped = rotRef.current % 180 === 90;
    const pageMode = fitModeRef.current === "page";
    for (const [n, el] of holderRefs.current) {
      if (canvasesRef.current.has(n)) continue;
      const meta = pageMetaRef.current.get(n);
      const ar = meta
        ? swapped
          ? meta.baseW / meta.baseH
          : meta.baseH / meta.baseW
        : swapped
          ? 1 / aspectRef.current
          : aspectRef.current;
      const w = Math.round(
        (pageMode ? Math.min(avail.w, avail.h / ar) : avail.w) * zoomRef.current,
      );
      el.style.width = `${w}px`;
      el.style.height = `${Math.round(w * ar)}px`;
    }
  }, [availBox]);

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
      const scale = scaleFor(rotW(meta), rotH(meta));
      const lines = linesFor(n, scale);
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
        for (const raw of matchRects(line, m.start, m.end)) {
          // map the unrotated line-model rect onto the rotated page box
          const r = rotRect(raw, rotRef.current, meta.baseW * scale, meta.baseH * scale);
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
  }, [linesFor, scaleFor, rotW, rotH]);

  const scrollToMatch = useCallback(
    (i: number) => {
      const m = matchesRef.current[i];
      const sc = scrollRef.current;
      if (!m || !sc) return;
      const holder = holderRefs.current.get(m.page);
      const meta = pageMetaRef.current.get(m.page);
      if (!holder || !meta) return;
      const scale = scaleFor(rotW(meta), rotH(meta));
      const lines = linesFor(m.page, scale);
      const line = lines[m.lineIdx];
      const rects0 = line ? matchRects(line, m.start, m.end) : [];
      const r0 = rects0.length > 0 ? rects0[0] : { x: 0, y: 0, w: 0, h: 0 };
      const r = rotRect(r0, rotRef.current, meta.baseW * scale, meta.baseH * scale);
      // coordinate-space-safe delta (same trick as scrollToPage)
      const delta = holder.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      const target = Math.max(0, sc.scrollTop + delta + r.y - sc.clientHeight * 0.3);
      setCurrentPage(m.page);
      sc.scrollTo({
        top: target,
        // a match 30 pages away must not animate across 30k px (s140 audit)
        behavior: Math.abs(target - sc.scrollTop) > sc.clientHeight * 2.5 ? "auto" : "smooth",
      });
    },
    [linesFor, scaleFor, rotW, rotH],
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
        const lines = linesFor(p, scaleFor(rotW(meta), rotH(meta)));
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
    [linesFor, scaleFor, rotW, rotH, paintHighlights, scrollToMatch],
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
          viewport: page.getViewport({
            scale,
            rotation: (page.rotate + rotRef.current) % 360,
          }),
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
      const rot = (page.rotate + rotRef.current) % 360;
      const { scale, cssW, cssH } = fitFor(page);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr, rotation: rot });
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
              const meta1 = { baseW: vp1.width, baseH: vp1.height };
              renderTextLayerInto(holder, n, page, scaleFor(rotW(meta1), rotH(meta1)));
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
    [renderTextLayerInto, scaleFor, rotW, rotH, recomputeMatches],
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
    let adopted = false; // once the doc lands, its lifecycle belongs to the teardown effect
    setLoadProg(null);
    /** destroy ONLY a task whose doc we never adopted — a plain `active`
     * toggle must never kill a loaded doc (it survives toggling by design) */
    let task: import("pdfjs-dist").PDFDocumentLoadingTask | null = null;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      task?.destroy().catch(() => undefined);
    }, LOAD_TIMEOUT_MS);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        pdfjsNsRef.current = pdfjs;
        task = pdfjs.getDocument({ url });
        // v4: progress is a property of the loading task, not getDocument params
        task.onProgress = (p: { loaded: number; total: number }) => {
          if (!cancelled) setLoadProg({ loaded: p.loaded, total: p.total });
        };
        const doc = await task.promise;
        window.clearTimeout(timer);
        setLoadProg(null);
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        adopted = true;
        numPagesRef.current = doc.numPages;
        const p1 = await doc.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        aspectRef.current = vp.height / vp.width;
        base1Ref.current = { w: vp.width, h: vp.height };
        setNumPages(doc.numPages);
        centerRef.current = 1;
        setCurrentPage(1);
        setPhase("ready");
        const waiting = pendingReadyRef.current.splice(0);
        for (const fn of waiting) fn(true);
        syncWindow(); // holders may not exist yet — the ready-kick re-runs this
      } catch (err) {
        window.clearTimeout(timer);
        setLoadProg(null);
        if (cancelled) return;
        setErrorMsg(
          timedOut
            ? "timed out — the archive took too long to respond"
            : (err as Error)?.message ?? "Could not load the PDF",
        );
        setPhase("error");
        const waiting = pendingReadyRef.current.splice(0);
        for (const fn of waiting) fn(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (!adopted) task?.destroy().catch(() => undefined);
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
      base1Ref.current = null;
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
   * (also covers a pane re-activating in split view). s143 adds two jobs:
   * a RESTORED zoom step re-clamps to this pane's honest ceiling (a stored
   * 300% may exceed what a narrow pane can honestly render), and a spread
   * TOGGLE rebuilt every holder (rows replace the flat list) — in-flight
   * renders captured dead holders and the canvas ledger lies, so both are
   * reset before the re-kick, and the toggle's scroll anchor re-derives
   * scrollTop through the page-height ratio (the zoom anchor's trick). */
  useEffect(() => {
    if (phase !== "ready" || !active) return;
    const max = maxZoomMult();
    let zi = zoomIdxRef.current;
    while (zi > 0 && ZOOM_LADDER[zi] > max) zi--;
    const zoomClamped = ZOOM_LADDER[zi] !== zoomRef.current;
    if (zoomClamped) {
      zoomIdxRef.current = zi;
      zoomRef.current = ZOOM_LADDER[zi];
      setZoomPct(Math.round(ZOOM_LADDER[zi] * 100));
    }
    const spreadToggled = prevSpreadRef.current !== spread;
    prevSpreadRef.current = spread;
    if (spreadToggled) {
      for (const t of tasksRef.current.values()) t.cancel();
      tasksRef.current.clear();
      canvasesRef.current.clear(); // the old canvases died with the old rows
    }
    if (zoomClamped) {
      refreeze(); // re-render in-radius canvases at the honest scale
    } else {
      applyPlaceholderStyles();
    }
    if (spreadToggled) {
      const a = spreadAnchorRef.current;
      spreadAnchorRef.current = null;
      const sc = scrollRef.current;
      if (a && sc && a.pageH > 0 && Date.now() - a.at < 3000) {
        const ph = holderRefs.current.get(centerRef.current)?.offsetHeight ?? a.pageH;
        sc.scrollTop = Math.max(0, Math.round((a.top * ph) / a.pageH));
      }
    }
    syncWindow();
  }, [phase, active, spread, applyPlaceholderStyles, syncWindow, maxZoomMult, refreeze]);

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
  }, [phase, active, numPages, spread, onNearChange]);

  // ── resize → re-fit placeholders now, re-render debounced ────────────────
  useEffect(() => {
    if (phase !== "ready" || !active) return;
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    let lastW = scroller.clientWidth;
    let lastH = scroller.clientHeight;
    // s143: spread availability tracks the pane's real width (NOT the viewport
    // — a split half or a fullscreen phone differs from the window size).
    // Below the threshold the layout auto-offs but the INTENT survives
    // (spreadWantedRef), so widening back re-pairs the pages.
    let lastAvail = scroller.clientWidth - 24 >= SPREAD_MIN_W;
    const applyAvail = () => {
      const avail = scroller.clientWidth - 24 >= SPREAD_MIN_W;
      if (avail === lastAvail) return;
      lastAvail = avail;
      setSpreadAvail(avail);
      if (!avail && spreadRef.current) {
        spreadRef.current = false; // too narrow — layout off, intent kept
        setSpread(false);
      } else if (avail && spreadWantedRef.current && !spreadRef.current) {
        spreadRef.current = true; // wide again and the user wanted pairs
        setSpread(true);
      }
    };
    setSpreadAvail(lastAvail);
    let t: number | null = null;
    const ro = new ResizeObserver(() => {
      const w = scroller.clientWidth;
      const h = scroller.clientHeight;
      applyAvail();
      // 8px guards against scrollbar jitter; the height threshold is 24px —
      // ABOVE any single h-scrollbar toggle (~15px) so fit-page can never
      // oscillate (scrollbar flips height → refit → scrollbar flips…), yet
      // a real vertical resize still re-fits (s142).
      if (Math.abs(w - lastW) < 8 && Math.abs(h - lastH) < 24) return;
      lastW = w;
      lastH = h;
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

  // repaint highlight rects when the visible match / zoom / rotation changes
  useEffect(() => {
    if (phase !== "ready") return;
    paintHighlights();
  }, [phase, matchInfo, zoomPct, rot, paintHighlights]);

  // the page-input draft follows the tracked page unless the user is typing
  useEffect(() => {
    if (document.activeElement !== pageInputRef.current) setPageDraft(String(currentPage));
  }, [currentPage]);

  // ── find handlers ────────────────────────────────────────────────────────
  const openFindAndIndex = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => findInputRef.current?.focus());
    // s140 audit (B2): a REOPENED bar must show its live results again —
    // closing clears matches, so the old query would render zero highlights
    // until the next keystroke. Recompute before the user types.
    if (queryRef.current.trim()) recomputeMatches(true);
    if (!fullTextPromiseRef.current) {
      const doc = docRef.current;
      if (doc) runIndexer(doc);
    }
  }, [runIndexer, recomputeMatches]);

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
      const target = scroller.scrollTop + delta - 8;
      scroller.scrollTo({
        top: Math.max(0, target),
        // page 1 → page 40 must not animate across the whole document (s140)
        behavior: Math.abs(target - scroller.scrollTop) > scroller.clientHeight * 2.5 ? "auto" : "smooth",
      });
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

  // F-022 tranche 2 — one-shot deep-link landing: once the doc is ready the
  // page holders all exist (placeholders render for every page; only canvases
  // are virtualized), so a rect-based scrollToPage lands reliably. The
  // double-rAF waits one commit past the ready state change.
  useEffect(() => {
    if (phase !== "ready") return;
    const target = initialPageRef.current;
    initialPageRef.current = undefined;
    if (!target || target < 2) return; // page 1 is the default landing — no-op
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => scrollToPage(target));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [phase, scrollToPage]);

  // ── toolbar actions ──────────────────────────────────────────────────────
  /** (maxZoomMult lives up in the geometry section — the ready-kick effect
   *   clamps a restored zoom step with it before the first paint, s143.) */

  /** Step the ladder (dir ±1), clamped by the honest ceiling. */
  const zoomBy = useCallback(
    (dir: 1 | -1) => {
      const max = maxZoomMult();
      let idx = Math.min(ZOOM_LADDER.length - 1, Math.max(0, zoomIdxRef.current + dir));
      while (idx > 0 && ZOOM_LADDER[idx] > max) idx--;
      if (ZOOM_LADDER[idx] === zoomRef.current) return;
      zoomIdxRef.current = idx;
      zoomRef.current = ZOOM_LADDER[idx];
      setZoomPct(Math.round(ZOOM_LADDER[idx] * 100));
      refreeze();
    },
    [refreeze, maxZoomMult],
  );

  const resetFit = useCallback(() => {
    if (zoomRef.current === 1) return;
    zoomIdxRef.current = FIT_LADDER_IDX;
    zoomRef.current = 1;
    setZoomPct(100);
    refreeze();
  }, [refreeze]);

  /** Switch the fit base the ladder multiplies (s142). The multiplier resets
   *  to 100% — a carried-over step would mean a DIFFERENT absolute scale on
   *  the new base; the honest ceiling re-clamps inside refreeze's renders. */
  const setFitModeTo = useCallback(
    (mode: FitMode) => {
      if (fitModeRef.current === mode) return;
      fitModeRef.current = mode;
      setFitMode(mode);
      zoomIdxRef.current = FIT_LADDER_IDX;
      zoomRef.current = 1;
      setZoomPct(100);
      refreeze();
    },
    [refreeze],
  );

  /** Pair facing pages side by side (s143). Only the state flips here — the
   *  ready-kick effect does the layout when the rebuilt rows commit (ledger
   *  reset + scroll anchor), and every geometry path reads spreadRef, so
   *  placeholders/canvases re-fit to the halved per-page box. */
  const toggleSpread = useCallback(() => {
    const next = !spreadRef.current;
    const sc = scrollRef.current;
    const ph = holderRefs.current.get(centerRef.current)?.offsetHeight ?? 0;
    if (sc && ph > 0) {
      spreadAnchorRef.current = { top: sc.scrollTop, pageH: ph, at: Date.now() };
    }
    spreadWantedRef.current = next; // the stored INTENT (survives auto-off)
    spreadRef.current = next;
    setSpread(next);
  }, []);

  /** Rotate the whole document 90° — canvases re-render double-buffered, the
   * line model stays in unrotated space and highlight rects map through
   * rotRect(). Zoom is re-clamped to stay honest at the new aspect. */
  const rotateBy90 = useCallback(() => {
    const next = ((rotRef.current + 90) % 360) as Rot;
    rotRef.current = next;
    setRot(next);
    const max = maxZoomMult();
    let idx = zoomIdxRef.current;
    while (idx > 0 && ZOOM_LADDER[idx] > max) idx--;
    if (ZOOM_LADDER[idx] !== zoomRef.current) {
      zoomIdxRef.current = idx;
      zoomRef.current = ZOOM_LADDER[idx];
      setZoomPct(Math.round(ZOOM_LADDER[idx] * 100));
    }
    refreeze();
  }, [refreeze, maxZoomMult]);

  /** Commit the page-number input (Enter or blur). */
  const commitPageDraft = useCallback(() => {
    const n = Math.min(
      Math.max(1, numPagesRef.current),
      Math.max(1, Number.parseInt(pageDraft, 10) || 1),
    );
    setPageDraft(String(n));
    if (n !== centerRef.current) {
      setCurrentPage(n);
      scrollToPage(n);
    }
  }, [pageDraft, scrollToPage]);

  /** +/−/0 zoom shortcuts while the pages region holds focus. */
  const onScrollerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(1);
      } else if (e.key === "-") {
        e.preventDefault();
        zoomBy(-1);
      } else if (e.key === "0") {
        e.preventDefault();
        resetFit();
      }
    },
    [zoomBy, resetFit],
  );

  /** Stable holder ref — sizes the placeholder on mount without React state.
   * (React 19 ref-cleanup form: the returned fn runs on unmount.) */
  const holderRefCb = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const n = Number(el.dataset.page);
    holderRefs.current.set(n, el);
    if (!canvasesRef.current.has(n) && !el.style.width) {
      const meta = pageMetaRef.current.get(n);
      const swapped = rotRef.current % 180 === 90;
      const ar = meta
        ? swapped
          ? meta.baseW / meta.baseH
          : meta.baseH / meta.baseW
        : swapped
          ? 1 / aspectRef.current
          : aspectRef.current;
      // the host is the scroller (single) or — in spread — the page's ROW,
      // whose parent is the scroller (s143: the row's own clientHeight is one
      // page tall, NOT the scroller's fit budget)
      const parent = el.parentElement;
      const host = parent?.dataset.spreadRow ? (parent.parentElement ?? parent) : parent;
      const rawW = Math.max(240, (host?.clientWidth ?? 800) - 24);
      const availH = Math.max(160, (host?.clientHeight ?? 600) - 36);
      // spread halves the per-page width budget (s143)
      const availW = spreadRef.current ? Math.max(120, (rawW - SPREAD_GAP) / 2) : rawW;
      const w = Math.round(
        (fitModeRef.current === "page" ? Math.min(availW, availH / ar) : availW) *
          zoomRef.current,
      );
      el.style.width = `${w}px`;
      el.style.height = `${Math.round(w * ar)}px`;
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

  /** The zoom buttons' honest read-out — the base is named: fit width, fit
   *  page, or the halved spread width when pairs are on (s143). */
  const zoomTitle = `Zoom: ${zoomPct}% of ${
    fitMode === "page" ? "fit page" : spread ? "spread width" : "fit width"
  }`;

  return (
    <div
      ref={rootRef}
      data-rot={rot}
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
              onClick={() => scrollToPage(Math.max(1, currentPage - (spread ? 2 : 1)))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              <ChevronUp className="size-3.5" aria-hidden />
            </Button>
            {/* s140: the page indicator is now an input — type a page, Enter.
             * The draft only follows the tracked page when NOT being typed in. */}
            <input
              ref={pageInputRef}
              value={pageDraft}
              onChange={(e) => setPageDraft(e.target.value.replace(/\D/g, ""))}
              onBlur={commitPageDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitPageDraft();
                }
              }}
              inputMode="numeric"
              aria-label={`Page number of ${numPages}`}
              title={`Go to page (1–${numPages})`}
              className="h-7 w-9 rounded-md bg-transparent text-center font-mono text-[11px] tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <span className="pointer-events-none font-mono text-[11px] tabular-nums text-muted-foreground">
              / {numPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={() => scrollToPage(Math.min(numPages, currentPage + (spread ? 2 : 1)))}
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
              onClick={() => zoomBy(-1)}
              aria-label="Zoom out"
              disabled={zoomPct <= MIN_ZOOM_PCT}
              title={zoomTitle}
            >
              <Minus className="size-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={() => zoomBy(1)}
              aria-label="Zoom in"
              title={zoomTitle}
            >
              <Plus className="size-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={resetFit}
              aria-label="Reset zoom"
              title="Reset zoom to 100%"
              disabled={zoomPct === 100}
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </Button>
            {/* s142: the fit base the zoom ladder multiplies */}
            <div className="flex items-center" role="group" aria-label="Fit mode">
              <Button
                variant="ghost"
                size="sm"
                className={cn("h-9 w-9 px-0", fitMode === "width" && "bg-muted")}
                onClick={() => setFitModeTo("width")}
                aria-label="Fit width"
                aria-pressed={fitMode === "width"}
                title="Fit width — pages fill the pane width"
              >
                <MoveHorizontal className="size-3.5" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn("h-9 w-9 px-0", fitMode === "page" && "bg-muted")}
                onClick={() => setFitModeTo("page")}
                aria-label="Fit page"
                aria-pressed={fitMode === "page"}
                title="Fit page — the whole page stays in view"
              >
                <Frame className="size-3.5" aria-hidden />
              </Button>
            </div>
            {/* s143: two-page spread — offered only on panes wide enough */}
            {spreadAvail && (
              <Button
                variant="ghost"
                size="sm"
                className={cn("h-9 w-9 px-0", spread && "bg-muted")}
                onClick={toggleSpread}
                aria-label="Two-page spread"
                aria-pressed={spread}
                title="Two-page spread — facing pages side by side"
              >
                <BookOpen className="size-3.5" aria-hidden />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={rotateBy90}
              aria-label={`Rotate 90 degrees clockwise (now ${rot} degrees)`}
              title="Rotate 90° clockwise"
            >
              <RotateCw className="size-3.5" aria-hidden />
            </Button>
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={() => (findOpen ? closeFind() : openFindAndIndex())}
              aria-label="Find in document"
              aria-pressed={findOpen}
              aria-keyshortcuts="Control+F"
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
          <span>Loading {label}…</span>
          {/* s140: pdf.js onProgress — a 6 MB scan over a cold raw.github
           * connection is no longer an indeterminate spinner */}
          {loadProg && (
            <span className="text-xs tabular-nums" aria-live="polite">
              {loadProg.total > 0
                ? `${Math.min(100, Math.round((loadProg.loaded / loadProg.total) * 100))}% · ${prettyBytes(loadProg.loaded)} of ${prettyBytes(loadProg.total)}`
                : prettyBytes(loadProg.loaded)}
            </span>
          )}
        </div>
      )}
      {phase === "error" && (
        <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle className="size-6 text-warn" aria-hidden />
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
        <div
          ref={scrollRef}
          tabIndex={0}
          role="region"
          aria-label={`${label} — pages (arrow keys scroll, + − 0 zoom)`}
          onKeyDown={onScrollerKeyDown}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          {(() => {
            const holder = (n: number) => (
              <div
                key={n}
                data-page={n}
                ref={holderRefCb}
                role="img"
                aria-label={`Page ${n} of ${numPages}`}
                /* shrink-0 (s143): a zoomed spread row can outgrow the
                 * scroller — holders must keep their true size and overflow
                 * into the h-scrollbar, not flex-shrink under their canvas */
                className="pp-holder relative mx-auto mb-3 shrink-0 rounded bg-background shadow-sm"
              />
            );
            if (!spread) return Array.from({ length: numPages }, (_, i) => holder(i + 1));
            // s143: facing pages pair into rows [1|2][3|4]… The row is a flex
            // lane; each holder keeps mx-auto, which in a flex lane CENTERS
            // the pair when it fits and collapses to zero margin when a zoomed
            // row overflows (left-anchored, so the overflow stays reachable —
            // justify-center would clip it past the left edge forever).
            return Array.from({ length: Math.ceil(numPages / 2) }, (_, r) => (
              <div key={`row-${r + 1}`} data-spread-row={r + 1} className="flex gap-3">
                {holder(r * 2 + 1)}
                {r * 2 + 2 <= numPages && holder(r * 2 + 2)}
              </div>
            ));
          })()}
          <p className="pb-2 pt-1 text-center text-[10px] text-muted-foreground">
            End of document · {numPages} page{numPages === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </div>
  );
});
