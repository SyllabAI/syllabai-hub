"use client";

/**
 * Graph Explorer host chrome.
 *
 * Phase 1 of the visualizer integration: the OpenHuman builds are hosted
 * byte-faithful in an iframe; everything around them is host state. No
 * build file is ever patched — swapping or upgrading a build is a file drop
 * plus one entry in BUILDS.
 *
 * The stats chip is fetched from the decoupled data artifact
 * (/kg/data/canonicalKG.edexcel-chemistry-4ch1.json) rather than hardcoded,
 * so the data path is exercised on every load.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Download,
  ExternalLink,
  Info,
  Maximize2,
  Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils";

type BuildKey = "v75" | "v76" | "v77";

interface BuildInfo {
  file: string;
  label: string;
  blurb: string;
}

const BUILDS: Record<BuildKey, BuildInfo> = {
  v75: {
    file: "/kg/v75-explainer-lasso-minimap.html",
    label: "v75",
    blurb: "default — edge explainer + lasso + minimap",
  },
  v76: {
    file: "/kg/v76-audit-fixes.html",
    label: "v76",
    blurb: "audit fixes",
  },
  v77: {
    file: "/kg/v77-regression-fixes.html",
    label: "v77",
    blurb: "regression fixes (latest)",
  },
};

const BUILD_KEYS: BuildKey[] = ["v75", "v76", "v77"];

const DATA_URL = "/kg/data/canonicalKG.edexcel-chemistry-4ch1.json";
const PLAN_URL =
  "https://github.com/SyllabAI/syllabai-hub/blob/main/docs/KNOWLEDGE_GRAPH_VISUALIZER_INTEGRATION.md";
const SOURCE_URL =
  "https://github.com/nawaf-al-hussain/FileUpload/tree/main/syllabai-openhuman-edexcel-chemistry-kg";

interface KgCounts {
  nodes: number;
  edges: number;
  specPoints: number;
}

export function GraphExplorerClient() {
  const [build, setBuild] = useState<BuildKey>("v75");
  const [loaded, setLoaded] = useState(false);
  const [counts, setCounts] = useState<KgCounts | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // a warm-cached build can finish loading before React attaches onLoad —
  // reconcile once after paint so the loading overlay can never stick
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (frameRef.current?.contentWindow?.document?.readyState === "complete") {
        setLoaded(true);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json?.meta?.counts) return;
        setCounts({
          nodes: json.meta.counts.nodes,
          edges: json.meta.counts.edges,
          specPoints: json.meta.counts.byType?.SpecificationPoint ?? 0,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    // Fullscreen can be blocked by embed sandboxes — fall back to a new tab.
    if (!document.fullscreenEnabled) {
      window.open(BUILDS[build].file, "_blank", "noopener");
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else if (shellRef.current) {
      void shellRef.current.requestFullscreen().catch(() => {});
    }
  }, [build]);

  const switchBuild = useCallback((key: BuildKey) => {
    setBuild(key);
    setLoaded(false);
  }, []);

  return (
    <div ref={shellRef} className="flex flex-col bg-background">
      {/* toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:gap-3 sm:px-4">
        <Waypoints className="size-4 shrink-0 text-primary" aria-hidden />
        <h1 className="truncate text-sm font-semibold tracking-tight">
          Graph Explorer
        </h1>
        <Badge variant="outline" className="hidden font-mono text-[10px] md:inline">
          OpenHuman build · prototype
        </Badge>
        <Badge variant="outline" className="hidden font-mono text-[10px] lg:inline">
          Edexcel Int. GCSE Chemistry · 4CH1
        </Badge>
        {counts && (
          <Badge
            variant="outline"
            className="hidden font-mono text-[10px] text-success xl:inline"
          >
            {counts.nodes} nodes · {counts.edges} edges · {counts.specPoints} spec points
          </Badge>
        )}

        <span className="ml-auto" />

        {/* build switcher */}
        <div
          role="group"
          aria-label="Visualizer build"
          className="flex items-center overflow-hidden rounded-md border"
        >
          {BUILD_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={build === key}
              onClick={() => switchBuild(key)}
              className={cn(
                "px-2.5 py-1 font-mono text-[11px] transition-colors",
                build === key
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {BUILDS[key].label}
            </button>
          ))}
        </div>

        {/* about */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="size-8" aria-label="About this explorer">
              <Info className="size-3.5" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(92vw,26rem)] text-xs leading-relaxed">
            <p className="mb-1 text-sm font-semibold">What is this?</p>
            <p className="mb-2 text-muted-foreground">
              The OpenHuman knowledge-graph visualizer, hosted byte-faithful from{" "}
              <span className="font-mono">public/kg/</span>. Builds are unmodified copies of the
              operator&apos;s prototype (own hand-curated 4CH1 dataset, GRAPH_CONTRACT v1.0); the
              stats chip is served from the decoupled{" "}
              <a href={DATA_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                canonicalKG artifact
              </a>
              . This page is the prototype build lab — the product surface is the{" "}
              <Link href="/knowledge-graph" className="underline underline-offset-2">
                per-course Knowledge Graph
              </Link>
              , where every course explores its own exported graph in a data-decoupled fork of
              v77.
            </p>
            <p className="mb-1 text-sm font-semibold">Try</p>
            <ul className="mb-2 list-disc space-y-0.5 pl-4 text-muted-foreground">
              <li>Click a node → explore menu, expand neighborhood, learn / practice / path / tutor actions</li>
              <li>Shift+click (or M) to multi-select → two-node compare panel</li>
              <li>Click an edge → relationship explainer + provenance drawer</li>
              <li>Shift+drag on canvas → lasso selection</li>
              <li>Bottom-right minimap → drag viewport, click dots to inspect</li>
              <li>Saved graph views persist locally (camera + filters + pins)</li>
            </ul>
            <p className="mb-1 text-sm font-semibold">Builds</p>
            <ul className="mb-2 space-y-0.5 text-muted-foreground">
              {BUILD_KEYS.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => switchBuild(key)}
                    className="font-mono underline decoration-dotted underline-offset-2"
                  >
                    {BUILDS[key].label}
                  </button>
                  <span> — {BUILDS[key].blurb}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <Button asChild size="sm" variant="secondary" className="h-7 text-xs">
                <Link href={PLAN_URL} target="_blank">
                  Integration plan
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                <Link href={SOURCE_URL} target="_blank">
                  Source builds
                </Link>
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Button asChild variant="outline" size="icon" className="size-8" aria-label="Open build full screen in a new tab">
          <a href={BUILDS[build].file} target="_blank" rel="noreferrer">
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

      {/* explorer canvas */}
      <div className="relative" style={{ height: "calc(100dvh - 3.5rem - 3rem)" }}>
        {!loaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background text-xs text-muted-foreground">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-primary"
              role="status"
              aria-label="Loading knowledge graph"
            />
            <span>loading knowledge graph · {BUILDS[build].label} …</span>
          </div>
        )}
        <iframe
          key={build}
          ref={frameRef}
          src={BUILDS[build].file}
          title={`Knowledge Graph Explorer — Edexcel International GCSE Chemistry (${BUILDS[build].label})`}
          onLoad={() => setLoaded(true)}
          className={cn(
            "absolute inset-0 h-full w-full border-0 transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
          allow="fullscreen"
        />
      </div>

      {/* honest data-path footnote (host-level only, out of the canvas) */}
      <div className="flex items-center gap-1.5 border-t px-4 py-1.5 text-[10px] text-muted-foreground">
        <Download className="size-3" aria-hidden />
        <span>
          Prototype build lab — byte-faithful v75/v76/v77 with the operator&apos;s hand-curated
          4CH1 dataset. Per-course graphs (all 49 courses, exported curriculum truth) live at{" "}
          <span className="font-mono">/knowledge-graph</span>. Integration plan:{" "}
          <span className="font-mono">docs/KNOWLEDGE_GRAPH_VISUALIZER_INTEGRATION.md</span>.
        </span>
      </div>
    </div>
  );
}
