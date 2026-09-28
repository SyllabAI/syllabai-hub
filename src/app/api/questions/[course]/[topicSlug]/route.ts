import { NextRequest } from "next/server";
import { loadHubCourse } from "@/lib/courses";

export const dynamic = "force-dynamic";

/** Committed corpus, immutable between deploys — CDN-cacheable (tranche 4.12). */
const CONTENT_CACHE = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" };

/**
 * GET /api/questions/[course]/[topicSlug] — compact question catalog for the
 * standalone assistant's question picker. Codes and ids only — the label is
 * the stem's first line (same rule as the player's tutor deep-link), so no
 * question bodies ride this endpoint.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ course: string; topicSlug: string }> },
) {
  const { course, topicSlug } = await params;
  const hub = await loadHubCourse(course);
  const topic = hub?.questionTopics.find((t) => t.slug === topicSlug);
  if (!hub || !topic) {
    return Response.json({ error: "topic_not_found" }, { status: 404 });
  }
  const questions = topic.questions.map((q) => {
    const md = q.parts[0]?.problemMd ?? "";
    const label =
      md
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("!["))[0]
        ?.slice(0, 140) ?? "this question";
    return {
      id: q.id,
      label,
      marks: q.totalMarks,
      /** part ids — the client derives the attempt flag from the local
       *  progress store (selfScores by question id; mcq/typed by part id) */
      partIds: q.parts.map((p) => p.id),
      specPointCodes: [...new Set(q.parts.flatMap((p) => p.specPointCodes))],
    };
  });
  return Response.json({ course: hub.meta.slug, topic: topicSlug, name: topic.name, questions }, { headers: CONTENT_CACHE });
}
