"use client";

/**
 * Teacher workspace — REBUILT to the operator's vision (HUB-TEACHER-DASH
 * wave 1, trace 1a0ec61d5612aa6d: "The teacher dashboard (in syllabai-hub)
 * is not how I envisioned. All the tools, resources will be inside a certain
 * Subject/Class/Section. Basically the dashboard will look like student one,
 * but instead of subject it is a class card. Teacher will add class, then
 * select subjects. Then inside there, all the tools and course resources
 * will exist.").
 *
 * The anatomy now mirrors the student dashboard (src/app/dashboard/
 * dashboard-client.tsx) beat for beat, with CLASS as the card entity:
 *   1. Greeting header ("Hi {name} 👋" — the student dashboard's pattern)
 *   2. My classes — one card per class (SubjectCard parity): eyebrow, name,
 *      per-SUBJECT rows with real corpus counts from /api/course-stats,
 *      open-workspace link, remove X. The trailing slot card ("Got another
 *      class?") and the empty-state CTA open the add-class overlay (the
 *      add-course cascade, name + multi-subject).
 *   3. The old overview's sections moved INSIDE the class workspace
 *      (/teacher/classes/[id]) — that is the directive's whole point:
 *      tools and course resources live inside the class, not on the
 *      dashboard.
 *   4. TeacherNav stays (the marking / live-roster / intelligence surfaces
 *      are workspace chrome, not class content) + the compact honesty
 *      footnote carries the old overview's live-vs-demo provenance line.
 *
 * Honesty: a class here is a browser-local container (lib/teacher/
 * my-classes.ts — the same demo-truth class as the student's subject
 * roster); the live core roster (/teacher/classes, RBAC) is a separate,
 * database-backed surface and every label keeps them distinct.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Database,
  GraduationCap,
  Plus,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TeacherNav } from "@/components/teacher/teacher-nav";
import { useIdentity } from "@/lib/identity";
import { useMyClasses, type TeacherClass } from "@/lib/teacher/my-classes";
import { AddClassOverlay } from "./add-class-overlay";

/** The page passes the registry subset this dashboard renders. */
export interface TeacherCourseLite {
  slug: string;
  label: string;
  subject: string;
  code: string;
  level: string;
}

/** Same shape the student dashboard reads from /api/course-stats. */
interface CourseStat {
  slug: string;
  hasBundle: boolean;
  topics: number;
  notes: number;
  questionSets: number;
  questions: number;
  flashcards: number;
}

const ROADMAP = [
  { title: "Announcements", phase: "Phase 2" },
  { title: "At-Risk students (evidence-first)", phase: "Phase 3" },
  { title: "Reports & exports", phase: "Phase 3" },
  { title: "Roster & settings", phase: "Phase 3" },
  { title: "Teacher AI Assistant", phase: "Phase 3" },
  { title: "Data Assistant (structured analytics)", phase: "Phase 3" },
] as const;

function rowValue(value: number | undefined, unit: string) {
  if (value === undefined) return <Skeleton className="h-3 w-10" />;
  return (
    <span className="text-xs font-medium tabular-nums text-foreground">
      {value} {unit}
      {value === 1 ? "" : "s"}
    </span>
  );
}

/** One subject row on a class card — ResourceRow parity from the student
 *  dashboard (icon-ish dot, label, counts, chevron), navigating into the
 *  class workspace where that subject's tools and resources live. */
function SubjectRow({
  classId,
  label,
  code,
  stat,
}: {
  classId: string;
  label: string;
  code: string;
  stat: CourseStat | undefined;
}) {
  return (
    <li>
      <Link
        href={`/teacher/classes/${classId}`}
        className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{label}</span>
          <span className="block truncate font-mono text-[10px] text-muted-foreground">
            {code}
          </span>
        </span>
        {stat?.hasBundle ? (
          <span className="shrink-0 text-right text-[11px] leading-tight text-muted-foreground">
            {rowValue(stat.notes, "note")} · {rowValue(stat.questions, "question")} ·{" "}
            {rowValue(stat.flashcards, "card")}
          </span>
        ) : (
          <Skeleton className="h-3 w-24 shrink-0" />
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
      </Link>
    </li>
  );
}

function ClassCard({
  cls,
  bySlug,
  stats,
  onRemove,
  onEdit,
}: {
  cls: TeacherClass;
  bySlug: Map<string, TeacherCourseLite>;
  stats: Record<string, CourseStat>;
  onRemove: (id: string) => void;
  onEdit: (cls: TeacherClass) => void;
}) {
  // selection order preserved; unknown slugs filtered at render (registry truth)
  const subjects = cls.subjectSlugs
    .map((s) => bySlug.get(s))
    .filter((c): c is TeacherCourseLite => !!c);

  return (
    <Card className="relative h-full border-primary/25 transition-colors hover:border-primary/60">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove ${cls.name} from my classes`}
        onClick={() => onRemove(cls.id)}
        className="absolute top-1 right-1 size-9 rounded-full text-muted-foreground hover:text-destructive"
      >
        <X className="size-4" aria-hidden />
      </Button>
      <CardContent className="flex h-full flex-col gap-1 p-4 pr-11">
        {/* eyebrow (SubjectCard parity) */}
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Edexcel · {subjects.length} {subjects.length === 1 ? "subject" : "subjects"}
        </p>

        {/* class name */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/teacher/classes/${cls.id}`} className="group min-w-0">
            <span className="block truncate text-base font-bold group-hover:text-primary">
              {cls.name}
            </span>
          </Link>
        </div>

        <Link
          href={`/teacher/classes/${cls.id}`}
          className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          Open class workspace
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>

        {/* per-subject rows with real corpus counts (course-stats) */}
        {subjects.length > 0 ? (
          <ul className="mt-1 space-y-0.5 border-t pt-1">
            {subjects.map((c) => (
              <SubjectRow
                key={c.slug}
                classId={cls.id}
                label={c.subject}
                code={c.code || "code pending"}
                stat={stats[c.slug]}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
            No valid subjects left — edit the class to pick its lanes.
          </p>
        )}

        <div className="mt-auto flex items-center gap-2 pt-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => onEdit(cls)}
          >
            Edit subjects
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function TeacherClient({ courses }: { courses: TeacherCourseLite[] }) {
  const identity = useIdentity();
  const { classes, add, update, remove } = useMyClasses();
  const [addOpen, setAddOpen] = useState(false);
  const [editClass, setEditClass] = useState<TeacherClass | null>(null);
  const [stats, setStats] = useState<Record<string, CourseStat>>({});

  const bySlug = useMemo(() => {
    const m = new Map<string, TeacherCourseLite>();
    for (const c of courses) m.set(c.slug, c);
    return m;
  }, [courses]);

  // one course-stats read for the UNION of every class's subjects — the
  // student dashboard's slugsKey pattern verbatim
  const slugsKey = useMemo(
    () => [...new Set(classes.flatMap((c) => c.subjectSlugs))].sort().join(","),
    [classes],
  );

  useEffect(() => {
    if (!slugsKey) return;
    let cancelled = false;
    fetch(`/api/course-stats?slugs=${encodeURIComponent(slugsKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { stats?: Record<string, CourseStat> }) => {
        if (!cancelled && data.stats) setStats((prev) => ({ ...prev, ...data.stats }));
      })
      .catch(() => {
        /* keep previous stats; rows fall back to skeletons */
      });
    return () => {
      cancelled = true;
    };
  }, [slugsKey]);

  return (
    <div className="space-y-8">
      {/* greeting (student dashboard parity) */}
      <header className="space-y-1.5">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Hi {identity?.name ?? "there"} 👋
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Welcome to your teacher workspace — add a class, pick the subjects it covers, and every
          tool and course resource for them lives inside it. Marking review and class intelligence
          read live cohort data; the corpus tools run on the local sample bank.
        </p>
      </header>

      <TeacherNav />

      {/* ---- My classes ---- */}
      <section aria-label="My classes" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            My classes{" "}
            <span className="text-sm font-normal text-muted-foreground">· {classes.length}</span>
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              setEditClass(null);
              setAddOpen(true);
            }}
          >
            <Plus className="size-3.5" aria-hidden />
            Add class
          </Button>
        </div>

        {classes.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-start gap-3 p-6">
              <p className="flex items-center gap-2 text-sm font-medium">
                <GraduationCap className="size-4 text-primary" aria-hidden />
                No classes yet — add your first one.
              </p>
              <p className="text-sm text-muted-foreground">
                Name the class, then select the subjects it covers. The tools and course resources
                for those subjects live inside the class workspace.
              </p>
              <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                <Plus className="size-3.5" aria-hidden />
                Create a class
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((cls) => (
              <ClassCard
                key={cls.id}
                cls={cls}
                bySlug={bySlug}
                stats={stats}
                onRemove={remove}
                onEdit={(c) => {
                  setEditClass(c);
                  setAddOpen(true);
                }}
              />
            ))}
            {/* the student dashboard's trailing slot cell, class edition */}
            <button
              type="button"
              onClick={() => {
                setEditClass(null);
                setAddOpen(true);
              }}
              className="flex min-h-[10rem] flex-col items-start justify-center gap-2 rounded-xl border border-dashed border-muted-foreground/40 p-4 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-sm font-semibold">Got another class?</p>
              <p className="text-xs text-muted-foreground">
                Add a class, then select its subjects.
              </p>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Plus className="size-3.5" aria-hidden />
                Add class
              </span>
            </button>
          </div>
        )}
      </section>

      {/* remaining roadmap — compact (carried from the old overview) */}
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
            Classes on this dashboard are browser-local containers (the student roster works the
            same way); the live core roster with enrolled students is the{" "}
            <Link href="/teacher/classes" className="font-medium text-foreground underline underline-offset-2">
              Classes
            </Link>{" "}
            surface — marking review and class intelligence read live backend data (core RBAC on
            every call).{" "}
            {!identity && (
              <>
                Sign in from{" "}
                <Link href="/login" className="font-medium underline underline-offset-2">
                  /login
                </Link>{" "}
                as a teacher for the full experience.{" "}
              </>
            )}
            Full plan in{" "}
            {/* operator 2026-10-01 (trace 1a0f58b27d0572ed) "remaining
                outbound-link removals" — the GitHub hop is gone
                (HUB-OUTBOUND-FINAL): the doc path stays as plain text,
                label kept, hop dropped, same treatment as
                HUB-NOTES-SOURCE. */}
            <span className="font-medium text-foreground">docs/TEACHER_MODE_PLAN.md</span>
            .
          </span>
        </div>
        {identity && identity.role !== "teacher" && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden />
            You are signed in as a <strong>{identity.role}</strong> — this is the teacher mode.{" "}
            <Link href="/login" className="font-medium underline underline-offset-2">
              Switch role
            </Link>
          </p>
        )}
      </section>

      {/* ---- Add / edit class — name → board → subject multi-select ---- */}
      <AddClassOverlay
        open={addOpen}
        onOpenChange={(next) => {
          setAddOpen(next);
          if (!next) setEditClass(null);
        }}
        courses={courses}
        editClass={
          editClass
            ? { id: editClass.id, name: editClass.name, subjectSlugs: editClass.subjectSlugs }
            : null
        }
        onCreate={(name, subjectSlugs) => {
          add(name, subjectSlugs);
        }}
        onUpdate={(id, patch) => {
          update(id, patch);
        }}
      />
    </div>
  );
}
