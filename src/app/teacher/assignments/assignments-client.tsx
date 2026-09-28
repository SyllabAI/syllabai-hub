"use client";

/**
 * Assignments — teacher workspace (Phase 2, demo-truth).
 *
 * TEACHER_MODE_PLAN §5 Phase 2: "Assignments: build from question set/paper,
 * assign to class, due dates, completion tracking" — the full assignment
 * cycle, honestly simulated where real data does not exist yet:
 *   build   → the SAME marks-aware assembly the Test Builder uses
 *             (POST /api/teacher/assemble — real bank numbers),
 *   assign  → the SAMPLE class from the course payload,
 *   collect → the deterministic roster sim (roster.ts) correlated to the
 *             per-student mastery behind the class aggregates,
 *   review  → roster table + one-click remediation deep-link (§16).
 * Assignments persist locally (syllabai.assignments.v1); completion data is
 * computed, never stored, so it cannot drift from the class evidence.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Loader2,
  Plus,
  Printer,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TeacherNav } from "@/components/teacher/teacher-nav";
import { useIdentity } from "@/lib/identity";
import { useAssignments, useSavedTests, type Assignment } from "@/lib/teacher/stores";
import { SAMPLE_CLASS_SIZE } from "@/lib/teacher/class-sim";
import {
  buildRoster,
  simulateSubmissions,
  summarizeSubmissions,
  type RosterStudent,
} from "@/lib/teacher/roster";
import type { AssembledTest } from "@/lib/teacher/test-assembly";
import type { SwitchableCourse, TeacherCourseData } from "@/lib/teacher/types";
import { cn } from "@/lib/utils";

const DAY = 24 * 60 * 60 * 1000;

function fmtDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(ms),
  );
}

export function AssignmentsClient({
  courses,
  initialCourse,
  fromTest,
  initialSubtopics,
}: {
  courses: SwitchableCourse[];
  initialCourse: string | null;
  fromTest: string | null;
  initialSubtopics: string[];
}) {
  const identity = useIdentity();
  const [course, setCourse] = useState<string | null>(initialCourse);
  const [state, setState] = useState<{
    course: string;
    data?: TeacherCourseData;
    error?: string;
  } | null>(null);
  const loading = course !== null && state?.course !== course;
  const data = state?.course === course ? state.data : undefined;
  const loadError = state?.course === course ? state.error : undefined;

  const { assignments, create, setStatus, remove } = useAssignments();
  const { tests } = useSavedTests();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // builder state
  const [builderOpen, setBuilderOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState<string>(() =>
    new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [useMarksTarget, setUseMarksTarget] = useState(true);
  const [targetMarks, setTargetMarks] = useState("40");
  const [maxQuestions, setMaxQuestions] = useState("20");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // load the course payload per course switch (same pattern as Test Builder)
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

  // Deep-link prefill — "Assign this test" (Test Builder, subtopics param) or
  // a saved-test id (from=). Applies once the payload for the target course
  // has landed; async callbacks only, never sync state sets.
  const prefillRef = useRef<{ fromTest: string | null; subtopics: string[] } | null>(
    fromTest
      ? { fromTest, subtopics: [] }
      : initialSubtopics.length > 0
        ? { fromTest: null, subtopics: initialSubtopics }
        : null,
  );
  useEffect(() => {
    const prefill = prefillRef.current;
    if (!prefill || !data || !course) return;
    const valid = new Set(data.class.sections.flatMap((s) => s.subtopics.map((t) => t.code)));
    if (prefill.fromTest) {
      const saved = tests.find((t) => t.id === prefill.fromTest);
      if (!saved) {
        prefillRef.current = null;
        return;
      }
      if (saved.course !== course) return; // keep waiting for that course's payload
      setSelected(new Set(saved.subtopics.filter((c) => valid.has(c))));
      if (saved.targetMarks) {
        setUseMarksTarget(true);
        setTargetMarks(String(saved.targetMarks));
      } else if (saved.maxQuestions) {
        setUseMarksTarget(false);
        setMaxQuestions(String(saved.maxQuestions));
      }
    } else {
      setSelected(new Set(prefill.subtopics.filter((c) => valid.has(c))));
    }
    setBuilderOpen(true);
    prefillRef.current = null;
  }, [data, tests, course]);

  const allSubtopics = useMemo(
    () => data?.class.sections.flatMap((s) => s.subtopics) ?? [],
    [data],
  );
  const selectedMarks = useMemo(
    () => allSubtopics.filter((s) => selected.has(s.code)).reduce((a, s) => a + s.totalMarks, 0),
    [allSubtopics, selected],
  );

  // roster + per-assignment completion sim (deterministic, never stored)
  const roster: RosterStudent[] = useMemo(() => {
    if (!course || allSubtopics.length === 0) return [];
    return buildRoster(
      course,
      allSubtopics.map((s) => ({ code: s.code, anchorMean: s.anchorMean })),
    );
  }, [course, allSubtopics]);

  const forCourse = useMemo(
    () => assignments.filter((a) => (course ? a.courseId === course : true)),
    [assignments, course],
  );
  const sorted = useMemo(
    () =>
      [...forCourse].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    [forCourse],
  );
  const selectedAssignment = sorted.find((a) => a.id === selectedId) ?? null;

  const simFor = useCallback(
    (a: Assignment) =>
      simulateSubmissions(
        {
          id: a.id,
          marksTotal: a.marksTotal,
          dueAt: a.dueAt,
          subtopicCodes: a.subtopics.map((s) => s.code),
        },
        roster.length > 0 ? roster : buildRoster(a.courseId, a.subtopics.map((s) => ({ code: s.code, anchorMean: null }))),
      ),
    [roster],
  );

  const createAssignment = useCallback(async () => {
    if (!course || selected.size === 0 || !data) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/teacher/assemble", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: course,
          subtopics: [...selected],
          targetMarks: useMarksTarget ? Math.max(1, Number(targetMarks) || 0) || null : null,
          maxQuestions: useMarksTarget ? null : Math.max(1, Number(maxQuestions) || 20),
        }),
      });
      const payload = (await res.json()) as { test?: AssembledTest; error?: string };
      if (!res.ok || !payload.test) throw new Error(payload.error ?? "assembly failed");
      const test = payload.test;
      const meta = courses.find((c) => c.slug === course);
      const created = create({
        courseId: course,
        courseCode: meta?.code ?? test.course.code,
        courseLabel: meta?.label ?? test.course.label,
        title:
          title.trim() ||
          `${test.course.subject} — ${test.subtopics.map((s) => s.title).slice(0, 2).join(" · ")}`,
        className: data.class.className,
        subtopics: test.subtopics,
        targetMarks: useMarksTarget ? Number(targetMarks) || null : null,
        maxQuestions: useMarksTarget ? null : Number(maxQuestions) || null,
        marksTotal: test.totalMarks,
        questionCount: test.questions.length,
        dueAt: new Date(`${dueAt}T23:59:00`).toISOString(),
        status: "open",
      });
      setSelectedId(created.id);
      setTitle("");
      setSelected(new Set());
      setBuilderOpen(false);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "failed to assemble assignment");
    } finally {
      setCreating(false);
    }
  }, [course, selected, data, useMarksTarget, targetMarks, maxQuestions, title, dueAt, courses, create]);

  const weakestOf = useCallback(
    (a: Assignment) => {
      if (!data) return null;
      const codes = new Set(a.subtopics.map((s) => s.code));
      const subs = allSubtopics.filter((s) => codes.has(s.code));
      if (subs.length === 0) return null;
      return [...subs].sort((x, y) => x.meanMastery - y.meanMastery)[0];
    },
    [data, allSubtopics],
  );

  const current = courses.find((c) => c.slug === course) ?? null;

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1 text-[10px] font-normal">
            <ClipboardList className="size-3" aria-hidden />
            Assignments
          </Badge>
          <Badge variant="secondary" className="text-[10px] font-normal">
            Phase 2 · demo-truth
          </Badge>
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Assignments</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Build from the question bank, assign to the class, set a due date, and track completion —
          the full assignment cycle. Assembly uses the same marks-aware rules as the Test Builder;
          completion and scores are the deterministic SAMPLE roster sim until real accounts and
          server-side attempt events land (Phase 1 data foundation).
        </p>
      </div>

      <TeacherNav />

      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Course data unavailable</AlertTitle>
          <AlertDescription>
            {loadError}. The builder needs the course payload — switch subject and back to retry.
          </AlertDescription>
        </Alert>
      )}

      {/* subject selector */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            aria-label="Subject"
            value={course ?? ""}
            onChange={(e) => {
              setCourse(e.target.value || null);
              setSelectedId(null);
              setSelected(new Set());
            }}
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

      <Alert className="border-dashed">
        <ShieldCheck className="size-4" aria-hidden />
        <AlertTitle className="text-sm">SAMPLE cohort — simulated completion</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          {SAMPLE_CLASS_SIZE} simulated students, deterministically seeded from the same class
          evidence the Class knowledge graph shows. Names and submissions are SAMPLE; real
          completion tracking needs the Phase 1 write path (attempt events per student).
        </AlertDescription>
      </Alert>

      {/* builder */}
      <Card className="py-0">
        <CardContent className="p-5">
          <button
            type="button"
            onClick={() => setBuilderOpen((v) => !v)}
            aria-expanded={builderOpen}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Plus className="size-4 text-primary" aria-hidden />
              New assignment
            </span>
            <ChevronDown
              className={cn("size-4 text-muted-foreground transition-transform", builderOpen && "rotate-180")}
              aria-hidden
            />
          </button>

          {builderOpen && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="asg-title">Title</Label>
                  <Input
                    id="asg-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={`e.g. ${current?.label ?? "Course"} — targeted practice`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="asg-due">Due date</Label>
                  <Input
                    id="asg-due"
                    type="date"
                    value={dueAt}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDueAt(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="asg-marks">Target marks</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="asg-marks"
                      type="number"
                      min={1}
                      max={300}
                      value={targetMarks}
                      disabled={!useMarksTarget}
                      onChange={(e) => setTargetMarks(e.target.value)}
                      className="w-24"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={useMarksTarget}
                        onCheckedChange={(v) => setUseMarksTarget(v === true)}
                      />
                      use marks target instead
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={maxQuestions}
                      disabled={useMarksTarget}
                      onChange={(e) => setMaxQuestions(e.target.value)}
                      aria-label="Max questions"
                      className="w-20"
                    />
                  </div>
                </div>
                <p className="self-end text-xs text-muted-foreground">
                  {selected.size} subtopic{selected.size === 1 ? "" : "s"} selected ·{" "}
                  {selectedMarks} marks available in the bank
                </p>
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-xs font-medium">Target subtopics (from the class evidence)</legend>
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
                  {loading && <p className="p-2 text-xs text-muted-foreground">Loading course…</p>}
                  {allSubtopics
                    .slice()
                    .sort((a, b) => a.meanMastery - b.meanMastery)
                    .map((s) => (
                      <label
                        key={s.code}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/60"
                      >
                        <Checkbox
                          checked={selected.has(s.code)}
                          onCheckedChange={(v) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (v === true) next.add(s.code);
                              else next.delete(s.code);
                              return next;
                            })
                          }
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">{s.code}</span>
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {(s.meanMastery * 100).toFixed(0)}% · {s.questionCount}q
                        </span>
                      </label>
                    ))}
                  {!loading && !loadError && data && allSubtopics.length === 0 && (
                    <p className="p-2 text-xs text-muted-foreground">No subtopics for this course.</p>
                  )}
                </div>
              </fieldset>

              {createError && (
                <p className="text-xs font-medium text-destructive" role="alert">
                  {createError}
                </p>
              )}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={createAssignment}
                  disabled={creating || !course || selected.size === 0 || !dueAt}
                  className="gap-1.5"
                >
                  {creating ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="size-3.5" aria-hidden />
                  )}
                  Create assignment
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Assembles against the real bank — counts on the assignment are actual numbers.
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* assignment list */}
      <section aria-labelledby="asg-list">
        <h2 id="asg-list" className="text-sm font-semibold">
          Assignments for this subject
        </h2>
        {sorted.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
            No assignments yet for {current?.label ?? "this subject"} — create one above, or open a
            saved test in the Test Builder and use{" "}
            <span className="font-medium">Assign this test</span>.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {sorted.map((a) => {
              const sim = simFor(a);
              const summary = summarizeSubmissions(sim);
              const pct = Math.round(((summary.complete + summary.late) / sim.length) * 100);
              const overdue = a.status === "open" && Date.parse(a.dueAt) < Date.now();
              return (
                <li key={a.id}>
                  <Card
                    className={cn(
                      "cursor-pointer py-0 transition-shadow hover:shadow-md",
                      selectedId === a.id && "ring-1 ring-primary",
                    )}
                    onClick={() => setSelectedId(a.id === selectedId ? null : a.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{a.title}</p>
                        <Badge variant="outline" className="font-mono text-[10px] font-normal">
                          {a.courseCode}
                        </Badge>
                        {a.status === "closed" ? (
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            closed
                          </Badge>
                        ) : overdue ? (
                          <Badge variant="destructive" className="text-[10px] font-normal">
                            overdue
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            open
                          </Badge>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="size-3.5" aria-hidden />
                          due {fmtDate(a.dueAt)}
                        </span>
                        <span className="tabular-nums">
                          {a.questionCount} questions · {a.marksTotal} marks
                        </span>
                        <span className="tabular-nums">
                          {a.subtopics.length} subtopic{a.subtopics.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <div
                          className="h-1.5 w-40 overflow-hidden rounded-full bg-muted"
                          role="img"
                          aria-label={`completion ${pct}%`}
                        >
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {pct}% turned in
                          {summary.meanScore !== null && ` · mean ${summary.meanScore}/${a.marksTotal}`}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          SAMPLE completion
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* roster detail */}
      {selectedAssignment && (
        <section aria-labelledby="asg-detail">
          <h2 id="asg-detail" className="text-sm font-semibold">
            {selectedAssignment.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedAssignment.className} · due {fmtDate(selectedAssignment.dueAt)} ·{" "}
            {selectedAssignment.marksTotal} marks · targets{" "}
            {selectedAssignment.subtopics.map((s) => s.code).join(", ")}
          </p>
          {(() => {
            const sim = simFor(selectedAssignment);
            const summary = summarizeSubmissions(sim);
            const weak = weakestOf(selectedAssignment);
            return (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                    <CheckCircle2 className="size-3" aria-hidden /> {summary.complete} on time
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                    <CircleAlert className="size-3" aria-hidden /> {summary.late} late
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                    <XCircle className="size-3" aria-hidden /> {summary.missing} missing
                  </Badge>
                  {summary.meanScore !== null && (
                    <Badge variant="secondary" className="text-[10px] font-normal tabular-nums">
                      mean {summary.meanScore}/{selectedAssignment.marksTotal}
                    </Badge>
                  )}
                  {weak && (
                    <Button asChild size="sm" variant="outline" className="ml-auto gap-1.5">
                      <Link
                        href={`/teacher/test-builder?course=${selectedAssignment.courseId}&subtopics=${weak.code}`}
                      >
                        Build remediation test — {weak.code}
                      </Link>
                    </Button>
                  )}
                </div>

                <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Roster completion for {selectedAssignment.title}
                    </caption>
                    <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Student</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Score</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sim.map((s) => {
                        const student = roster[s.studentIndex];
                        return (
                          <tr key={s.studentIndex} className="border-t">
                            <td className="px-3 py-2">{student?.name ?? `Student ${s.studentIndex + 1}`}</td>
                            <td className="px-3 py-2">
                              {s.state === "complete" && (
                                <span className="flex items-center gap-1 text-xs">
                                  <CheckCircle2 className="size-3.5 text-primary" aria-hidden /> on time
                                </span>
                              )}
                              {s.state === "late" && (
                                <span className="flex items-center gap-1 text-xs">
                                  <CircleAlert className="size-3.5 text-amber-500" aria-hidden /> late
                                </span>
                              )}
                              {s.state === "missing" && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <XCircle className="size-3.5" aria-hidden /> missing
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {typeof s.score === "number"
                                ? `${s.score}/${selectedAssignment.marksTotal}`
                                : "—"}
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                              {s.submittedAt ? fmtDate(s.submittedAt) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <Link
                      href={`/teacher/test-builder?course=${selectedAssignment.courseId}&subtopics=${selectedAssignment.subtopics.map((s) => s.code).join(",")}`}
                    >
                      <Printer className="size-3.5" aria-hidden />
                      Print the paper (Test Builder)
                    </Link>
                  </Button>
                  {selectedAssignment.status === "open" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStatus(selectedAssignment.id, "closed")}
                    >
                      Close assignment
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStatus(selectedAssignment.id, "open")}
                    >
                      Reopen
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => {
                      remove(selectedAssignment.id);
                      setSelectedId(null);
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Delete
                  </Button>
                </div>
                {identity && identity.role !== "teacher" && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    You are signed in as a {identity.role} — assignments are a teacher surface.
                  </p>
                )}
              </>
            );
          })()}
        </section>
      )}
    </div>
  );
}
