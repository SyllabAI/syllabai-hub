"use client";

/**
 * Teacher workspace — subject-scoped overview (teacher-console tranche,
 * 2026-09-28: the marking queue and class intelligence now run on live core
 * data, completing the port of the last web-only capability).
 *
 * TEACHER_ARCHITECTURE.md §3: the teacher works subject-first, and §5:
 * teachers get subject-scoped access to the SAME resource families students
 * use (revision notes, exam questions, past papers, flashcards) plus
 * teacher-specific assessment/analytics surfaces. The overview therefore
 * shows, for the selected subject:
 *   1. the LIVE teacher console surfaces (marking review, class
 *      intelligence — real cohort data, RBAC on every call),
 *   2. the resource families deep-linking into the existing hub surfaces,
 *   3. the corpus-local tools (Test Builder, assignments, validation) with
 *      their honest SAMPLE/local framing,
 *   4. the remaining roadmap compactly.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Atom,
  BookOpen,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
    error?: string;
  } | null>(null);
  const data = state?.course === course ? state.data : undefined;
  const loadError = state?.course === course ? state.error : undefined;
  const loading = course !== null && state?.course !== course;

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
      .catch((err) => {
        // P2 honesty fix (demo port): a swallowed fetch error used to render
        // as a false empty state — the snapshot cards below would sit blank
        // with no explanation. Surface the failure instead.
        if (!cancelled)
          setState({
            course,
            error: err instanceof Error ? err.message : "failed to load course data",
          });
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
          {/* flex-wrap: the status badge's nowrap min-content is 260px; next to
              "Teacher mode" it ran 11px past a 375px phone. It drops to its own
              line below ~360px, no-op on desktop */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 text-[10px] font-normal">
              <Atom className="size-3" aria-hidden />
              Teacher mode
            </Badge>
            <Badge variant="secondary" className="text-[10px] font-normal">
              marking + class intelligence live · corpus tools demo
            </Badge>
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Teacher workspace
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            A role-specific operating surface on the same academic substrate the students use — the
            marking console and class intelligence read live cohort data from the backend; the
            corpus tools stay subject-scoped and local (spec:{" "}
            <span className="font-mono text-xs">TEACHER_ARCHITECTURE.md</span>).
          </p>
        </div>

        {/* identity card — min-w-0 matters: without it the card's
            min-width:auto is its full min-content (a nowrap email can't
            shrink), pushing it 130px past a 375px viewport; with it the
            card wraps + truncates instead */}
        {identity ? (
          <div className="flex min-w-0 max-w-full items-center gap-3 rounded-lg border bg-card px-3 py-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
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
              className="ml-2 h-8 shrink-0 text-xs text-muted-foreground"
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

      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Course data unavailable</AlertTitle>
          <AlertDescription>
            {loadError}. The snapshot cards below are blank because the request failed — switch
            subject and back to retry.
          </AlertDescription>
        </Alert>
      )}

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
          Class: {loading ? "…" : loadError ? "unavailable" : (data?.class.className ?? "—")}
        </span>
      </div>

      {/* live teacher console — ported from the web console (2026-09-28) */}
      <section aria-labelledby="teacher-console">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="teacher-console" className="text-sm font-semibold">
            Teacher console
          </h2>
          <span className="text-[11px] text-muted-foreground">
            live cohort data — the same surfaces the internal web console served, now on the hub
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
                The Smart Mark review queue grouped by paper, human-mark overrides with per-point
                decisions, the κ agreement gate and marking throughput — every number a backend
                read model, never an estimate.
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
                Topic heatmap, weak prerequisites, drill-down to affected learners and evidence,
                remediation assembly, and the class knowledge graph — mastery from graded BKT
                evidence, misconceptions from BDT estimates, unmeasured reads unmeasured.
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

      {/* corpus-local tools — honest SAMPLE framing kept */}
      <section aria-labelledby="teacher-surfaces">
        <h2 id="teacher-surfaces" className="text-sm font-semibold">
          Corpus tools
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            local question-bank surfaces (demo-truth data)
          </span>
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
            Marking review and class intelligence read live backend data (core RBAC on every
            call); the corpus tools above still run on the local SAMPLE data-provider seam. Full
            plan in{" "}
            <a
              href="https://github.com/SyllabAI/syllabai-hub/blob/main/docs/TEACHER_MODE_PLAN.md"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground underline underline-offset-2"
            >
              docs/TEACHER_MODE_PLAN.md
            </a>
            . Production surfaces enforce authorization at the backend boundary (ADR-027).
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
