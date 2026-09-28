import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { listCourses, loadHubCourse, pilotCourseSlug } from "@/lib/courses";
import { AssistantClient } from "./assistant-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Assistant — SyllabAI",
  description:
    "The standalone Contextual Learning Assistant: explicit context (spec topic or exam question) + mode, grounded in the bundled corpus with citations and honest refusals.",
};

/**
 * The standalone CLA assistant tab (the demo twin of web's ClaAssistantView
 * surface). The server resolves the selected course's spec tree and question
 * sets; the ask itself is explicit-context + mode via POST /api/ai/cla —
 * the server resolves the context fail-closed and the answer arrives
 * grounded with citations, the deterministic anchor, the evidence count and
 * the honest refusal/gate behavior.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const { course: courseParam } = await searchParams;
  const courses = await listCourses();
  const selectedSlug = courseParam ?? (await pilotCourseSlug()) ?? courses[0]?.slug ?? null;
  const hub = selectedSlug ? await loadHubCourse(selectedSlug) : null;
  if (!hub) notFound();

  const pick = (c: (typeof courses)[number]) => ({
    slug: c.slug,
    label: c.label,
    level: c.level,
    subject: c.subject,
    code: c.code,
  });

  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">Loading assistant…</div>}>
    <RequireAuth>
      <AssistantClient
      courses={courses.map(pick)}
      course={pick(hub.meta)}
      topics={hub.index.tree.topics.map((t) => ({
        code: t.code,
        number: t.number,
        title: t.title,
        specPointCount: t.specPointCount,
      }))}
      questionTopics={hub.questionTopics.map((t) => ({
        slug: t.slug,
        name: t.name,
        setName: t.setName ?? null,
      }))}
      />
    </RequireAuth>
    </Suspense>
  );
}
