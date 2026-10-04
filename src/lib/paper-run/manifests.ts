/**
 * PaperInteractivityManifest loader — SERVER-side (imports the data JSON).
 *
 * Same pattern as pastpapers-blueprints: the file holds CONFIRMED manifests
 * only (design N-4 — drafts never ship interactive fields). Client
 * components receive manifests as props from server pages; they never import
 * this module.
 */
import manifestsJson from "@/data/paper-run-manifests.json";
import type { PaperRunManifest, PaperRunManifestsFile } from "@/lib/paper-run/types";

const file = manifestsJson as unknown as PaperRunManifestsFile;

/** Manifest for a corpus `${sessionId}:${dir}`, or null when none is confirmed. */
export function paperRunManifestFor(corpusKey: string): PaperRunManifest | null {
  const m = file.papers[corpusKey];
  if (!m) return null;
  // belt-and-braces: a draft manifest never drives interactive capture
  if (m.provenance.status !== "confirmed") return null;
  return m;
}

/** corpusKeys that have a confirmed manifest (for index-page chips). */
export function paperRunKeys(): Set<string> {
  return new Set(
    Object.values(file.papers)
      .filter((m) => m.provenance.status === "confirmed")
      .map((m) => m.paper.corpusKey),
  );
}
