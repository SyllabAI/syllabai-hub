import "server-only";

/**
 * core-topics — shared server-side resolution of syllabai-core curriculum
 * identity (ADR-029 tranche 4: the 4CH1 bridge).
 *
 * Both core-wiring consumers (the CLA proxy and the question bridge) need the
 * same two joins — course code → subject rootId, and tree code → topicNodeId —
 * against core's curriculum read models. This module owns them once, with the
 * same in-process caching the CLA proxy used when it was the only consumer:
 *
 *   - subjects list: 5 min TTL (curriculum identity is deploy-immutable in
 *     practice; the TTL only exists so a redeploy of core is picked up
 *     without a hub restart); a failed refetch falls back to the stale list
 *   - rootId by code: positive hits memoized per process; MISSES ARE NEVER
 *     memoized — a Render cold start (fetch timeout/non-200) must poison
 *     neither the next request on this instance nor, via a cached null,
 *     the question bridge for its lifetime
 *   - topic tree: fetched once per root, every node indexed by code
 *
 * All fetches forward the CALLER's bearer token (these read models are
 * authenticated) and return null on any failure — callers degrade honestly,
 * they never hang.
 */
import { coreBaseUrl } from "./core-proxy";

export interface SubjectView {
  id: string;
  code: string;
  name: string;
  knowledgeNodeId: string | null;
}

export interface NodeView {
  id: string;
  code: string;
  type: string;
  title: string;
  children?: NodeView[];
}

let subjectsCache: { at: number; subjects: SubjectView[] } | null = null;
const subjectRootByCode = new Map<string, string | null>();
const topicIdByCode = new Map<string, string>(); // `${rootId}:${code}` → nodeId

/** Server-side core GET with the caller's token; null on any failure. */
export async function fetchCoreJson<T>(
  path: string,
  token: string | null,
  timeoutMs = 30_000,
): Promise<T | null> {
  const base = coreBaseUrl();
  if (!base || !token) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Course code (e.g. "4CH1") → the subject's knowledge-tree rootId. */
export async function rootIdForCourseCode(
  code: string,
  token: string | null,
): Promise<string | null> {
  const memoized = subjectRootByCode.get(code);
  if (memoized) return memoized;
  const stale = !subjectsCache || Date.now() - subjectsCache.at > 300_000;
  if (stale) {
    const subjects = await fetchCoreJson<SubjectView[]>("/api/v1/curriculum/subjects", token);
    if (subjects) subjectsCache = { at: Date.now(), subjects };
  }
  // A failed refetch deliberately falls through to the stale list: curriculum
  // identity is deploy-immutable, so a stale root beats a fabricated null.
  const hit = subjectsCache?.subjects.find((s) => s.code === code);
  const rootId = hit?.knowledgeNodeId ?? null;
  if (rootId) subjectRootByCode.set(code, rootId);
  return rootId;
}

/** Walk the core tree once per root, indexing every node by code. */
export async function topicNodeIdForCode(
  rootId: string,
  code: string,
  token: string | null,
): Promise<string | null> {
  const key = `${rootId}:${code}`;
  if (topicIdByCode.has(key)) return topicIdByCode.get(key) ?? null;
  const tree = await fetchCoreJson<NodeView>(
    `/api/v1/knowledge/nodes/${rootId}/tree?includeMisconceptions=false`,
    token,
  );
  if (!tree) return null;
  const walk = (node: NodeView) => {
    topicIdByCode.set(`${rootId}:${node.code}`, node.id);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return topicIdByCode.get(key) ?? null;
}
