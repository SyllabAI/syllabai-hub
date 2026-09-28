import { notFound } from "next/navigation";
import { getCourseBundle, loadHubCourse } from "@/lib/courses";
import { getDataProvider } from "@/lib/data";
import { CourseHeader } from "@/components/hub/course-header";
import { SpecificationExplorer, type SpecTopicVM } from "./client";
import { allCourseParams } from "@/lib/static-params";

/**
 * Specification explorer — the official spec tree with each statement's
 * printed paper/unit/tier home (T-KG-17 consumer for the T-KG-16 canonical
 * applicability derivation). Zero invention: statements are the spine text
 * verbatim, chips render the canonical object verbatim, and the printed
 * rule sentence rides along as tooltip provenance.
 */

/** Prerendered at build (ADR-021 perf pass, tranche 4.12) — see static-params.ts. */
export async function generateStaticParams() {
  return allCourseParams();
}
export default async function CourseSpecificationPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();
  const { meta, stats } = hub;

  // curriculum nodes: bundle read (all 49 committed courses); the provider
  // seam covers the pilot-without-bundle ladder the hub already supports
  const bundle = await getCourseBundle(slug);
  const curriculum =
    bundle?.curriculum ?? (hub.viaProvider ? await getDataProvider().curriculum() : null);
  if (!curriculum) notFound();

  const nodeByCode = new Map(curriculum.nodes.map((n) => [n.code, n]));
  const points = (codes: string[]) =>
    codes
      .map((c) => nodeByCode.get(c))
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .map((n) => ({
        code: n.code,
        text: n.title,
        applicability: n.applicability ?? null,
      }));

  const topics: SpecTopicVM[] = hub.index.tree.topics.map((t) => ({
    number: t.number,
    title: t.title,
    subtopics: t.subtopics.map((s) => ({
      code: s.code,
      label: s.label,
      title: s.title,
      points: points(s.specPointCodes),
    })),
  }));

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <CourseHeader
        meta={meta}
        title={`${meta.subject} ${meta.code} — specification explorer`}
        crumb="Specification"
        description={`Every ${stats.specPoints} specification statement with its printed assessment home — filter by paper, unit or tier exactly as Pearson assesses them. Statements are the parsed specification text verbatim.`}
      />
      <div className="mt-6">
        <SpecificationExplorer topics={topics} totalPoints={stats.specPoints} />
      </div>
    </div>
  );
}
