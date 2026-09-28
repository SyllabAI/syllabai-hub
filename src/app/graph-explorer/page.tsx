import type { Metadata } from "next";
import { GraphExplorerClient } from "./client";

export const metadata: Metadata = {
  title: "Graph Explorer — SyllabAI Hub",
  description:
    "The OpenHuman interaction-grammar knowledge-graph visualizer (v75: edge explainer, lasso selection, minimap) hosted byte-faithful for the 4CH1 pilot, with a build switcher and the decoupled canonicalKG data artifact.",
};

/**
 * Graph Explorer — Phase 1 integration of the operator's OpenHuman visualizer
 * prototype (docs/KNOWLEDGE_GRAPH_VISUALIZER_INTEGRATION.md).
 *
 * The builds are self-contained HTML files served byte-faithful from
 * /public/kg/ — this page is only the host chrome (build switcher, live data
 * stats from the decoupled artifact, fullscreen/new-tab). The renderer is
 * never modified; the contract boundary (GRAPH_CONTRACT v1.0) stays intact.
 */
export default function GraphExplorerPage() {
  return <GraphExplorerClient />;
}
