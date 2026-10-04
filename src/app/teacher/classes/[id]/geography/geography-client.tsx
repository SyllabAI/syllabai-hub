"use client";

/**
 * My Class Geography Progress (HUB-TEACHER-DASH wave 3, operator trace
 * 1a0f0e078fde5fb1 — "Add a class-level 'My Class Geography Progress' view
 * next to the core class KG heatmap").
 *
 * The LOCAL class container's corpus-coverage surface: every subject the
 * class covers renders its canonical spec tree — SUBJECT → TOPICS →
 * SUBTOPICS — with per-subtopic coverage counts (notes / exam questions /
 * flashcards) from /api/teacher/class-geography, which composes the same
 * spec-tree machinery the revision-notes index uses. Zero-invention
 * discipline: no coverage number is estimated; a subtopic with nothing
 * behind it says so.
 *
 * The honesty boundary is the product: this is CORPUS COVERAGE (what
 * teaching material exists), NOT learner mastery. A local container has no
 * students and no graded evidence — cohort mastery lives on the core class
 * KG heatmap (+ the T-C37 drill chain). Core class ids get an honest
 * pointer there instead of a second mastery graph; unknown local- ids get
 * the same missing-class card the workspace dispatcher renders.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  FileQuestion,
  LibraryBig,
  Map as MapIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyClasses } from "@/lib/teacher/my-classes";
import type { TeacherCourseLite } from "../../../teacher-client";
import { LocalClassMissing } from "../class-workspace-local";

interface GeographySubtopic {
  code: string;
  label: string;
  title: string;
  specPoints: number;
  notes: number;
  questions: number;
  flashcards: number;
}

interface GeographyTopic {
  code: string;
  number: number;
  title: string;
  specPoints: number;
  subtopics: GeographySubtopic[];
}

interface CourseGeography {
  slug: string;
  hasBundle: boolean;
  subjectTitle: string | null;
  specPoints: number;
  topics: GeographyTopic[];
}

function CoverageChip({
  icon: Icon,
  n,
}: {
  icon: typeof BookOpen;
  n: number;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[11px] tabular-nums ${
        n === 0 ? "text-muted-foreground/50" : "text-foreground"
      }`}
    >
      <Icon className="size-3" aria-hidden />
      {n}
    </span>
  );
}

function GeographyView({
  classId,
  cls,
  courses,
}: {
  classId: string;
  cls: { id: string; name: string; subjectSlugs: string[] };
  courses: TeacherCourseLite[];
}) {
  const [geo, setGeo] = useState<Record<string, CourseGeography>>({});
  const [failed, setFailed] = useState(false);

  const slugsKey = useMemo(() => cls.subjectSlugs.join(","), [cls]);

  useEffect(() => {
    if (!slugsKey) return;
    let cancelled = false;
    fetch(`/api/teacher/class-geography?slugs=${encodeURIComponent(slugsKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { courses: CourseGeography[] }) => {
        if (cancelled) return;
        const next: Record<string, CourseGeography> = {};
        for (const c of d.courses ?? []) next[c.slug] = c;
        setGeo((prev) => ({ ...prev, ...next }));
        setFailed(false);
      })
      .catch(() => {
        /* sections stay on skeletons — honest, no invented map */
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slugsKey]);

  const bySlug = useMemo(() => {
    const m = new Map<string, TeacherCourseLite>();
    for (const c of courses) m.set(c.slug, c);
    return m;
  }, [courses]);

  const covered = cls.subjectSlugs.filter((s) => bySlug.has(s));
  const unknownSlugs = cls.subjectSlugs.filter((s) => !bySlug.has(s));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/teacher/classes/${classId}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back to the class workspace
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {cls.name} — geography progress
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            My Class Geography Progress — the curriculum map for every subject this class covers,
            with the corpus behind each subtopic.
          </p>
        </div>
        <Badge variant="outline" className="font-mono text-[10px]">
          {covered.length} subject{covered.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        <MapIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          This view is <strong className="font-medium text-foreground">corpus coverage</strong> —
          which subtopics have notes, exam questions and flashcards behind them. It is{" "}
          <strong className="font-medium text-foreground">not learner mastery</strong>: a class
          container here has no students and no graded evidence. Cohort mastery is the core
          heatmap&apos;s surface —{" "}
          <Link href="/teacher/class" className="font-medium text-foreground underline underline-offset-2">
            Class insights
          </Link>{" "}
          reads it from graded BKT evidence.
        </span>
      </div>

      {failed && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-sm text-muted-foreground">
            The geography data path failed — no invented map is shown. Reload to retry.
          </CardContent>
        </Card>
      )}

      {covered.map((slug) => {
        const meta = bySlug.get(slug)!;
        const g = geo[slug];
        return (
          <section key={slug} aria-labelledby={`geo-${slug}`} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 id={`geo-${slug}`} className="text-lg font-semibold">
                  {meta.subject}
                </h2>
                <p className="font-mono text-xs text-muted-foreground">
                  {meta.code || "code pending"} · {meta.level}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {g && !g.hasBundle ? (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    no corpus package
                  </Badge>
                ) : g ? (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {g.specPoints} spec points · {g.topics.length} topics
                  </Badge>
                ) : null}
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <Link href={`/knowledge-graph?course=${slug}`}>
                    Knowledge graph
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </Button>
              </div>
            </div>

            {!g ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-64" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : !g.hasBundle ? (
                <Card className="border-dashed">
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    No corpus package for this subject — there is no map to draw yet, and none is
                    invented here.
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {(g.topics ?? []).map((t) => (
                    <Card key={t.code} className="py-0">
                      <CardContent className="p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-sm font-semibold">
                            {t.number}. {t.title}
                          </h3>
                          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                            {t.specPoints} spec points
                          </span>
                        </div>
                        <ul className="mt-2 divide-y">
                          {t.subtopics.map((s) => {
                            const bare = s.notes + s.questions + s.flashcards === 0;
                            return (
                              <li
                                key={s.code}
                                className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                              >
                                <span
                                  className={`min-w-0 text-xs ${
                                    bare ? "text-muted-foreground/60" : "text-foreground"
                                  }`}
                                >
                                  <span className="font-mono">{s.label}</span> · {s.title}
                                  <span className="ml-2 font-mono text-[10px] text-muted-foreground/70">
                                    {s.specPoints} SP
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-3">
                                  {bare ? (
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                                      no coverage yet
                                    </span>
                                  ) : null}
                                  <CoverageChip icon={BookOpen} n={s.notes} />
                                  <CoverageChip icon={FileQuestion} n={s.questions} />
                                  <CoverageChip icon={LibraryBig} n={s.flashcards} />
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                  {g.topics.length === 0 && (
                    <Card className="border-dashed">
                      <CardContent className="p-6 text-sm text-muted-foreground">
                        The bundle has no topic tree — nothing to map.
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </section>
          );
        })}

      {unknownSlugs.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {unknownSlugs.length} subject {unknownSlugs.length === 1 ? "slug" : "slugs"} no longer in
          the registry ({unknownSlugs.join(", ")}) — edit the class in its workspace to refresh its
          lanes.
        </p>
      )}
    </div>
  );
}

export function ClassGeographyClient({
  classId,
  courses,
}: {
  classId: string;
  courses: TeacherCourseLite[];
}) {
  const { get } = useMyClasses();
  const cls = classId.startsWith("local-") ? get(classId) : undefined;

  if (classId.startsWith("local-")) {
    return cls ? (
      <GeographyView classId={classId} cls={cls} courses={courses} />
    ) : (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <LocalClassMissing />
      </div>
    );
  }

  // core class id — the honest pointer: mastery geography already exists on
  // the core surfaces; no second mastery graph is built here.
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm font-medium">This is a core class — its geography lives on the core surfaces.</p>
          <p className="text-sm text-muted-foreground">
            Core classes have enrolled students and graded evidence, so their map is the class KG
            heatmap (coverage × understanding over the cohort) with the drill-down to affected
            learners — not a corpus-coverage list. Open it from the class workspace.
          </p>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link href={`/teacher/classes/${classId}`}>
              Open the core class workspace
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
