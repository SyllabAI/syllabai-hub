import { notFound } from "next/navigation";
import { loadHubCourse } from "@/lib/courses";
import { Breadcrumbs, ExamCodePill } from "@/components/hub/chrome";
import { ResourcePanel } from "@/components/hub/resource-panel";
import { QuestionPlayer } from "./question-player";
import { pilotTopicSetParams } from "@/lib/static-params";

/**
 * Question set page (SME, research §6.2 + flow crawl fig. 14): breadcrumb
 * trail, two-tone title "{Set} (Edexcel {level} {subject}): Exam Questions",
 * exam-code pill, slim meta line (questions · marks · estimated time), then
 * the player. The resource topic panel (SME's second column) mounts left.
 */

/** Prerendered at build (ADR-021 perf pass, tranche 4.12) — see static-params.ts. */
export async function generateStaticParams() {
  return pilotTopicSetParams();
}
export default async function QuestionSetPage({
  params,
}: {
  params: Promise<{ course: string; topicSlug: string }>;
}) {
  const { course: slug, topicSlug } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();
  const topic = hub.questionTopics.find((t) => t.slug === topicSlug);
  if (!topic) notFound();

  const { meta } = hub;
  const subtopicCode = Object.entries(hub.setsBySubtopic).find(([, slugs]) =>
    slugs.includes(topic.slug),
  )?.[0] ?? null;
  const subtopic = subtopicCode ? hub.index.subtopicByCode.get(subtopicCode) : null;

  const totalMarks = topic.questions.reduce((a, q) => a + q.totalMarks, 0);
  // SME-style duration estimate (fig. 14: "2 hours · 23 questions")
  const estTime = totalMarks >= 80 ? `≈ ${Math.round(totalMarks / 60)} hours` : `≈ ${totalMarks} min`;

  return (
    <div className="flex w-full">
      <ResourcePanel variant="questions" />
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-5">
          <Breadcrumbs
            items={[
              { label: meta.level, href: "/courses" },
              { label: meta.subject, href: `/courses/${meta.slug}` },
              { label: "Exam Questions", href: `/courses/${meta.slug}/exam-questions` },
              { label: topic.name },
            ]}
          />
          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="max-w-2xl text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                {topic.name}
                {topic.setName ? ` — ${topic.setName}` : ""}{" "}
                <span className="text-muted-foreground">
                  (Edexcel {meta.level} {meta.subject}): Exam Questions
                </span>
              </h1>
              <ExamCodePill code={meta.code} />
            </div>
            <p className="text-sm text-muted-foreground">
              {topic.questions.length} questions · {totalMarks} marks · {estTime}
            </p>
          </header>

          <QuestionPlayer
            course={meta.slug}
            topicName={topic.name}
            topicSlug={topic.slug}
            subtopicCode={subtopicCode}
            subtopicTitle={subtopic?.title ?? null}
            questions={topic.questions}
          />
        </div>
      </div>
    </div>
  );
}
