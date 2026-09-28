import { notFound } from "next/navigation";
import { loadHubCourse } from "@/lib/courses";
import { buildPracticePapers, getPaper, isPaperId, paperEstTime } from "@/lib/practice-papers";
import { Breadcrumbs, ExamCodePill } from "@/components/hub/chrome";
import { ResourcePanel } from "@/components/hub/resource-panel";
import { Badge } from "@/components/ui/badge";
import { QuestionPlayer } from "@/app/courses/[course]/exam-questions/[topicSlug]/question-player";

export const dynamic = "force-dynamic";

/**
 * One practice paper (Task 22) — deterministic assembly from the course's
 * real question banks, so the paper is identical on every visit. Questions
 * keep their attested mark schemes; the assembly framing is shown up front.
 */
export default async function PracticePaperPage({
  params,
}: {
  params: Promise<{ course: string; paperId: string }>;
}) {
  const { course: slug, paperId } = await params;
  if (!isPaperId(paperId)) notFound();
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();

  const paper = getPaper(buildPracticePapers(hub.meta.slug, hub.questionTopics), paperId);
  if (!paper) notFound();

  const { meta } = hub;

  return (
    <div className="flex w-full">
      <ResourcePanel variant="questions" />
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-5">
        <Breadcrumbs
          items={[
            { label: meta.level, href: "/courses" },
            { label: meta.subject, href: `/courses/${meta.slug}` },
            { label: "Practice Papers", href: `/courses/${meta.slug}/practice-papers` },
            { label: paper.title },
          ]}
        />

        <header className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="max-w-2xl text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              {paper.title}{" "}
              <span className="text-muted-foreground">
                (Edexcel {meta.level} {meta.subject})
              </span>
            </h1>
            <ExamCodePill code={meta.code} />
          </div>
          <p className="text-sm text-muted-foreground">
            {paper.items.length} questions · {paper.totalMarks} marks ·{" "}
            {paperEstTime(paper.totalMarks)} · spans {paper.coveredTopics} of {paper.totalTopics}{" "}
            topics
          </p>
          {/* long sentence, not a chip — the Badge base's whitespace-nowrap
              blew the row past 375px (s133); wrap it like text instead */}
          <Badge variant="secondary" className="max-w-full whitespace-normal text-left font-medium">
            Assembled from the topic question banks — not an official Edexcel paper
          </Badge>
        </header>

        <QuestionPlayer
          course={meta.slug}
          topicName={paper.title}
          topicSlug={paper.id}
          subtopicCode={null}
          subtopicTitle={null}
          questions={paper.items.map((i) => i.question)}
        />
        </div>
      </div>
    </div>
  );
}
