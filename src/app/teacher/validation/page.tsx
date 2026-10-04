import type { Metadata } from "next";
import { listCourses, pilotCourseSlug } from "@/lib/courses";
import { ValidationClient } from "./validation-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Validation · Teacher workspace",
  description:
    "AI-content validation queue (Phase 2): teacher verdicts on AI-authored model solutions before they count — demo-truth on real corpus items.",
};

export default async function ValidationPage({
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

  return <ValidationClient courses={courses} initialCourse={initialCourse} />;
}
