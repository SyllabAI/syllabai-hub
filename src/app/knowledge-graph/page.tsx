import type { Metadata } from "next";
import { Suspense } from "react";
import { listCourses } from "@/lib/courses";
import { KnowledgeGraphClient } from "./client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Knowledge Graph — SyllabAI Hub",
  description:
    "Per-course knowledge graphs (OpenHuman visualizer): every registered course explores its own specification graph — Subject → Sections → SubTopics → SpecificationPoints — rendered from curriculum truth with the GRAPH_CONTRACT v1.0 data path.",
};

/**
 * Knowledge Graph — per-course OpenHuman explorer.
 *
 * One data-decoupled loader build (public/kg/openhuman-course-explorer.html,
 * forked from the byte-faithful v77 renderer) serves every registered course:
 * the course's canonicalKG JSON is generated from its curriculum bundle by
 * scripts/kg_export.py and swapped into the renderer's own rebuild pipeline
 * at runtime. The old spec-canvas/concept-web surface is retired — the
 * OpenHuman grammar is now THE knowledge-graph surface.
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
