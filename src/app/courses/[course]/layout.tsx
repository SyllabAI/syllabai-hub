import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { listCourses, loadHubCourse } from "@/lib/courses";
import { hasPastPapers } from "@/lib/past-papers";
import { courseHasCorpusPapers } from "@/lib/pastpapers-corpus";
import { CourseShell, type SidebarData } from "@/components/hub/course-shell";
import { LastOpenedTracker } from "@/components/hub/last-opened-tracker";

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
 *
 * Static-serving (ADR-021 perf pass, tranche 4.12): the corpus is committed
 * and immutable between deploys, and nothing in this tree reads session
 * state server-side (verified: no cookies()/headers() under src/app/courses
 * or src/components/hub — the shell's sign-in state is client-side), so the
 * former blanket force-dynamic (a demo-era inheritance — every course page
 * was ƒ server-rendered per request, zero CDN HTML) is gone. The layout
 * enumerates all registered course slugs at build; child pages prerender
 * what they enumerate (index pages: every course; detail pages: the pilot)
 * and render on-demand otherwise — unknown slugs still 404 pre-flush on the
 * on-demand path, so the s133 soft-404 fix holds verbatim.
 */
export async function generateStaticParams() {
  const courses = await listCourses();
  return courses.filter((c) => c.hasBundle).map((c) => ({ course: c.slug }));
}

// UX audit 2026-10-02 #14: every /courses/[course]/* page shared the root
// <title> — the tab read the same on the dashboard and 40 levels deep in a
// chemistry deck. The course label flows through the root template.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ course: string }>;
}): Promise<Metadata> {
  const { course: slug } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) return {};
  return { title: hub.meta.label };
}

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
