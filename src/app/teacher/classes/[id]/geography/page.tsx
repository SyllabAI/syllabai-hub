import type { Metadata } from "next";
import { listCourses } from "@/lib/courses";
import { ClassGeographyClient } from "./geography-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Class geography progress — SyllabAI Hub teacher workspace",
  description:
    "My Class Geography Progress: the class's curriculum geography — every subject's spec tree with the corpus coverage per subtopic (notes, exam questions, flashcards). Corpus coverage, not learner mastery.",
};

export default async function TeacherClassGeographyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const courses = (await listCourses())
    .filter((c) => c.hasBundle)
    .map((c) => ({ slug: c.slug, label: c.label, subject: c.subject, code: c.code, level: c.level }));

  return <ClassGeographyClient classId={id} courses={courses} />;
}
