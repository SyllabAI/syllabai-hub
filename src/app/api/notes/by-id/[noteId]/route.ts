import { NextRequest } from "next/server";
import { getCourseBundle, listCourses } from "@/lib/courses";
import type { RevisionNote as RevisionNoteT } from "@/lib/contracts";

export const dynamic = "force-dynamic";

/**
 * The corpus behind this route is committed and immutable between deploys,
 * so the CDN may cache responses (same discipline as the course-scoped
 * /api/notes/[course]/[noteId] route, ADR-021 perf pass, tranche 4.12).
 */
const CONTENT_CACHE = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" };

/**
 * GET /api/notes/by-id/[noteId] — the course-agnostic half of the citation
 * popup's note join.
 *
 * The course-scoped route serves chips that carry the ask's course hint
 * (note CLA, course-scoped tutor). The legacy /tutor entry and old bookmarks
 * emit citation chips WITHOUT one, and the popup's join used to fall to
 * parsed text for those — a learner-face inconsistency between surfaces
 * that drew on the same corpus.
 *
 * THE AMBIGUITY GATE (the load-bearing honesty rule, pinned by
 * scripts/note_by_id_join_verify.ts): "rn_" ids are stable per SME source
 * page and REUSED across sibling course bundles — of this corpus's 2,538
 * ids, 681 appear in up to 5 bundles and 623 of those carry DIFFERING
 * bodies (course-specific variants). A first-match scan would silently
 * serve the wrong course's body. So this route joins an id ONLY when it
 * maps to exactly one registered bundle; anything ambiguous refuses with
 * 404 and the popup keeps the verbatim parsed text — the same floor a
 * courseless chip sits on today. Never a guess.
 *
 * Static segment "by-id" shadows [course] per Next.js precedence — no
 * registered course slug collides with it.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const { noteId } = await params;
  const courses = (await listCourses()).filter((c) => c.hasBundle);
  let hit: { course: string; note: RevisionNoteT } | null = null;
  for (const c of courses) {
    const note = (await getCourseBundle(c.slug))?.notes.find((n) => n.noteId === noteId);
    if (!note) continue;
    if (hit) {
      // second owner — the id is course-ambiguous, refuse the join entirely
      return Response.json({ error: "note_ambiguous" }, { status: 404 });
    }
    hit = { course: c.slug, note };
  }
  if (!hit) {
    return Response.json({ error: "note_not_found" }, { status: 404 });
  }
  return Response.json({
    noteId: hit.note.noteId,
    course: hit.course,
    title: hit.note.title,
    specPointCodes: hit.note.specPointCodes,
    bodyMd: hit.note.bodyMd,
    url: `/courses/${hit.course}/revision-notes/${hit.note.noteId}`,
  }, { headers: CONTENT_CACHE });
}
