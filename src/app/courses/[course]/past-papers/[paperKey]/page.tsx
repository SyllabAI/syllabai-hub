import { notFound } from "next/navigation";
import { loadHubCourse } from "@/lib/courses";
import { collectPastPapers, findPastPaper, paperEstTime } from "@/lib/past-papers";
import {
  matchReconstructions,
  computeCoverage,
  coverageTitle,
  blueprintFor,
  type ReconstructionCoverage,
} from "@/lib/pastpapers-reconstruction";
import { corpusPapersForCourse, doubleAwardScopeNote } from "@/lib/pastpapers-corpus";
import { Breadcrumbs, ExamCodePill } from "@/components/hub/chrome";
import { Badge } from "@/components/ui/badge";
import { QuestionPlayer } from "@/app/courses/[course]/exam-questions/[topicSlug]/question-player";

export const dynamic = "force-dynamic";

/**
 * One past paper (Task 22) — a partial reconstruction built strictly from
 * questions whose parts attest this session + paper number (sourcePaper),
 * played back in original paper order. The reconstruction framing is shown
 * up front, next to the paper reference.
 */
export default async function PastPaperPage({
  params,
}: {
  params: Promise<{ course: string; paperKey: string }>;
}) {
  const { course: slug, paperKey } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();

  const paper = findPastPaper(collectPastPapers(hub.questionTopics), paperKey);
  if (!paper) notFound();

  // coverage — find the corpus row this reconstruction matches, then compare
  // against the official per-question totals extracted from the corpus QP.
  let coverage: ReconstructionCoverage | null = null;
  const corpusKey = matchReconstructions(corpusPapersForCourse(slug), [paper])
    .reconForCorpus.keys()
    .next().value;
  if (corpusKey) coverage = computeCoverage(paper, blueprintFor(corpusKey));

  const { meta } = hub;
  // 2-series surfacing decision: when this reconstruction's provenance pins a
  // paper outside the qualification's assessed set, say so up front — the
  // player has no PDF/mock pairing and the student deserves the reason.
  const scopeNote = doubleAwardScopeNote(slug, paper.date, paper.number);

  return (
    // NOTE: no ResourcePanel here either — paper playback is linear, the
    // Exam-Questions topic tree is noise (same reasoning as the PDF viewer).
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <Breadcrumbs
          items={[
            { label: meta.level, href: "/courses" },
            { label: meta.subject, href: `/courses/${meta.slug}` },
            { label: "Past Papers", href: `/courses/${meta.slug}/past-papers` },
            { label: paper.number },
          ]}
        />

        <header className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="max-w-2xl text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              {paper.number} — {paper.date}{" "}
              <span className="text-muted-foreground">
                (Edexcel {meta.level} {meta.subject}): Past Paper
              </span>
            </h1>
            <ExamCodePill code={meta.code} />
          </div>
          <p className="text-sm text-muted-foreground">
            {paper.questions.length} questions · {paper.totalMarks} marks ·{" "}
            {paperEstTime(paper.totalMarks)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className={
                coverage?.state === "partial" ? "border border-amber-500/40 bg-amber-500/10 font-medium" : "font-medium"
              }
            >
              {coverage
                ? coverageTitle(coverage)
                : `Reconstructed — ${paper.questions.length} question${paper.questions.length === 1 ? "" : "s"} held from this paper, in paper order`}
            </Badge>
            {scopeNote && (
              <Badge variant="outline" className="font-medium text-muted-foreground">
                {scopeNote.label}
              </Badge>
            )}
          </div>
          {scopeNote && (
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {scopeNote.note}
            </p>
          )}
        </header>

        <QuestionPlayer
          course={meta.slug}
          topicName={`${paper.number} — ${paper.date}`}
          topicSlug={paper.key}
          subtopicCode={null}
          subtopicTitle={null}
          questions={paper.questions}
        />
      </div>
    </div>
  );
}
