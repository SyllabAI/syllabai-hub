import type { Metadata } from "next";
import { listCourses } from "@/lib/courses";
import { ClassWorkspaceDispatcher } from "./class-workspace-dispatcher";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Class workspace · Teacher workspace",
  description:
    "One class's workspace: the tools and course resources for every subject it covers, plus the live core roster — enroll students, publish notices, read cohort analytics.",
};

export default async function TeacherClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const courses = (await listCourses())
    .filter((c) => c.hasBundle)
    .map((c) => ({ slug: c.slug, label: c.label, subject: c.subject, code: c.code, level: c.level }));

  return <ClassWorkspaceDispatcher classId={id} courses={courses} />;
}
