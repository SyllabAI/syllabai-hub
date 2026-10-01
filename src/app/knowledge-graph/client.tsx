"use client";

/**
 * Knowledge Graph host chrome — single-course scoped (ADR-029 tranche 4.1).
 *
 * A data-decoupled loader build (public/kg/openhuman-course-explorer.html,
 * forked from the byte-faithful v77 renderer) renders ONE course's canonicalKG
 * JSON — the course this page was opened for (?course=<slug>, deep-linked from
 * that course's page). Inside a course's graph there is deliberately NO course
 * switcher: the graph is a property of the subject you selected, not a
 * browsing surface (operator decision, trace 1a0e8568eb6bb545).
 *
 * The entry points that arrive WITHOUT a course (top-nav, home card, stale
 * citations) never silently render the pilot's graph — with 49 published
 * graphs that read as "every course shows chemistry" (operator report,
 * trace 1a0f88ea8a493bad). They land on an honest picker instead, and an
 * unknown slug says so instead of falling back. The picker is the ENTRY state
 * only; the graph view itself stays switcher-free per the operator decision.
 *
 * The iframe reports back over postMessage (syllabai-kg:ready / :error), so
 * the counts chip shows the live data path. Learner state is pushed IN over
 * postMessage (syllabai-kg:learner) — always, once resolved, so the renderer's
 * embedded sample map can never resurface; the payload carries a provenance
 * flag so the renderer's legend/peek text stays honest (measured vs simulated
 * vs unavailable).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ExternalLink,
  FlaskConical,
  Gauge,
  Maximize2,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLearnerState } from "@/lib/kg-learner-state";
import { PILOT_COURSE_SLUG } from "@/lib/attempt-bridge";
import { LearnerStateDrawer } from "./state-drawer";

interface CourseLite {
  slug: string;
  label: string;
  subject: string;
  code: string;
  level: string;
  /** true when public/kg/data/<slug>.json exists — the picker lists exactly
   *  what will load, nothing aspirational (server-computed in page.tsx) */
  hasGraph?: boolean;
}

interface KgCounts {
  nodes: number;
  edges: number;
  specPoints: number;
}

const DEFAULT_COURSE = PILOT_COURSE_SLUG; // the 4CH1 pilot — richest cross-checked data
const PROTO_URL = "/graph-explorer";

/**
 * Entry: resolve the course from the URL. A valid ?course=<slug> renders the
 * single-course chrome (key={course} remounts everything on change); a
 * missing or unknown course renders the landing picker — never another
 * course's graph.
 */
export function KnowledgeGraphClient({ courses }: { courses: CourseLite[] }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get("course");
  const course =
    requested && courses.some((c) => c.slug === requested) ? requested : null;
  if (!course) {
    return <CourseGraphLanding courses={courses} requested={requested} />;
  }
  return <KnowledgeGraphCourse key={course} course={course} courses={courses} />;
}

/**
 * The honest entry state: every published graph, grouped by qualification
 * level. The registry is the single source of course identity; hasGraph
 * (server fs check) is the single source of what actually loads.
 */
function CourseGraphLanding({
  courses,
  requested,
}: {
  courses: CourseLite[];
  requested: string | null;
}) {
  const graphed = courses
    .filter((c) => c.hasGraph)
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.label.localeCompare(b.label));
  const byLevel = new Map<string, CourseLite[]>();
  for (const c of graphed) {
    const arr = byLevel.get(c.level) ?? [];
    arr.push(c);
    byLevel.set(c.level, arr);
  }
  const levels = [...byLevel.keys()].sort((a, b) =>
    a === b ? 0 : a === "IGCSE" ? -1 : b === "IGCSE" ? 1 : a.localeCompare(b),
  );
  return (
    <div className="flex min-h-[calc(100dvh-7.5rem)] flex-col overflow-y-auto bg-background px-6 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center gap-2">
          <Network className="size-4 text-primary" aria-hidden />
          <h1 className="text-sm font-semibold tracking-tight">Knowledge graphs</h1>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          One specification graph per course, exported from its curriculum bundle
          (scripts/kg_export.py). Open a graph here or from that course&apos;s page.
        </p>
        {requested && (
          <Alert className="mt-4">
            <AlertTitle>No graph for &ldquo;{requested}&rdquo;</AlertTitle>
            <AlertDescription>
              That course is not in the registry (check for a typo) — pick one of
              the published graphs below.
            </AlertDescription>
          </Alert>
        )}
        {levels.map((level) => (
          <section key={level} className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {level}
            </h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {byLevel.get(level)!.map((c) => (
                <Link
                  key={c.slug}
                  href={`/knowledge-graph?course=${encodeURIComponent(c.slug)}`}
                  className="group flex items-center justify-between gap-2 rounded-md border px-3 py-2.5 transition-colors hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {c.label}
                    </span>
                    {/* the slug disambiguates same-subject variants (Accounting
                        paper variants, Maths Pure 1-4, modular units) without
                        inventing display names the registry does not carry */}
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {c.slug}
                    </span>
                  </span>
                  <Badge
                    variant="outline"
                    className="shrink-0 font-mono text-[10px]"
                  >
                    {c.code}
                  </Badge>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function KnowledgeGraphCourse({
  course,
  courses,
}: {
  course: string;
  courses: CourseLite[];
}) {
  const [ready, setReady] = useState(false);
  const [counts, setCounts] = useState<KgCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // the course arrives pre-validated by the entry (registry match) — the
  // invalid-or-missing case never reaches this component
  const activeCourse = course;

  // learner state (KG phases 1 + 2): the CORE model when the course is the
  // pilot and the learner is signed in (real attempts, real decay, real
  // review queue — ADR-029 tranche 4), else the simulated browser-local
  // derivation. `overlay` is pushed into the renderer's dormant
  // learner-state engine over postMessage, `drawer` feeds the My State /
  // History sheet, `source` keeps the provenance honest.
  const { overlay: learner, drawer, source } = useLearnerState(activeCourse);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ALWAYS post once resolved — including the bridge-error case (empty
  // entries): the renderer's embedded sample map must never resurface, and
  // the provenance flag keeps its legend and node-peek text honest.
  const postLearnerOverlay = useCallback(() => {
    if (!learner) return; // still loading — the renderer defaults to no state
    frameRef.current?.contentWindow?.postMessage(
      {
        type: "syllabai-kg:learner",
        course: activeCourse,
        overlay: learner.entries, // {} on bridge error — honest emptiness
        provenance: learner.bridgeError ? "unavailable" : source,
      },
      "*",
    );
  }, [activeCourse, learner, source]);

  // (re-)post whenever the iframe (re)becomes ready or the derivation changes
  useEffect(() => {
    if (ready) postLearnerOverlay();
  }, [ready, postLearnerOverlay]);

  // keep the address bar deep-linkable (external system, no state here)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeCourse === DEFAULT_COURSE) url.searchParams.delete("course");
    else url.searchParams.set("course", activeCourse);
    window.history.replaceState(null, "", url);
  }, [activeCourse]);

  // loader-build handshake: one stable listener; the iframe re-posts on every
  // course switch (key={activeCourse} remounts it), so state updates only
  // ever happen from message events — never synchronously in an effect.
  // If the loader beats us to it (warm cache), the host-ready ping below
  // makes it re-post its status.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; counts?: KgCounts; message?: string };
      if (d?.type === "syllabai-kg:ready" && d.counts) {
        setCounts(d.counts);
        setReady(true);
        setError(null);
      } else if (d?.type === "syllabai-kg:error") {
        setError(d.message ?? "unknown loader error");
      }
    };
    window.addEventListener("message", onMessage);
    // ask a possibly-already-finished loader to re-post its status
    frameRef.current?.contentWindow?.postMessage(
      { type: "syllabai-kg:host-ready" },
      "*",
    );
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const onFrameLoad = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "syllabai-kg:host-ready" },
      "*",
    );
  }, []);

  const current = courses.find((c) => c.slug === activeCourse);
  const iframeSrc = `/kg/openhuman-course-explorer.html?course=${encodeURIComponent(activeCourse)}`;

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenEnabled) {
      window.open(iframeSrc, "_blank", "noopener");
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else if (shellRef.current) {
      void shellRef.current.requestFullscreen().catch(() => {});
    }
  }, [iframeSrc]);

  return (
    <div ref={shellRef} className="flex flex-col bg-background">
      {/* toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:gap-3 sm:px-4">
        <Network className="size-4 shrink-0 text-primary" aria-hidden />
        <h1 className="truncate text-sm font-semibold tracking-tight">Knowledge Graph</h1>
        {/* the course this graph belongs to — a label, not a switcher: the
            graph shows only the selected subject (no browsing other courses) */}
        {current && (
          <>
            <Badge variant="outline" className="hidden max-w-[15rem] truncate font-medium sm:inline-flex">
              {current.label}
            </Badge>
            <Badge variant="outline" className="hidden font-mono text-[10px] md:inline">
              {current.code}
            </Badge>
          </>
        )}
        {counts && (
          <Badge
            variant="outline"
            className="hidden font-mono text-[10px] text-success xl:inline"
          >
            {counts.nodes} nodes · {counts.edges} edges · {counts.specPoints} spec points
          </Badge>
        )}

        {/* learner state chip — opens the My State / History drawer (the
            phase-1 legend popover folded into the drawer, one derivation) */}
        {learner && !learner.bridgeError && learner.stats.total > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2 font-mono text-[10px] text-muted-foreground"
            aria-haspopup="dialog"
            onClick={() => setDrawerOpen(true)}
          >
            <Gauge className="size-3.5 shrink-0" aria-hidden />
            <span className="tabular-nums">{learner.stats.measured}/{learner.stats.total}</span>
            <span className="hidden lg:inline">
              {source === "core"
                ? learner.stats.measured > 0
                  ? "measured · live · my state"
                  : "live · my state"
                : learner.stats.measured > 0
                  ? "measured · my state"
                  : "no evidence · my state"}
            </span>
          </Button>
        )}

        <span className="ml-auto" />

        {/* prototype lab cross-link */}
        <Button
          asChild
          variant="outline"
          size="sm"
          className="hidden h-8 text-xs lg:inline-flex"
        >
          <Link href={PROTO_URL}>
            <FlaskConical className="size-3.5" aria-hidden />
            Prototype lab
          </Link>
        </Button>

        <Button
          asChild
          variant="outline"
          size="icon"
          aria-label="Open this course graph in a new tab"
        >
          <a href={iframeSrc} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Toggle fullscreen"
          onClick={toggleFullscreen}
        >
          <Maximize2 className="size-3.5" aria-hidden />
        </Button>
      </div>

      {/* My State / History drawer (KG phase 2) — same derivation as the graph */}
      <LearnerStateDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        courseLabel={current?.label ?? "this course"}
        course={activeCourse}
        drawer={drawer}
        source={source}
      />

      {/* explorer canvas */}
      <div className="relative" style={{ height: "calc(100dvh - 3.5rem - 3rem)" }}>
        {(!ready || error) && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center text-xs text-muted-foreground">
            {error ? (
              <Alert variant="destructive" className="max-w-md text-left">
                <AlertTitle>Graph data failed to load</AlertTitle>
                <AlertDescription className="font-mono text-[11px]">
                  {error}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div
                  className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-primary"
                  role="status"
                  aria-label="Loading knowledge graph"
                />
                <span>
                  loading {current?.label ?? "course"} knowledge graph…
                </span>
              </>
            )}
          </div>
        )}
        <iframe
          key={activeCourse}
          ref={frameRef}
          src={iframeSrc}
          onLoad={onFrameLoad}
          title={`Knowledge Graph — ${current?.label ?? "course"}`}
          className={cn(
            "absolute inset-0 h-full w-full border-0 transition-opacity duration-300",
            ready && !error ? "opacity-100" : "opacity-0",
          )}
          allow="fullscreen"
        />
      </div>

      {/* honest data-path footnote */}
      <div className="flex items-center gap-1.5 border-t px-4 py-1.5 text-[10px] text-muted-foreground">
        <Network className="size-3 shrink-0" aria-hidden />
        <span>
          {current?.label ?? "This course"}&apos;s specification graph — canonicalKG JSON
          exported from its curriculum bundle (<span className="font-mono">scripts/kg_export.py</span>),
          loaded by the OpenHuman renderer fork. One graph per course: open it from that
          course&apos;s page. Prerequisite links come from the operator-validated T-C11
          concept-dependency store (projected through concept anchors) plus an
          inferred prototype tier — the provenance panel labels each tier; edge
          types toggle in the relation menu. Prototype builds:{" "}
          <span className="font-mono">/graph-explorer</span>.
        </span>
      </div>
    </div>
  );
}
