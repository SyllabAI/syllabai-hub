import type { Metadata } from "next";
import { Suspense } from "react";
import { listCourses } from "@/lib/courses";
import { KnowledgeGraphClient } from "./client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Knowledge Graph — SyllabAI Hub",
  description:
    "The selected course's specification graph (OpenHuman visualizer): Subject → Sections → SubTopics → SpecificationPoints, rendered from curriculum truth with the GRAPH_CONTRACT v1.0 data path. One graph per course — open it from the course's page.",
};

/**
 * Knowledge Graph — single-course OpenHuman explorer.
 *
 * One data-decoupled loader build (public/kg/openhuman-course-explorer.html,
 * forked from the byte-faithful v77 renderer) renders the course this page
 * was opened for (?course=<slug>, deep-linked from that course's page; the
 * pilot by default): the course's canonicalKG JSON is generated from its
 * curriculum bundle by scripts/kg_export.py and swapped into the renderer's
 * own rebuild pipeline at runtime. There is no course switcher — the graph
 * is a property of the selected subject, not a browsing surface (operator
 * decision, trace 1a0e8568eb6bb545).
 */
export default async function KnowledgeGraphPage() {
  const courses = await listCourses();
  return (
    <Suspense fallback={null}>
      <KnowledgeGraphClient
        courses={courses.map((c) => ({
          slug: c.slug,
          label: c.label,
          subject: c.subject,
          code: c.code,
          level: c.level,
        }))}
      />
    </Suspense>
  );
}
