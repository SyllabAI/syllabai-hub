import { notFound } from "next/navigation";
import { loadHubCourse } from "@/lib/courses";
import { CourseHeader } from "@/components/hub/course-header";
import { ResourcePanel } from "@/components/hub/resource-panel";
import { SavedQuestionsList, type SavedQuestionMeta } from "./saved-list";
import { allCourseParams } from "@/lib/static-params";


/** Prerendered at build (ADR-021 perf pass, tranche 4.12) — see static-params.ts. */
export async function generateStaticParams() {
  return allCourseParams();
}
export default async function SavedQuestionsPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();
  const { meta } = hub;

  const all: SavedQuestionMeta[] = hub.questionTopics.flatMap((t) =>
    t.questions.map((q) => {
      const subtopicCode =
        Object.entries(hub.setsBySubtopic).find(([, slugs]) => slugs.includes(t.slug))?.[0] ?? null;
      return {
        questionId: q.id,
        topicSlug: t.slug,
        topicName: t.name,
        marks: q.totalMarks,
        snippet:
          q.parts[0]?.problemMd
            ?.split("\n")
            .filter((l) => l.trim() && !l.startsWith("!["))[0]
            // plain-text preview: drop bold markers / math dollars / blank runs
            ?.replace(/\*{2,}/g, "")
            ?.replace(/\$/g, "")
            ?.replace(/_{2,}/g, "_")
            ?.slice(0, 140) ?? q.id,
        // (tranche 4.12 note: the unguarded chain crashed on questions whose
        // first part is ALL image lines — filter()[0] = undefined → .replace
        // threw. Surfaced by the static prerender sweep on
        // ial-maths-20-pure-1 (image-heavy maths papers); it was equally
        // crashable at request time before this tranche. Fall back to the id.)
        subtopicCode,
      };
    }),
  );

  return (
    <div className="flex w-full">
      <ResourcePanel variant="questions" />
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <CourseHeader
          meta={meta}
          title="Saved questions"
          crumb="Saved questions"
          description="Questions you bookmarked with the Save control in the question player. Saved to your browser — no account, no canonical writes."
        />
        <div className="mt-6">
          <SavedQuestionsList course={meta.slug} all={all} />
        </div>
      </div>
    </div>
  );
}
