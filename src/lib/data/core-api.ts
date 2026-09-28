/**
 * CoreApiProvider — passthrough to the authoritative syllabai-core REST API.
 *
 * syllabai-core remains the production backend (brief §7). This provider lets
 * an experiment consume REAL production read models (subjects, knowledge
 * tree, learner state, questions …) through the same DTO shapes the demo
 * contracts mirror. Nothing here mutates canonical state — read-only lanes
 * only; writes stay in syllabai-web.
 *
 * Activation: SYLLABAI_CORE_BASE_URL must be set (e.g.
 * https://syllabai-core.onrender.com). Optionally SYLLABAI_CORE_TOKEN for a
 * pilot JWT. The base URL is resolved SERVER-SIDE ONLY (no NEXT_PUBLIC_*).
 */
import type { DemoDataProvider } from "./types";
import { mockProvider } from "./mock";

export const isCoreApiConfigured = () => Boolean(process.env.SYLLABAI_CORE_BASE_URL);

export function coreBaseUrl(): string | null {
  const raw = process.env.SYLLABAI_CORE_BASE_URL;
  if (!raw) return null;
  return raw.replace(/\/$/, "").replace(/\/api\/v1$/, "");
}

/** server-side fetch against syllabai-core; returns null on any failure */
export async function coreFetch<T>(path: string): Promise<T | null> {
  const base = coreBaseUrl();
  if (!base) return null;
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = process.env.SYLLABAI_CORE_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${base}${path}`, {
      headers,
      next: { revalidate: 120 },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * The core-API provider is intentionally PARTIAL: surfaces the backend cannot
 * serve in a given deployment (or where auth is not provisioned) degrade to
 * the bundled corpus with an explicit banner — the demo must stay usable, and
 * the UI must stay honest about where each read model came from.
 */
export function coreApiProvider(): DemoDataProvider {
  const fallback = mockProvider();
  return {
    id: "core-api",
    displayName: "syllabai-core API (authoritative)",
    detail: `${coreBaseUrl() ?? ""} — unprovisioned surfaces fall back to the bundled corpus`,
    manifest: fallback.manifest,
    curriculum: fallback.curriculum,
    conceptGraph: fallback.conceptGraph,

    // live lanes (degrade gracefully)
    // revisionNotes: the former "live" wrapper fetched
    // /api/v1/learners/me/revision-notes and then returned the bundled
    // fallback on BOTH branches — a no-op wrapper whose only effect was a
    // runtime core round trip (20s timeout) on every render of pages that
    // served identical output regardless (measured tranche 4.12). Removed;
    // when core grows a real per-learner notes read model it returns here
    // with an honest fallback contract like the other live lanes.
    revisionNotes: fallback.revisionNotes,
    examQuestionTopics: fallback.examQuestionTopics,
    flashcards: fallback.flashcards,
    simLearnerState: fallback.simLearnerState,
  };
}
