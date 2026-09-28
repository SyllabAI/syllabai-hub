import type { Metadata } from "next";
import { listCourses, pilotCourseSlug } from "@/lib/courses";
import { TeacherClient } from "./teacher-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Teacher workspace — SyllabAI Hub",
  description:
    "The teacher mode of SyllabAI: the marking console and class intelligence over live cohort data, plus subject-scoped access to the same course resources students use.",
};

export default async function TeacherPage({
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

  return <TeacherClient courses={courses} initialCourse={initialCourse} />;
}
