import type { Metadata } from "next";
import { listCourses, pilotCourseSlug } from "@/lib/courses";
import { AssignmentsClient } from "./assignments-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Assignments · Teacher workspace",
  description:
    "Teacher assignments (core-backed): build from the question bank, assign to your cohort, track real learner hand-ins — completion evidence recorded on core.",
};

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string; from?: string; subtopics?: string }>;
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
    <AssignmentsClient
      courses={courses}
      initialCourse={initialCourse}
      fromTest={params.from ?? null}
      initialSubtopics={initialSubtopics}
    />
  );
}
