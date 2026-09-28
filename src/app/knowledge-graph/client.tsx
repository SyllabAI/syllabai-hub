"use client";

/**
 * Knowledge Graph host chrome — per-course.
 *
 * A single data-decoupled loader build (public/kg/openhuman-course-explorer.html,
 * forked from the byte-faithful v77 renderer) renders whichever course's
 * canonicalKG JSON it is pointed at via ?course=<slug>. The JSON files are
 * generated from each course's curriculum bundle by scripts/kg_export.py and
 * contract-validated twice: exporter-side, and again in-build before the
 * renderer's makeBase() rebuild.
 *
 * The iframe reports back over postMessage (syllabai-kg:ready / :error), so
 * the counts chip shows the live data path on every course switch.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ChevronDown,
  ExternalLink,
  FlaskConical,
  Gauge,
  Maximize2,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLearnerState } from "@/lib/kg-learner-state";
import { LearnerStateDrawer } from "./state-drawer";

interface CourseLite {
  slug: string;
  label: string;
  subject: string;
  code: string;
  level: string;
}

interface KgCounts {
  nodes: number;
  edges: number;
  specPoints: number;
}

const DEFAULT_COURSE = "igcse-chemistry-19"; // the 4CH1 pilot — richest cross-checked data
const PROTO_URL = "/graph-explorer";

export function KnowledgeGraphClient({ courses }: { courses: CourseLite[] }) {
  const searchParams = useSearchParams();
  const [course, setCourse] = useState<string>(() => {
    const q = searchParams.get("course");
    return q ?? DEFAULT_COURSE;
  });
  const [ready, setReady] = useState(false);
  const [counts, setCounts] = useState<KgCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // invalid or missing deep links fall back to the pilot course
  const activeCourse = courses.some((c) => c.slug === course) ? course : DEFAULT_COURSE;

  // learner state (KG phases 1 + 2): the CORE model when the course is the
  // pilot and the learner is signed in (real attempts, real decay, real
  // review queue — ADR-029 tranche 4), else the simulated browser-local
  // derivation. `overlay` is pushed into the renderer's dormant
  // learner-state engine over postMessage, `drawer` feeds the My State /
  // History sheet, `source` keeps the provenance honest.
  const { overlay: learner, drawer, source } = useLearnerState(activeCourse);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const postLearnerOverlay = useCallback(() => {
    if (!learner || learner.bridgeError) return;
    frameRef.current?.contentWindow?.postMessage(
      {
        type: "syllabai-kg:learner",
        course: activeCourse,
        overlay: learner.entries,
      },
      "*",
    );
  }, [activeCourse, learner]);

  // (re-)post whenever the iframe (re)becomes ready or the derivation changes
  useEffect(() => {
    if (ready) postLearnerOverlay();
  }, [ready, postLearnerOverlay]);

  const switchCourse = useCallback((slug: string) => {
    setCourse(slug);
    setReady(false);
    setCounts(null);
    setError(null);
  }, []);

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

  const grouped = useMemo(() => {
    const by = new Map<string, CourseLite[]>();
    for (const c of courses) {
      const list = by.get(c.subject) ?? [];
      list.push(c);
      by.set(c.subject, list);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [courses]);

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
        {current && (
          <Badge variant="outline" className="hidden font-mono text-[10px] md:inline">
            {current.code} · {current.level}
          </Badge>
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

        {/* course switcher (one graph per course) */}
        <div className="relative">
          <select
            aria-label="Course knowledge graph"
            value={activeCourse}
            onChange={(e) => switchCourse(e.target.value)}
            className="h-8 max-w-[13rem] appearance-none rounded-md border bg-background pr-7 pl-2.5 text-xs font-medium sm:max-w-[17rem]"
          >
            {grouped.map(([subject, list]) => (
              <optgroup key={subject} label={subject}>
                {list.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label} ({c.code})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>

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
          className="size-8"
          aria-label="Open this course graph in a new tab"
        >
          <a href={iframeSrc} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
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
          One graph per course — canonicalKG JSON exported from each course&apos;s curriculum
          bundle (<span className="font-mono">scripts/kg_export.py</span>), loaded by the
          OpenHuman renderer fork. v1 ships hierarchy edges only; prerequisite/paper edges land
          when the data does. Prototype builds:{" "}
          <span className="font-mono">/graph-explorer</span>.
        </span>
      </div>
    </div>
  );
}
