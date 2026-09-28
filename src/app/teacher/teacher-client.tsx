"use client";

/**
 * Teacher workspace — subject-scoped overview (TEACHER-2 rework of the
 * TEACHER-1 planned-modules mockup).
 *
 * TEACHER_ARCHITECTURE.md §3: the teacher works subject-first, and §5:
 * teachers get subject-scoped access to the SAME resource families students
 * use (revision notes, exam questions, past papers, flashcards) plus
 * teacher-specific assessment/analytics surfaces. The overview therefore
 * shows, for the selected subject:
 *   1. the SAMPLE cohort snapshot (honest: simulated evidence),
 *   2. the resource families deep-linking into the existing hub surfaces,
 *   3. the teacher-specific surfaces (Test Builder, class knowledge graph),
 *   4. the remaining roadmap (assignments, validation, reports…) compactly.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Atom,
  BookOpen,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Database,
  FileCheck2,
  FileQuestion,
  GraduationCap,
  LibraryBig,
  ListChecks,
  Network,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TeacherNav } from "@/components/teacher/teacher-nav";
import { clearIdentity, useIdentity } from "@/lib/identity";
import type { TeacherCourseData } from "@/lib/teacher/types";
import type { SwitchableCourse } from "@/lib/teacher/types";
import { cn } from "@/lib/utils";

const ROADMAP = [
  { title: "Announcements", phase: "Phase 2" },
  { title: "At-Risk students (evidence-first)", phase: "Phase 3" },
  { title: "Reports & exports", phase: "Phase 3" },
  { title: "Roster & settings", phase: "Phase 3" },
  { title: "Teacher AI Assistant", phase: "Phase 3" },
  { title: "Data Assistant (structured analytics)", phase: "Phase 3" },
] as const;

const RESOURCES = [
  {
    href: "/revision-notes",
    icon: BookOpen,
    title: "Revision Notes",
    desc: "Spec-anchored notes with worked examples and exam hints.",
  },
  {
    href: "/exam-questions",
    icon: FileQuestion,
    title: "Exam Questions",
    desc: "Exam-style sets by subtopic with mark schemes and AI marking.",
  },
  {
    href: "/flashcards",
    icon: CircleHelp,
    title: "Flashcards",
    desc: "Per-subtopic decks with still-learning / know ratings.",
  },
  {
    href: "/past-papers",
    icon: LibraryBig,
    title: "Past Papers",
    desc: "Reconstructed papers where source provenance attests.",
  },
] as const;

export function TeacherClient({
  courses,
  initialCourse,
}: {
  courses: SwitchableCourse[];
  initialCourse: string | null;
}) {
  const identity = useIdentity();
  const isTeacher = identity?.role === "teacher";
  const [course, setCourse] = useState<string | null>(initialCourse);
  // course-tagged payload state; loading derives from it (no sync setState)
  const [state, setState] = useState<{
    course: string;
    data?: TeacherCourseData;
    error?: boolean;
  } | null>(null);
  const loading = course !== null && state?.course !== course;
  const data = state?.course === course ? state.data : undefined;
  const loadFailed = state?.course === course ? Boolean(state.error) : false;

  useEffect(() => {
    if (!course) return;
    let cancelled = false;
    fetch(`/api/teacher/course-data?slug=${encodeURIComponent(course)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("unavailable");
        return (await res.json()) as TeacherCourseData;
      })
      .then((payload) => {
        if (!cancelled) setState({ course, data: payload });
      })
      .catch(() => {
        if (!cancelled) setState({ course, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [course]);

  const hub = (rest: string) => `/courses/${course ?? ""}${rest}`;
  const current = useMemo(
    () => courses.find((c) => c.slug === course) ?? null,
    [courses, course],
  );

  return (
    <div className="space-y-8">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 text-[10px] font-normal">
              <Atom className="size-3" aria-hidden />
              Teacher mode
            </Badge>
            <Badge variant="secondary" className="text-[10px] font-normal">
              demo workspace
            </Badge>
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Teacher workspace
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            A role-specific operating surface on the same academic substrate the students use —
            subject-scoped resources, the Test Builder, and a class lens over the knowledge graph
            (spec: <span className="font-mono text-xs">TEACHER_ARCHITECTURE.md</span>).
          </p>
        </div>

        {identity ? (
          <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
            <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {identity.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{identity.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {identity.email} · signed in as {identity.role}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="ml-2 h-8 text-xs text-muted-foreground"
              onClick={() => clearIdentity()}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/login">
              <GraduationCap className="size-3.5" aria-hidden />
              Sign in as a teacher
            </Link>
          </Button>
        )}
      </div>

      <TeacherNav />

      {/* subject selector — teachers work subject-first (§3) */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            aria-label="Teaching subject"
            value={course ?? ""}
            onChange={(e) => setCourse(e.target.value || null)}
            className="h-9 w-full appearance-none rounded-md border bg-background pr-8 pl-3 text-sm sm:w-80"
          >
            {courses.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label} ({c.code})
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
        {current && (
          <Badge variant="outline" className="gap-1 font-mono text-[10px] font-normal">
            {current.code} · {current.level}
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground">
          Class: {data?.class.className ?? "—"}
        </span>
      </div>

      {/* cohort snapshot */}
      <section aria-labelledby="cohort-snapshot">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="cohort-snapshot" className="text-sm font-semibold">
            Cohort snapshot
          </h2>
          <span className="text-[11px] text-muted-foreground">
            SAMPLE data — simulated evidence; real analytics need accounts + server-side progress
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card className="py-0">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Students</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {loading ? "…" : (data?.class.students ?? "—")}
              </p>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Class mean mastery</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {loading ? "…" : data ? `${(data.class.classMean * 100).toFixed(0)}%` : "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardContent className="p-4 min-w-0">
              <p className="text-xs text-muted-foreground">Weakest area</p>
              {loading ? (
                <p className="mt-1 text-2xl">…</p>
              ) : data?.class.weakest ? (
                <>
                  <p className="mt-1 truncate text-sm font-semibold" title={data.class.weakest.title}>
                    {data.class.weakest.code} {data.class.weakest.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(data.class.weakest.meanMastery * 100).toFixed(0)}% mean
                  </p>
                </>
              ) : (
                <p className="mt-1 text-2xl">—</p>
              )}
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Question bank</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {loading ? "…" : (data?.bank.totalQuestions ?? "—")}
              </p>
              <p className="text-[10px] text-muted-foreground">
                validated corpus questions
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* teacher-specific surfaces */}
      <section aria-labelledby="teacher-surfaces">
        <h2 id="teacher-surfaces" className="text-sm font-semibold">
          Teacher surfaces
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Card className="py-0 transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10">
                  <ClipboardList className="size-4 text-primary" aria-hidden />
                </span>
                <Badge variant="outline" className="text-[10px] font-normal">
                  §6
                </Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold">Test Builder</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Assemble a printable, marks-aware test from the committed question bank — target
                the class&apos;s weakest areas, include the answer key, print-ready.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3 gap-1.5">
                <Link href={course ? `/teacher/test-builder?course=${course}` : "/teacher/test-builder"}>
                  Open Test Builder
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
                <Badge variant="outline" className="text-[10px] font-normal">
                  §13
                </Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold">Class knowledge graph</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                The teacher lens over the same subject graph: teaching coverage × class
                understanding bands, distributions, misconceptions, and one-click remediation.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3 gap-1.5">
                <Link href={course ? `/teacher/class-graph?course=${course}` : "/teacher/class-graph"}>
                  Open the class lens
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
          <Card className="py-0 transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10">
                  <ListChecks className="size-4 text-primary" aria-hidden />
                </span>
                <Badge variant="outline" className="text-[10px] font-normal">
                  Phase 2
                </Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold">Assignments</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                The full cycle: build from the bank (same assembly rules as the Test Builder),
                assign with a due date, track completion on the SAMPLE roster, remediate in one
                click.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3 gap-1.5">
                <Link href={course ? `/teacher/assignments?course=${course}` : "/teacher/assignments"}>
                  Open assignments
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
          <Card className="py-0 transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10">
                  <FileCheck2 className="size-4 text-primary" aria-hidden />
                </span>
                <Badge variant="outline" className="text-[10px] font-normal">
                  Phase 2
                </Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold">AI content validation</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                The teacher gate in the content loop: review real AI-authored model solutions from
                the bank and record approve / edit / reject verdicts before they count.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3 gap-1.5">
                <Link href={course ? `/teacher/validation?course=${course}` : "/teacher/validation"}>
                  Open the validation queue
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* resource access — the same families students use (§5) */}
      <section aria-labelledby="resource-access">
        <h2 id="resource-access" className="text-sm font-semibold">
          {current ? `${current.label} resources` : "Course resources"}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            same surfaces students use, opened in teacher context
          </span>
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {RESOURCES.map((r) => (
            <Link
              key={r.href}
              href={hub(r.href)}
              className={cn(
                "group rounded-lg border bg-card p-4 transition-shadow hover:shadow-md",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="flex size-9 items-center justify-center rounded-md bg-muted">
                <r.icon className="size-4" aria-hidden />
              </span>
              <p className="mt-3 flex items-center gap-1 text-sm font-semibold">
                {r.title}
                <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.desc}</p>
            </Link>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href={hub("")}>
              <GraduationCap className="size-3.5" aria-hidden />
              Open the full course hub
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/tutor">
              <Sparkles className="size-3.5" aria-hidden />
              AI Tutor (grounded in this corpus)
            </Link>
          </Button>
        </div>
      </section>

      {/* remaining roadmap — compact */}
      <section aria-labelledby="teacher-roadmap">
        <h2 id="teacher-roadmap" className="text-sm font-semibold">
          Still on the teacher roadmap
        </h2>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {ROADMAP.map((item) => (
            <li
              key={item.title}
              className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground"
            >
              {item.title}
              <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal">
                {item.phase}
              </Badge>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          <Database className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Data foundation still to build: real accounts with roles, server-side attempt events
            replacing the localStorage progress overlay, and write APIs in the read-only
            data-provider seam. Full plan in{" "}
            <a
              href="https://github.com/SyllabAI/syllabai-hub/blob/main/docs/TEACHER_MODE_PLAN.md"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground underline underline-offset-2"
            >
              docs/TEACHER_MODE_PLAN.md
            </a>
            . Teacher access is demo-local; production surfaces enforce authorization at the
            backend boundary (ADR-027).
          </span>
        </div>
        {!isTeacher && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden />
            Tip: sign in as a teacher from{" "}
            <Link href="/login" className="font-medium underline underline-offset-2">
              /login
            </Link>{" "}
            for the full mock-identity experience.
          </p>
        )}
      </section>
    </div>
  );
}
