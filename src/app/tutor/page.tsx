import { Suspense } from "react";
import type { Metadata } from "next";
import { RequireAuth } from "@/components/auth/require-auth";
import { getCourseMeta } from "@/lib/courses";
import { TutorChat, TutorCourseGate } from "./chat";

export const metadata: Metadata = { title: "Tutor" };

/**
 * V53 (ADR-030) — the tutor becomes course-aware through the hub's OWN
 * registry: `/tutor?course=<slug>` resolves the slug to the registry's
 * `curriculumCode` (the core `curriculum_versions.code` the ask is scoped
 * by) and hands it to the chat as the ask's `courseRef`. The mapping is
 * EXPLICIT hub-maintained data — a course without one gets the honest gate,
 * never a silent cross-corpus fallback. No param = the legacy entry (pilot
 * behavior unchanged, chemistry pilot corpus as before).
 *
 * Rendering rules: the honest gates render WITHOUT the auth wrapper (a
 * signed-out visitor deserves the same "not yet available" answer, and a
 * login wall in front of a dead end is not honesty); every chat surface —
 * legacy or course-scoped — stays behind RequireAuth.
 */
export default async function TutorPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const { course: courseSlug } = await searchParams;
  const slug = courseSlug?.trim() || null;

  if (slug) {
    const meta = await getCourseMeta(slug);
    if (!meta) {
      return <TutorCourseGate label={slug} reason="unknown" />;
    }
    if (!meta.curriculumCode) {
      return <TutorCourseGate label={meta.label} reason="unmapped" />;
    }
    return (
      <Suspense
        fallback={
          <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center text-sm text-muted-foreground">
            Loading tutor…
          </div>
        }
      >
        <RequireAuth>
          <TutorChat
            courseSlug={meta.slug}
            courseLabel={meta.label}
            courseRef={meta.curriculumCode}
          />
        </RequireAuth>
      </Suspense>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center text-sm text-muted-foreground">
          Loading tutor…
        </div>
      }
    >
      <RequireAuth>
        <TutorChat />
      </RequireAuth>
    </Suspense>
  );
}
