import "server-only";

/**
 * The paper-PDF matcher (F-022 tranche 2, hub side of core PR #66).
 *
 * Maps core's citation-header paper identity ({paperCode, sessionLabel,
 * role}) onto THIS repo's committed corpus index (lib/pastpapers-corpus) —
 * the same index the /courses/.../past-papers viewer is addressed by — and
 * returns the viewer URL for the real paper PDF, or null when nothing
 * matches honestly.
 *
 * The value vocabulary and its 2026-10-02 production audit live in
 * lib/paper-link-shared.ts. The failure posture, twice over:
 *
 *  - core can hand us a paper whose paperCode/sessionLabel are honestly
 *    NULL (the parser never guesses printed identity) — those resolve to
 *    null here, before any corpus work
 *  - the same paper code can exist under more than one spec folder (4CH1 vs
 *    4SD0 share "1C") — a course hint scopes the lookup; without one, more
 *    than one DISTINCT corpus file is ambiguity, and ambiguity is a null
 *
 * Server-only: the index JSON is a build-time module this repo deliberately
 * keeps out of client bundles (the client gets the resolved URL, nothing else).
 */
import { corpusPapersForCourse, type CorpusPaperEntry } from "@/lib/pastpapers-corpus";
import { listCourses } from "@/lib/courses";
import {
  normIdentity,
  sessionIdFromLabel,
  wholeCodeMatchesDir,
} from "@/lib/paper-link-shared";

export interface PaperLinkRequest {
  paperCode: string | null;
  sessionLabel: string | null;
  role: "QP" | "MS";
  /** the cited document page — the viewer lands there (1-based, optional) */
  page?: number;
}

/**
 * The corpus viewer URL for a cited paper, or null when the match is not
 * unique. With a course hint (the ask's own slug, threaded through the
 * citation URL) the lookup is scoped to that course's corpus; without one
 * every registered course is tried, and only a single distinct corpus FILE
 * resolves — two different files matching the same code+session is exactly
 * the ambiguity this matcher must refuse.
 */
export async function paperViewerLink(
  req: PaperLinkRequest,
  courseHint?: string | null,
): Promise<string | null> {
  const sessionId = sessionIdFromLabel(req.sessionLabel);
  const code = normIdentity(req.paperCode ?? "");
  // both identity halves are load-bearing: the whole-form code ("SPEC/CODE",
  // the audited production form) and the session id. Either missing = null.
  if (code.length < 2 || !sessionId) return null;

  const slugs = courseHint
    ? [courseHint]
    : (await listCourses().catch(() => [])).map((c) => c.slug);

  const unique = new Map<string, { slug: string; entry: CorpusPaperEntry }>();
  for (const slug of slugs) {
    for (const entry of corpusPapersForCourse(slug)) {
      if (entry.sessionId !== sessionId) continue;
      if (!wholeCodeMatchesDir(req.paperCode, entry.dir)) continue;
      // one corpus FILE (spec/session/dir) can surface under two courses —
      // the same paper, not an ambiguity; key on the file identity
      unique.set(`${entry.qpPath || entry.msPath}`, { slug, entry });
    }
  }
  if (unique.size !== 1) return null;

  const { slug, entry } = unique.values().next().value!;
  const doc = req.role === "MS" ? "ms" : "qp";
  const page = req.page && req.page >= 1 ? `&page=${req.page}` : "";
  return `/courses/${encodeURIComponent(slug)}/past-papers/view/${entry.sessionId}/${entry.dir}?doc=${doc}${page}`;
}
