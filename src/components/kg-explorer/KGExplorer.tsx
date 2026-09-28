"use client";
/**
 * KGExplorer — the React wrapper around KGExplorerEngine (the v75 port).
 *
 * The wrapper owns the lifecycle only: mount the engine into a container div,
 * feed it the host contract, and destroy it on unmount. All rendering and
 * interaction live in the engine (imperative SVG, like the reference) —
 * re-rendering hundreds of nodes through React per simulation frame would be
 * the wrong tool. Data changes flow through `setHost` (full rebuild, camera
 * refit) — the read models behind these graphs change on login/subject
 * switch/attempt submit, not per keystroke.
 */
import { useEffect, useRef } from "react";
import { KGExplorerEngine, type KGXOptions } from "./engine";
import type { KGXHost } from "./types";

export function KGExplorer({
  host,
  height,
  title,
  subtitle,
  className,
}: {
  host: KGXHost;
  height?: number;
  title?: string;
  subtitle?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<KGExplorerEngine | null>(null);
  const hostRef = useRef(host);

  useEffect(() => {
    if (!containerRef.current) return;
    const options: KGXOptions = { height, title, subtitle };
    const engine = new KGExplorerEngine(containerRef.current, hostRef.current, options);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // engine constructed once; options captured at mount (height/title are
    // stable per host surface — a changing graph flows through setHost below)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    hostRef.current = host;
    engineRef.current?.setHost(host);
  }, [host]);

  return <div ref={containerRef} className={className} aria-label={title ?? "Knowledge graph explorer"} />;
}
