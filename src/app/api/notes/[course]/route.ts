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
 * GET /api/notes/[course] — compact revision-note digest for client-side
 * joins (the question↔note help panel). The join keys (specPointCodes) ride
 * both read models, so the panel joins locally by design — no extra round
 * trip per question; bodies load lazily from /api/notes/[course]/[noteId].
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ course: string }> },
) {
  const { course } = await params;
  const hub = await loadHubCourse(course);
  if (!hub) {
    return Response.json({ error: "course_not_found" }, { status: 404 });
  }
  const { subtopicByCode, topicOfSubtopic, topicByCode } = hub.index;
  const notes = hub.notes.map((n) => {
    const subCode = hub.noteSubtopic[n.noteId] ?? null;
    const sub = subCode ? subtopicByCode.get(subCode) : null;
    const topic = sub ? topicByCode.get(topicOfSubtopic.get(sub.code) ?? "") : null;
    return {
      noteId: n.noteId,
      title: n.title,
      specPointCodes: n.specPointCodes,
      path: [topic?.title, sub?.title].filter(Boolean).join(" · ") || null,
    };
  });
  return Response.json({ course: hub.meta.slug, notes }, { headers: CONTENT_CACHE });
}
