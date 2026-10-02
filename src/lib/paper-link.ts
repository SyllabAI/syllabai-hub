import "server-only";

/**
 * The paper-PDF matcher (F-022 tranche 2, hub side of core PR #66).
 *
 * Core's citation header now carries the exam-paper identity behind a QP/MS
 * row ({paperCode, sessionLabel, role}). This module maps that identity onto
 * THIS repo's committed corpus index (lib/pastpapers-corpus) — the same index
 * the /courses/.../past-papers viewer is addressed by — and returns the
 * viewer URL for the real paper PDF, or null when nothing matches honestly:
 *
 *  - the session vocabulary is parser-controlled free text ("June 2025",
 *    "Summer 2013", "January 2012"); the mapping to corpus session ids
 *    ("2025-06") is tolerant and fails closed
 *  - the corpus dirs are "<SPEC>-<CODE>" ("4CH1-1C", "WCH11-01"); the code
 *    match is suffix-based and tolerates the "spec/paper" import convention
 *  - the same paper code can exist under more than one spec folder (4CH1 vs
 *    4SD0 share "1C") — a course hint scopes the lookup; without one, more
 *    than one DISTINCT corpus file is ambiguity, and ambiguity is a null
 *
 * Server-only: the index JSON is a build-time module this repo deliberately
 * keeps out of client bundles (the client gets the resolved URL, nothing else).
 */
import { corpusPapersForCourse, type CorpusPaperEntry } from "@/lib/pastpapers-corpus";
import { listCourses } from "@/lib/courses";

export interface PaperLinkRequest {
  paperCode: string;
  sessionLabel: string | null;
  role: "QP" | "MS";
  /** the cited document page — the viewer lands there (1-based, optional) */
  page?: number;
}

const MONTH_WORDS: Record<string, string> = {
  january: "01",
  jan: "01",
  february: "02",
  feb: "02",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  may: "06",
  june: "06",
  jun: "06",
  summer: "06",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  october: "11",
  oct: "11",
  november: "11",
  nov: "11",
  winter: "11",
  autumn: "11",
  december: "12",
  dec: "12",
};

/** "June 2025" / "Summer 2013" / "2022-01" / "Specimen" → the corpus session id. */
export function sessionIdFromLabel(label: string | null): string | null {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  if (!l) return null;
  if (l === "specimen") return "specimen";
  const shaped = /^((?:19|20)\d{2})-(\d{2})$/.exec(l);
  if (shaped) return shaped[0];
  const year = /\b((?:19|20)\d{2})\b/.exec(l)?.[1];
  if (!year) return null;
  const month = Object.keys(MONTH_WORDS).find((m) =>
    new RegExp(`\\b${m}\\b`).test(l),
  );
  return month ? `${year}-${MONTH_WORDS[month]}` : null;
}

/** lowercase alphanumerics — "4CH1/1C" → "4ch11c", "4CH1-1C" → "4ch11c" */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
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
  if (!sessionId) return null;

  // the code candidates: the whole normalized code, plus its last "/"-segment
  // ("4CH1/1C" → "4ch11c" AND "1c") — corpus dirs suffix-match either form
  const whole = norm(req.paperCode);
  const tail = norm(req.paperCode.split("/").pop() ?? "");
  const codes = [whole, tail].filter((c) => c.length >= 2);
  if (codes.length === 0) return null;

  const slugs = courseHint
    ? [courseHint]
    : (await listCourses().catch(() => [])).map((c) => c.slug);

  const unique = new Map<string, { slug: string; entry: CorpusPaperEntry }>();
  for (const slug of slugs) {
    for (const entry of corpusPapersForCourse(slug)) {
      if (entry.sessionId !== sessionId) continue;
      const dir = norm(entry.dir);
      if (!codes.some((c) => dir.endsWith(c))) continue;
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
