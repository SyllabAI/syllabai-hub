import type { Metadata } from "next";
import { ClassIntelligenceClient } from "./class-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Class insights · Teacher workspace",
  description:
    "Class-level analytics over real learner evidence: topic heatmap, weak prerequisites, drill-down to affected learners and evidence, and the class knowledge graph — live from the SyllabAI backend.",
};

export default function ClassIntelligencePage() {
  return <ClassIntelligenceClient />;
}
