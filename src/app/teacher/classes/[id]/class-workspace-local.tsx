"use client";

/**
 * Local class workspace — "inside there, all the tools and course resources
 * exist" (HUB-TEACHER-DASH wave 1, operator trace 1a0ec61d5612aa6d).
 *
 * Wave 2 (operator trace 1a0ec95548b5f1e1 "The teacher should also have a
 * knowledge graph view right?"): the per-subject Knowledge Graph joins the
 * resource rows — the same graph students open from the course hub,
 * deep-linked /knowledge-graph?course=<slug>. The graph is a property of
 * the SUBJECT (operator decision, trace 1a0e8568eb6bb545 — no course
 * switcher); the cohort-level class KG heatmap stays the core-class surface
 * (F-072, /teacher/classes/[id]/knowledge-graph — untouched here).
 *
 * Wave 3 (operator trace 1a0f0e078fde5fb1 "Add a class-level 'My Class
 * Geography Progress' view next to the core class KG heatmap, or add badges
 * to the KG cards if a subject doesn't have a corpus package"): BOTH. (1)
 * A "My Class Geography Progress" class-level section links the new
 * /teacher/classes/[id]/geography page — the LOCAL container's corpus
 * coverage map (canonical spec tree + per-subtopic notes/questions/
 * flashcards from /api/teacher/class-geography). It is explicitly NOT
 * mastery: cohort mastery stays core's heatmap + the T-C37 drill chain,
 * so core ids landing on that page get a pointer, never a second graph.
 * (2) Resource cards render an honest "no corpus package" badge instead of
 * an eternal Skeleton when the course-stats payload says hasBundle=false.
 *
 * One section per subject the class covers, in selection order:
 *   - course resource rows into the SAME hub surfaces students use
 *     (revision notes, exam questions, flashcards, and the per-subject
 *     Knowledge Graph) with real corpus counts from /api/course-stats;
 *   - the corpus-local teacher tools scoped to that subject (Test Builder,
 *     assignments, validation — ?course= deep links, honest SAMPLE badges
 *     carried from the old overview verbatim).
 *
 * Class-level: the LIVE teacher console links (marking review, class
 * intelligence — core RBAC surfaces) and the roster pointer to the core
 * Classes workspace. The honesty box states the split plainly: this
 * container is browser-local; the live roster is core's.
 *
 * The class can be edited (same AddClassOverlay in edit mode), removed
 * (returns to the dashboard), and a class that lost every subject renders
 * an honest empty state with the edit CTA.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Database,
  FileCheck2,
  FileQuestion,
  LibraryBig,
  ListChecks,
  Map as MapIcon,
  Network,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyClasses } from "@/lib/teacher/my-classes";
import { AddClassOverlay } from "../../add-class-overlay";
import type { TeacherCourseLite } from "../../teacher-client";

interface CourseStat {
  slug: string;
  hasBundle: boolean;
  topics: number;
  notes: number;
  questionSets: number;
  questions: number;
  flashcards: number;
}

const RESOURCES = [
  { key: "notes", href: (slug: string) => `/courses/${slug}/revision-notes`, icon: BookOpen, label: "Revision Notes" },
  { key: "questions", href: (slug: string) => `/courses/${slug}/exam-questions`, icon: FileQuestion, label: "Exam Questions" },
  { key: "flashcards", href: (slug: string) => `/courses/${slug}/flashcards`, icon: LibraryBig, label: "Flashcards" },
  // wave 2 — the per-subject knowledge graph, the exact deep link the course
  // hub uses; the count is the course-stats TOPIC node census (an honest
  // corpus number from the same payload the other cards read).
  {
    key: "graph",
    countKey: "topics",
    href: (slug: string) => `/knowledge-graph?course=${slug}`,
    icon: Network,
    label: "Knowledge Graph",
    countLabel: "topics in the corpus",
  },
] as const;

const TOOLS = [
  {
    href: (slug: string) => `/teacher/test-builder?course=${slug}`,
    icon: ClipboardList,
    title: "Test Builder",
    desc: "Assemble a printable, marks-aware test from the committed question bank — target the class's weakest areas, answer key included.",
    badge: "§6",
  },
  {
    href: (slug: string) => `/teacher/assignments?course=${slug}`,
    icon: ListChecks,
    title: "Assignments",
    desc: "Build from the bank, assign with a due date, track completion on the SAMPLE roster, remediate in one click.",
    badge: "Phase 2",
  },
  {
    href: (slug: string) => `/teacher/validation?course=${slug}`,
    icon: FileCheck2,
    title: "AI content validation",
    desc: "Review real AI-authored model solutions from the bank and record approve / edit / reject verdicts before they count.",
    badge: "Phase 2",
  },
] as const;

function countOf(stat: CourseStat | undefined, key: string): number | undefined {
  if (!stat?.hasBundle) return undefined;
  return (stat as unknown as Record<string, number>)[key];
}

/** Exported for the dispatcher: a local- id the store does not know is a
 *  removed/expired container — honest card, never a shell, never a core
 *  fall-through. */
export function LocalClassMissing() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm font-medium">This class is no longer on this browser.</p>
        <Button asChild size="sm" variant="outline">
          <Link href="/teacher">Back to My classes</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function LocalClassWorkspace({
  classId,
  courses,
}: {
  classId: string;
  /** the server-passed registry subset (page.tsx listCourses — same payload
   *  the dashboard renders; no new API surface invented for this) */
  courses: TeacherCourseLite[];
}) {
  const router = useRouter();
  const { get, update, remove } = useMyClasses();
  const cls = get(classId);
  const [editOpen, setEditOpen] = useState(false);
  const [stats, setStats] = useState<Record<string, CourseStat>>({});

  const slugsKey = useMemo(() => (cls ? cls.subjectSlugs.join(",") : ""), [cls]);

  useEffect(() => {
    if (!slugsKey) return;
    let cancelled = false;
    fetch(`/api/course-stats?slugs=${encodeURIComponent(slugsKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { stats?: Record<string, CourseStat> }) => {
        if (!cancelled && data.stats) setStats((prev) => ({ ...prev, ...data.stats }));
      })
      .catch(() => {
        /* rows fall back to skeletons */
      });
    return () => {
      cancelled = true;
    };
  }, [slugsKey]);

  if (!cls) {
    return <LocalClassMissing />;
  }

  const bySlug = new Map(courses.map((c) => [c.slug, c]));
  const subjects = cls.subjectSlugs.map((s) => bySlug.get(s)).filter((c): c is TeacherCourseLite => !!c);
  const unknownSlugs = cls.subjectSlugs.filter((s) => !bySlug.has(s));

  return (
    <div className="space-y-8">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 text-[10px] font-normal">
              <Users className="size-3" aria-hidden />
              Class workspace
            </Badge>
            <Badge variant="secondary" className="text-[10px] font-normal">
              browser-local container
            </Badge>
          </div>
          <h1 className="mt-2 truncate font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {cls.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {subjects.length > 0
              ? `Covering ${subjects.length} ${subjects.length === 1 ? "subject" : "subjects"} — every tool and course resource for them lives here.`
              : "No subjects selected yet."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" aria-hidden />
            Edit subjects
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-destructive"
            onClick={() => {
              remove(cls.id);
              router.push("/teacher");
            }}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Remove class
          </Button>
        </div>
      </div>

      {/* live teacher console — global surfaces, class-adjacent */}
      <section aria-labelledby="live-console">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="live-console" className="text-sm font-semibold">
            Live teacher console
          </h2>
          <span className="text-[11px] text-muted-foreground">
            live cohort data — core RBAC on every call
          </span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Card className="py-0 transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10">
                  <ClipboardCheck className="size-4 text-primary" aria-hidden />
                </span>
                <Badge variant="outline" className="border-success/40 text-success text-[10px] font-normal">
                  live
                </Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold">Marking review</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                The Smart Mark review queue, human-mark overrides, the κ agreement gate and marking
                throughput — every number a backend read model, never an estimate.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3 gap-1.5">
                <Link href="/teacher/marking">
                  Open the marking queue
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
          <Card className="py-0 transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10">
                  <Network className="size-4 text-primary" aria-hidden />
                </span>
                <Badge variant="outline" className="border-success/40 text-success text-[10px] font-normal">
                  live
                </Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold">Class intelligence</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Topic heatmap, weak prerequisites, drill-down to affected learners, remediation
                assembly and the class knowledge graph — mastery from graded BKT evidence.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3 gap-1.5">
                <Link href="/teacher/class">
                  Open class intelligence
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* class geography — the LOCAL container's corpus-coverage map (wave 3,
          operator trace 1a0f0e078fde5fb1). Browser-local, like the class
          itself; cohort mastery stays on the core heatmap surfaces. */}
      <section aria-labelledby="class-geography">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="class-geography" className="text-sm font-semibold">
            My Class Geography Progress
          </h2>
          <span className="text-[11px] text-muted-foreground">
            corpus coverage per subtopic — not learner mastery
          </span>
        </div>
        <div className="mt-3">
          <Card className="py-0 transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10">
                  <MapIcon className="size-4 text-primary" aria-hidden />
                </span>
                <Badge variant="outline" className="text-[10px] font-normal">
                  browser-local
                </Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold">Geography progress</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Every subject&apos;s spec tree — topic by subtopic — with the notes, exam
                questions and flashcards behind each one, and the honest gaps. Cohort mastery is
                the core heatmap&apos;s surface.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3 gap-1.5">
                <Link href={`/teacher/classes/${cls.id}/geography`}>
                  Open geography progress
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* per-subject sections — the directive's core */}
      {subjects.length === 0 && unknownSlugs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm font-medium">This class has no subjects yet.</p>
            <p className="text-sm text-muted-foreground">
              Edit the class to select the subjects it covers — the tools and course resources for
              each one will live here.
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => setEditOpen(true)}>
              <Pencil className="size-3.5" aria-hidden />
              Select subjects
            </Button>
          </CardContent>
        </Card>
      ) : (
        subjects.map((c) => {
          const stat = stats[c.slug];
          return (
            <section key={c.slug} aria-labelledby={`subj-${c.slug}`} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id={`subj-${c.slug}`} className="text-lg font-semibold">
                    {c.subject}
                  </h2>
                  <p className="font-mono text-xs text-muted-foreground">
                    {c.code || "code pending"} · {c.level}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <Link href={`/courses/${c.slug}`}>
                    Open the course hub
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </Button>
              </div>

              {/* course resources — the same families students use (the
                  knowledge graph joined in wave 2) */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {RESOURCES.map((r) => {
                  const count = countOf(stat, "countKey" in r ? r.countKey : r.key);
                  return (
                    <Link
                      key={r.key}
                      href={r.href(c.slug)}
                      className="group rounded-lg border bg-card p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex size-9 items-center justify-center rounded-md bg-muted">
                        <r.icon className="size-4" aria-hidden />
                      </span>
                      <p className="mt-3 flex items-center gap-1 text-sm font-semibold">
                        {r.label}
                        <ArrowRight
                          className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        {stat && !stat.hasBundle ? (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            no corpus package
                          </Badge>
                        ) : count === undefined ? (
                          <Skeleton className="inline-block h-3 w-16" />
                        ) : "countLabel" in r ? (
                          `${count} ${r.countLabel}`
                        ) : (
                          `${count} in the corpus`
                        )}
                      </p>
                    </Link>
                  );
                })}
              </div>

              {/* corpus-local teacher tools, scoped to this subject */}
              <div className="grid gap-3 sm:grid-cols-3">
                {TOOLS.map((t) => (
                  <Card key={t.title} className="py-0 transition-shadow hover:shadow-md">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex size-9 items-center justify-center rounded-md bg-primary/10">
                          <t.icon className="size-4 text-primary" aria-hidden />
                        </span>
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {t.badge}
                        </Badge>
                      </div>
                      <h3 className="mt-3 text-sm font-semibold">{t.title}</h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
                      <Button asChild size="sm" variant="outline" className="mt-3 gap-1.5">
                        <Link href={t.href(c.slug)}>
                          Open
                          <ArrowRight className="size-3.5" aria-hidden />
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          );
        })
      )}

      {unknownSlugs.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {unknownSlugs.length} subject {unknownSlugs.length === 1 ? "slug" : "slugs"} no longer in
          the registry ({unknownSlugs.join(", ")}) — edit the class to refresh its lanes.
        </p>
      )}

      {/* roster pointer + honesty */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/teacher/classes">
              <Users className="size-3.5" aria-hidden />
              Live rosters (core) — enroll students by email
            </Link>
          </Button>
        </div>
        <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          <Database className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            This class container lives in this browser, like the student&apos;s subject roster — it
            is not visible to students or other teachers. Enrolled-student rosters, announcements
            and live cohort analytics are core surfaces:{" "}
            <Link href="/teacher/classes" className="font-medium text-foreground underline underline-offset-2">
              Classes
            </Link>{" "}
            and{" "}
            <Link href="/teacher/class" className="font-medium text-foreground underline underline-offset-2">
              Class intelligence
            </Link>
            .
          </span>
        </div>
      </div>

      <AddClassOverlay
        open={editOpen}
        onOpenChange={setEditOpen}
        courses={courses}
        editClass={{ id: cls.id, name: cls.name, subjectSlugs: cls.subjectSlugs }}
        onCreate={() => {
          /* edit mode — creation is the dashboard's concern */
        }}
        onUpdate={(id, patch) => {
          update(id, patch);
        }}
      />
    </div>
  );
}
