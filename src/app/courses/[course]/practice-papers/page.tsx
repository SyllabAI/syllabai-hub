import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Files } from "lucide-react";
import { loadHubCourse } from "@/lib/courses";
import { buildPracticePapers, paperEstTime } from "@/lib/practice-papers";
import { CourseHeader } from "@/components/hub/course-header";
import { Card, CardContent } from "@/components/ui/card";
import { allCourseParams } from "@/lib/static-params";

/**
 * Practice Papers index (Task 22) — full-length mixed papers assembled
 * deterministically from this course's real question banks. Honest framing
 * throughout: same questions and mark schemes as the topic banks, assembled
 * into paper-shaped revision because official papers can't be redistributed.
 */

/** Prerendered at build (ADR-021 perf pass, tranche 4.12) — see static-params.ts. */
export async function generateStaticParams() {
  return allCourseParams();
}
export default async function PracticePapersPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();

  const { meta, stats } = hub;
  const base = `/courses/${meta.slug}`;
  const papers =
    stats.questionSets > 0
      ? buildPracticePapers(meta.slug, hub.questionTopics)
      : [];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <CourseHeader
        meta={meta}
        title={`Edexcel ${meta.level} ${meta.label} Practice Papers`}
        crumb="Practice Papers"
        description="Full-length mixed-topic papers assembled from this course's question bank — every question is real corpus content with its attested mark scheme. Each paper is deterministic: the same paper every time you open it."
      />

      {papers.length === 0 ? (
        <Card className="border-dashed mt-6">
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Files className="size-4 text-primary" aria-hidden />
              No question bank for this course yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Practice papers are assembled from the course&apos;s exam questions — this bundle
              doesn&apos;t have any imported yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-xl border">
          {papers.map((p, i) => (
            <li key={p.id} className={i > 0 ? "border-t" : undefined}>
              <Link
                href={`${base}/practice-papers/${p.id}`}
                className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{p.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.items.length} questions · {p.totalMarks} marks · {paperEstTime(p.totalMarks)}{" "}
                    · spans {p.coveredTopics} of {p.totalTopics} topics
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
