import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";

import { listCourses } from "@/lib/courses";

/**
 * Citation mapping — core DTOs (TutorCitation/ClaCitation:
 * {index,label,sourceType,documentId,page,nodeId,deepLink}) → the hub's
 * client contract (contracts.ts TutorCitation:
 * {index,label,kind,ref,specPointCode,url,score}).
 *
 * url — the per-surface bridge (L5 follow-up, post core #59): core now emits
 * learner-accessible deep links, but they target core REST paths, and a plain
 * <a> navigation can never carry the learner's Bearer token — so a link is
 * only emitted when the hub has an in-app surface that can actually open it:
 *
 * - document-backed (/api/v1/content/documents/{row}?page=N) → the in-app
 *   source reader (/sources/{row}?page=N&course=<slug>, F-022), which fetches
 *   the same core route with the learner's token and renders the verbatim
 *   page text; core enforces the corpus law server-side, so the reader
 *   inherits the exact validation gates retrieval serves from. The course
 *   hint (when the ask's own context resolves to a registered course) lets
 *   the reader's paper-PDF matcher disambiguate the corpus entry — the same
 *   paper code can exist under more than one spec folder (4CH1 vs 4SD0)
 * - KNOWLEDGE_NODE (/api/v1/knowledge/nodes/{id}) → the course's knowledge
 *   graph explorer (/knowledge-graph?course=<slug>), when the ask's own
 *   course context resolves to a course that actually ships a graph bundle
 *   — otherwise the honest null.
 */
export interface CoreCitation {
  index?: number;
  label?: string | null;
  sourceType?: string | null;
  documentId?: string | null;
  page?: number | null;
  nodeId?: string | null;
  deepLink?: string | null;
}

/** Per-ask surface context: what this ask's own context makes linkable. */
export interface CitationSurface {
  /** the course's in-app graph explorer href, when that course has a graph */
  kgHref?: string | null;
  /** the ask's course slug (no graph gate — the paper-PDF matcher uses it
   *  purely to scope its corpus lookup) */
  courseSlug?: string | null;
}

const KINDS = new Set(["REVISION_NOTE", "QUESTION_PART", "SPEC_POINT", "CONCEPT"]);

export function mapCitation(c: CoreCitation, i: number, surface?: CitationSurface) {
  const kind =
    typeof c.sourceType === "string" && KINDS.has(c.sourceType) ? c.sourceType : "SPEC_POINT";
  return {
    index: typeof c.index === "number" ? c.index : i + 1,
    label: typeof c.label === "string" && c.label.length > 0 ? c.label : "Source",
    kind: kind as "REVISION_NOTE" | "QUESTION_PART" | "SPEC_POINT" | "CONCEPT",
    ref: c.documentId ?? c.nodeId ?? c.label ?? "core",
    specPointCode: null,
    url: urlFor(c.deepLink, surface),
    score: 1,
  };
}

function urlFor(deepLink: string | null | undefined, surface?: CitationSurface): string | null {
  if (!deepLink) return null;
  // the translation keys on the LINK (the wire truth), not the sourceType enum
  if (deepLink.startsWith("/api/v1/content/documents/")) {
    return sourceHref(deepLink, surface?.courseSlug);
  }
  if (deepLink.startsWith("/api/v1/knowledge/nodes/")) {
    return surface?.kgHref ?? null;
  }
  return null;
}

/**
 * /api/v1/content/documents/{row}?page=N → /sources/{row}?page=N[&course=slug]
 * — the F-022 reader fetches the same core route with the learner's token;
 * the course hint scopes its paper-PDF corpus match. A link that does not
 * match the expected shape stays an honest null — never a fabricated path.
 */
function sourceHref(
  deepLink: string,
  courseSlug: string | null | undefined,
): string | null {
  const match = /^\/api\/v1\/content\/documents\/([^/?]+)(\?page=(\d+))?$/.exec(deepLink);
  if (!match) return null;
  const params = new URLSearchParams();
  if (match[3]) params.set("page", match[3]);
  if (courseSlug) params.set("course", courseSlug);
  const qs = params.toString();
  return `/sources/${match[1]}${qs ? `?${qs}` : ""}`;
}

/**
 * The ask's citation surface for its own course context — the tutor's
 * courseRef (the registry's curriculumCode) or the CLA's course slug.
 * courseSlug is present for every registered course (the paper-PDF matcher's
 * scope hint); kgHref is null unless the course is registered AND its graph
 * bundle actually ships: the same fs gate the /knowledge-graph page applies,
 * because an explorer link that would render an empty graph is not honest.
 */
export async function surfaceForCourseRef(
  courseRef: string | undefined | null,
): Promise<CitationSurface> {
  if (!courseRef) return {};
  const courses = await safeCourses();
  return surfaceFor(courses.find((c) => c.code === courseRef));
}

export async function surfaceForCourseSlug(
  slug: string | undefined | null,
): Promise<CitationSurface> {
  if (!slug) return {};
  const courses = await safeCourses();
  return surfaceFor(courses.find((c) => c.slug === slug));
}

async function safeCourses() {
  try {
    return await listCourses();
  } catch {
    return [];
  }
}

function surfaceFor(course: { slug: string } | undefined): CitationSurface {
  if (!course) return {};
  const dataDir = path.join(process.cwd(), "public", "kg", "data");
  const hasGraph = existsSync(path.join(dataDir, `${course.slug}.json`));
  return {
    kgHref: hasGraph
      ? `/knowledge-graph?course=${encodeURIComponent(course.slug)}`
      : null,
    courseSlug: course.slug,
  };
}
