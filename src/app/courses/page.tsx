import type { Metadata } from "next";
import { listCourses } from "@/lib/courses";
import { CourseDirectory } from "./course-directory";

export const metadata: Metadata = { title: "Browse courses" };

export default async function CoursesIndexPage() {
  const courses = await listCourses();
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Courses</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every Edexcel IAL and IGCSE course variant in the SyllabAI corpus registry —{" "}
          {courses.length} Learning Hubs (revision notes, exam questions and flashcards organised
          around each course&apos;s corpus specification tree). All {courses.length} bundles are
          imported from the operator-authorized Save My Exams corpus; the 4CH1 Chemistry pilot
          additionally runs on the official Pearson specification tree with its concept graph.
        </p>
      </header>
      <CourseDirectory courses={courses} />
    </div>
  );
}
