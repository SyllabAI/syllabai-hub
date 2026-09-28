import { notFound } from "next/navigation";
import { loadHubCourse } from "@/lib/courses";
import { hasPastPapers } from "@/lib/past-papers";
import { courseHasCorpusPapers } from "@/lib/pastpapers-corpus";
import { CourseShell, type SidebarData } from "@/components/hub/course-shell";
import { LastOpenedTracker } from "@/components/hub/last-opened-tracker";

export const dynamic = "force-dynamic";

/**
 * Per-course layout — mounts the persistent course sidebar (the ONE sidebar,
 * SaveMyExams model, research §4 + flow crawl 2026-09-19). Resource detail
 * pages additionally mount the topic panel (resource-panel.tsx) as SME's
 * second column; hub/index pages have sidebar-only chrome.
 *
 * Deliberately NO <Suspense> around {children}: a boundary here lets the
 * shell (sidebar + fallback) flush with 200 before the page's notFound()
 * resolves, turning every unknown slug under /courses/[course]/… into a
 * soft-404 (200 + not-found UI, s133). Pages must be able to 404 pre-flush;
 * loadHubCourse is request-deduped (React cache) so the page rides the
 * layout's data instead of paying a second bundle read.
 */
export default async function CourseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();

  const data: SidebarData = {
    course: {
      slug: hub.meta.slug,
      subject: hub.meta.subject,
      label: hub.meta.label,
      level: hub.meta.level,
      code: hub.meta.code,
    },
    tree: hub.index.tree,
    counts: hub.counts,
    hrefs: hub.hrefs,
    noteSubtopic: hub.noteSubtopic,
    notesBySubtopic: hub.notesBySubtopic,
    setsBySubtopic: hub.setListsBySubtopic,
    hasPastPapers: hasPastPapers(hub.questionTopics),
    hasCorpusPapers: courseHasCorpusPapers(slug),
  };

  return (
    <CourseShell data={data}>
      {/* records real navigation for the dashboard's Last viewed / Jump back in */}
      <LastOpenedTracker />
      {children}
    </CourseShell>
  );
}
