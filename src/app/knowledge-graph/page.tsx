import type { Metadata } from "next";
import { existsSync } from "node:fs";
import path from "node:path";
import { Suspense } from "react";
import { listCourses } from "@/lib/courses";
import { KnowledgeGraphClient } from "./client";

export const metadata: Metadata = {
  title: "Knowledge Graph — SyllabAI Hub",
  description:
    "The selected course's specification graph (OpenHuman visualizer): Subject → Sections → SubTopics → SpecificationPoints, rendered from curriculum truth with the GRAPH_CONTRACT v1.0 data path. One graph per course — open it from the course's page, or pick one on the landing state.",
};

/**
 * Knowledge Graph — single-course OpenHuman explorer.
 *
 * One data-decoupled loader build (public/kg/openhuman-course-explorer.html,
 * forked from the byte-faithful v77 renderer) renders the course this page
 * was opened for (?course=<slug>, deep-linked from that course's page): the
 * course's canonicalKG JSON is generated from its curriculum bundle by
 * scripts/kg_export.py and swapped into the renderer's own rebuild pipeline
 * at runtime. Courses without ?course= (top-nav, home card) land on the
 * honest picker — never silently on the pilot's graph.
 */
export default async function KnowledgeGraphPage() {
  const courses = await listCourses();
  const dataDir = path.join(process.cwd(), "public", "kg", "data");
  return (
    <Suspense fallback={null}>
      <KnowledgeGraphClient
        courses={courses.map((c) => ({
          slug: c.slug,
          label: c.label,
          subject: c.subject,
          code: c.code,
          level: c.level,
          // the picker lists exactly what will load — an fs check, not a
          // registry promise (hasBundle is about content, not kg data)
          hasGraph: existsSync(path.join(dataDir, `${c.slug}.json`)),
        }))}
      />
    </Suspense>
  );
}
