import { NextRequest } from "next/server";
import { loadHubCourse } from "@/lib/courses";

export const dynamic = "force-dynamic";

/**
 * The corpus behind this route is committed and immutable between deploys,
 * so the CDN may cache responses (ADR-021 perf pass, tranche 4.12): a short
 * s-maxage bounds staleness, stale-while-revalidate keeps serving through
 * revalidation. Not `immutable` — URLs are not deploy-versioned.
 */
const CONTENT_CACHE = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" };

/**
 * GET /api/notes/[course]/[noteId] — one revision note's body, resolved
 * fail-closed (unknown course/note → 404). Serves the question↔note help
 * panel's lazy expansion: the body downloads only when a note is expanded,
 * never on page load.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ course: string; noteId: string }> },
) {
  const { course, noteId } = await params;
  const hub = await loadHubCourse(course);
  const note = hub?.notes.find((n) => n.noteId === noteId);
  if (!hub || !note) {
    return Response.json({ error: "note_not_found" }, { status: 404 });
  }
  return Response.json({
    noteId: note.noteId,
    title: note.title,
    specPointCodes: note.specPointCodes,
    bodyMd: note.bodyMd,
    url: `/courses/${hub.meta.slug}/revision-notes/${note.noteId}`,
  }, { headers: CONTENT_CACHE });
}
