import type { Metadata } from "next";
import { listCourses, pilotCourseSlug } from "@/lib/courses";
import { ClassGraphClient } from "./class-graph-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Class knowledge graph — SyllabAI Hub teacher workspace",
  description:
    "Teacher lens over the same subject graph (TEACHER_ARCHITECTURE §13): teaching-coverage overlay × class understanding bands, distributions instead of averages, drill-down to resources and a remediation test.",
};

export default async function ClassGraphPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const params = await searchParams;
  const courses = (await listCourses())
    .filter((c) => c.hasBundle)
    .map((c) => ({ slug: c.slug, label: c.label, code: c.code, level: c.level }));
  const pilot = await pilotCourseSlug();
  const initialCourse =
    courses.find((c) => c.slug === params.course)?.slug ?? pilot ?? courses[0]?.slug ?? null;

  return <ClassGraphClient courses={courses} initialCourse={initialCourse} />;
}
