import type { Metadata } from "next";
import { listCourses, pilotCourseSlug } from "@/lib/courses";
import { TestBuilderClient } from "./test-builder-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Test Builder — SyllabAI Hub teacher workspace",
  description:
    "Teacher Test Builder (TEACHER_ARCHITECTURE §6): assemble a printable, marks-aware test from the committed question bank, with class-weakness targeting and an optional answer key.",
};

export default async function TestBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string; subtopics?: string; view?: string }>;
}) {
  const params = await searchParams;
  const courses = (await listCourses())
    .filter((c) => c.hasBundle)
    .map((c) => ({ slug: c.slug, label: c.label, code: c.code, level: c.level }));
  const pilot = await pilotCourseSlug();
  const initialCourse =
    courses.find((c) => c.slug === params.course)?.slug ?? pilot ?? courses[0]?.slug ?? null;
  const initialSubtopics = (params.subtopics ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);

  return (
    <TestBuilderClient
      courses={courses}
      initialCourse={initialCourse}
      initialSubtopics={initialSubtopics}
      initialView={params.view === "builder" ? "builder" : "tests"}
    />
  );
}
