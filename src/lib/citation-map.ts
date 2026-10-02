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
 * - KNOWLEDGE_NODE (/api/v1/knowledge/nodes/{id}) → the course's knowledge
 *   graph explorer (/knowledge-graph?course=<slug>), when the ask's own
 *   course context resolves to a course that actually ships a graph bundle
 *   (kgHrefForCourseRef / kgHrefForCourseSlug) — otherwise the honest null.
 * - document-backed (/api/v1/content/documents/{row}?page=N) → no in-app
 *   reader exists yet (F-022), and the core path is JSON behind a Bearer
 *   token, so the chip stays an informative label until that reader lands —
 *   the bridge point for it is exactly here.
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
  if (deepLink.startsWith("/api/v1/knowledge/nodes/")) {
    return surface?.kgHref ?? null;
  }
  // /api/v1/content/documents/... — learner-accessible on core (L5) but JSON
  // behind a Bearer token: no honest in-app destination until F-022
  return null;
}

/**
 * The ask's KG-explorer href for its own course context — the tutor's
 * courseRef (the registry's curriculumCode) or the CLA's course slug. Null
 * unless the course is registered AND its graph bundle actually ships: the
 * same fs gate the /knowledge-graph page applies, because an explorer link
 * that would render an empty graph is not honest.
 */
export async function kgHrefForCourseRef(
  courseRef: string | undefined | null,
): Promise<string | null> {
  if (!courseRef) return null;
  const courses = await safeCourses();
  return kgHrefFor(courses.find((c) => c.code === courseRef));
}

export async function kgHrefForCourseSlug(
  slug: string | undefined | null,
): Promise<string | null> {
  if (!slug) return null;
  const courses = await safeCourses();
  return kgHrefFor(courses.find((c) => c.slug === slug));
}

async function safeCourses() {
  try {
    return await listCourses();
  } catch {
    return [];
  }
}

function kgHrefFor(course: { slug: string } | undefined): string | null {
  if (!course) return null;
  const dataDir = path.join(process.cwd(), "public", "kg", "data");
  if (!existsSync(path.join(dataDir, `${course.slug}.json`))) return null;
  return `/knowledge-graph?course=${encodeURIComponent(course.slug)}`;
}
