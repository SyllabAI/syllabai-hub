import { notFound } from "next/navigation";
import { loadHubCourse } from "@/lib/courses";
import { CourseHeader } from "@/components/hub/course-header";
import { StrengthsPanel, type StrengthsDatum } from "./strengths-panel";
import { allCourseParams } from "@/lib/static-params";


/** Prerendered at build (ADR-021 perf pass, tranche 4.12) — see static-params.ts. */
export async function generateStaticParams() {
  return allCourseParams();
}
export default async function StrengthsPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();
  const { meta } = hub;
  const base = `/courses/${meta.slug}`;

  const data: StrengthsDatum[] = hub.index.tree.topics.flatMap((t) =>
    t.subtopics
      .filter((s) => (hub.counts[s.code]?.questions ?? 0) > 0 || (hub.counts[s.code]?.flashcards ?? 0) > 0)
      .map((s) => ({
        subtopicCode: s.code,
        title: s.title,
        topicNumber: t.number,
        href: hub.hrefs.questions[s.code] ?? hub.hrefs.notes[s.code] ?? `${base}/exam-questions`,
        counts: hub.counts[s.code] ?? { notes: 0, questions: 0, flashcards: 0 },
      })),
  );

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <CourseHeader
        meta={meta}
        activeTab="strengths"
        title={`Edexcel ${meta.level} ${meta.label} Strengths & Weaknesses`}
        crumb="Strengths & Weaknesses"
        description="Per-topic analytics over your answers — the demo prototype of the production analytics layer."
      />
      <StrengthsPanel course={meta.slug} data={data} />
      <p className="mt-6 rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Where this data lives:</span> every event is a
        browser-local <span className="font-mono">SIMULATED</span> overlay entry (localStorage,
        per course). It never writes to canonical content or the SIMULATED learner JSON — the same
        discipline the rest of the demo follows.
      </p>
    </div>
  );
}
