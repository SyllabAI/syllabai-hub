import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { loadHubCourse } from "@/lib/courses";
import { CourseHeader } from "@/components/hub/course-header";
import { NumberedLabel } from "@/components/hub/chrome";
import { DeckDueBadge } from "./deck-due-badge";
import { allCourseParams } from "@/lib/static-params";


/** Prerendered at build (ADR-021 perf pass, tranche 4.12) — see static-params.ts. */
export async function generateStaticParams() {
  return allCourseParams();
}
export default async function FlashcardsIndexPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();
  const { meta, stats } = hub;
  const base = `/courses/${meta.slug}`;

  const decks = hub.index.tree.topics.flatMap((t) =>
    t.subtopics
      .map((s) => ({
        subtopic: s,
        topic: t,
        count: hub.cardsBySubtopic[s.code]?.length ?? 0,
      }))
      .filter((d) => d.count > 0),
  );

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <CourseHeader
        meta={meta}
        title={`Edexcel ${meta.level} ${meta.label} Flashcards`}
        crumb="Flashcards"
        description={`Per-sub-topic recall decks — ${stats.flashcards} cards. Rating a card (Still learning / Know) feeds your sub-topic rings in the local overlay; rated cards return on an expanding review schedule, and on the pilot course signed-in learners also record ratings to their account as self-report evidence (never mastery).`}
      />

      <div className="mt-6 space-y-2">
        <Badge variant="outline" className="border-info/30 text-[10px] text-info">
          RULE_DERIVED corpus content
        </Badge>
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Cards are imported verbatim from the operator-licensed pilot deck corpus
          (front/back markdown, card types preserved). Their spec-point anchors are kept on
          every card and drive the sub-topic placement — nothing here is fabricated. Courses the
          upstream corpus has no decks for show honestly empty.
        </p>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {decks.map((d) => (
          <Link
            key={d.subtopic.code}
            href={`${base}/flashcards/${d.subtopic.code}`}
            className="group min-w-0 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40"
          >
            <div className="flex min-w-0 items-center gap-2">
              <CircleHelp className="size-4 shrink-0 text-primary" aria-hidden />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold group-hover:text-primary">
                {d.subtopic.title}
              </p>
              <DeckDueBadge course={meta.slug} subtopicCode={d.subtopic.code} />
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              <NumberedLabel number={d.topic.number} title={d.topic.title} /> · {d.count} card
              {d.count === 1 ? "" : "s"}
            </p>
          </Link>
        ))}
      </div>

      {decks.length === 0 && (
        <Card className="mt-6">
          <CardContent className="p-6 text-sm text-muted-foreground">
            No flashcard decks imported for this course yet.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
