import type { Metadata } from "next";
import { listCourses, pilotCourseSlug, type CourseMeta } from "@/lib/courses";
import { TeacherClassesClient } from "./classes-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Classes · Teacher workspace",
  description:
    "Create and manage classes on your subjects: rosters, announcements with read state, and class-targeted assignments — live from the SyllabAI backend.",
};

/**
 * The class-hosting course list is resolved server-side (the registry is a
 * node:fs concern) and handed to the client as props — the established
 * pattern. The pilot first, then every full bundle course; registered
 * courses without a bundle are excluded (a class needs a real subject page
 * to live on).
 */
export default async function TeacherClassesPage() {
  const [all, pilot] = await Promise.all([listCourses(), pilotCourseSlug()]);
  const classCourses: CourseMeta[] = all
    .filter((c) => (pilot && c.slug === pilot) || c.status === "full")
    .sort((a, b) => (a.slug === pilot ? -1 : b.slug === pilot ? 1 : a.label.localeCompare(b.label)));
  return <TeacherClassesClient courses={classCourses} pilotSlug={pilot} />;
}
