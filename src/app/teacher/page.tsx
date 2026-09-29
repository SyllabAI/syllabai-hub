import type { Metadata } from "next";
import { listCourses } from "@/lib/courses";
import { TeacherClient } from "./teacher-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Teacher workspace — SyllabAI Hub",
  description:
    "The teacher mode of SyllabAI: add a class, select its subjects, and find every tool and course resource inside it — plus the marking console and class intelligence over live cohort data.",
};

export default async function TeacherPage() {
  const courses = (await listCourses())
    .filter((c) => c.hasBundle)
    .map((c) => ({ slug: c.slug, label: c.label, subject: c.subject, code: c.code, level: c.level }));

  return <TeacherClient courses={courses} />;
}
