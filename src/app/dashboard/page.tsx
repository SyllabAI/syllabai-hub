import { listCourses } from "@/lib/courses";
import { DashboardClient } from "./dashboard-client";

export const metadata = {
  title: "Dashboard",
  description: "Your subjects and their spec-anchored resources.",
};

export default async function DashboardPage() {
  const courses = await listCourses();
  return <DashboardClient courses={courses} />;
}
