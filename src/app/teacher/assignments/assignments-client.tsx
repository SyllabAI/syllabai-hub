"use client";

/**
 * Assignments — teacher workspace (core-backed, ADR-029 tranche 4.10).
 *
 * The full assignment cycle, now on the learner model's own contract:
 *   build   → the SAME marks-aware assembly the Test Builder uses
 *             (POST /api/teacher/assemble — real bank numbers),
 *   assign  → POST /api/v1/teacher/assignments registers the assignment on
 *             core with FAIL-CLOSED target validation (every spec ref must
 *             resolve to a curriculum-structure node below the subject root),
 *   collect → real hand-in evidence (V49 append-only submissions; latest row
 *             per learner is the current state),
 *   review  → the REAL roster — every enabled student, computed
 *             complete/late/missing — replacing the retired SAMPLE roster sim.
 *
 * Honesty rules: errors are surfaced, never mirrored to localStorage (a
 * hand-in that only reached one browser would be a lie); a hand-in is
 * completion evidence and NEVER mastery (attempts remain the mastery path);
 * the cohort is every enabled student account — computed on core, never
 * stored, so it cannot drift from identity truth.
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
import { api, ApiError } from "@/lib/api";
import type {
  AssignmentRosterView,
  AssignmentSummaryView,
} from "@/lib/types";
import { useSavedTests } from "@/lib/teacher/stores";
import type { AssembledTest } from "@/lib/teacher/test-assembly";
import type { SwitchableCourse, TeacherCourseData } from "@/lib/teacher/types";
import { cn } from "@/lib/utils";

const DAY = 24 * 60 * 60 * 1000;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(ms),
  );
}

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
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
  const [course, setCourse] = useState<string | null>(initialCourse);
  const [state, setState] = useState<{
    course: string;
    data?: TeacherCourseData;
    error?: string;
  } | null>(null);
  const loading = course !== null && state?.course !== course;
  const data = state?.course === course ? state.data : undefined;
  const loadError = state?.course === course ? state.error : undefined;

  const { tests } = useSavedTests();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // core-backed assignment list (all courses, newest first — filtered below)
  const [listRows, setListRows] = useState<AssignmentSummaryView[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [roster, setRoster] = useState<AssignmentRosterView | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

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

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      setListRows(await api.teacherAssignments());
    } catch (err: unknown) {
      setListError(apiMessage(err, "Assignments are unavailable right now — core did not answer."));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // lazily pull the real roster for the selected assignment
  useEffect(() => {
    if (!selectedId) {
      setRoster(null);
      setRosterError(null);
      return;
    }
    let cancelled = false;
    setRosterLoading(true);
    setRosterError(null);
    api
      .teacherAssignmentRoster(selectedId)
      .then((view) => {
        if (!cancelled) setRoster(view);
      })
      .catch((err: unknown) => {
        if (!cancelled) setRosterError(apiMessage(err, "The roster is unavailable right now."));
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

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

  const forCourse = useMemo(
    () =>
      course ? listRows.filter((r) => r.assignment.courseSlug === course) : listRows,
    [listRows, course],
  );
  const selectedSummary =
    forCourse.find((r) => r.assignment.id === selectedId) ??
    listRows.find((r) => r.assignment.id === selectedId) ??
    null;

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
      // register on core — the two-party record the learner will see.
      // No localStorage fallback: an assignment one browser kept to itself
      // would be a lie every other surface would tell differently.
      const created = await api.teacherCreateAssignment({
        title:
          title.trim() ||
          `${test.course.subject} — ${test.subtopics.map((s) => s.title).slice(0, 2).join(" · ")}`,
        courseSlug: course,
        courseLabel: meta?.label ?? test.course.label,
        specRefs: test.subtopics.map((s) => s.code),
        marksTotal: test.totalMarks,
        questionCount: test.questions.length,
        dueAt: new Date(`${dueAt}T23:59:00`).toISOString(),
      });
      await loadList();
      setSelectedId(created.id);
      setTitle("");
      setSelected(new Set());
      setBuilderOpen(false);
    } catch (err: unknown) {
      setCreateError(apiMessage(err, "failed to register the assignment on core"));
    } finally {
      setCreating(false);
    }
  }, [course, selected, data, useMarksTarget, targetMarks, maxQuestions, title, dueAt, courses, loadList]);

  const flipStatus = useCallback(
    async (id: string, status: "open" | "closed") => {
      setStatusBusy(true);
      setStatusError(null);
      try {
        await api.teacherSetAssignmentStatus(id, status);
        await loadList();
        if (selectedId === id) {
          setRoster((prev) =>
            prev && prev.assignment.id === id
              ? { ...prev, assignment: { ...prev.assignment, status } }
              : prev,
          );
        }
      } catch (err: unknown) {
        setStatusError(apiMessage(err, "could not change the assignment status"));
      } finally {
        setStatusBusy(false);
      }
    },
    [loadList, selectedId],
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
            core-backed · live
          </Badge>
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Assignments</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Build from the question bank, assign to your cohort, set a due date, and track real
          completion — the full assignment cycle on your SyllabAI account. Assembly uses the same
          marks-aware rules as the Test Builder; the roster and completion data below are real
          learner hand-ins recorded on core (the SAMPLE roster sim is retired).
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
          Cohort: every enabled student account on core
        </span>
      </div>

      <Alert className="border-dashed">
        <ShieldCheck className="size-4" aria-hidden />
        <AlertTitle className="text-sm">Real completion — and its honest boundary</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          Completion rows are learner hand-ins on their SyllabAI accounts: who handed in, when, and
          the work summary they attached. A hand-in is completion evidence only — it never writes
          mastery; mastery still comes from marked attempts through the attempt pipeline. Learners
          can re-hand-in (improved work) — the latest hand-in is the current state.
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
                  Assembles against the real bank, then registers on your SyllabAI account —
                  learners see it on their My Progress page.
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
        {listError && (
          <Alert variant="destructive" className="mt-3">
            <AlertTitle>Assignments unavailable</AlertTitle>
            <AlertDescription>{listError}</AlertDescription>
          </Alert>
        )}
        {listLoading && !listError && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading assignments from core…
          </p>
        )}
        {!listLoading && !listError && forCourse.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
            No assignments yet for {current?.label ?? "this subject"} — create one above, or open a
            saved test in the Test Builder and use{" "}
            <span className="font-medium">Assign this test</span>.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {forCourse.map(({ assignment: a, submitted, late, missing, meanScore }) => {
              const cohort = submitted + missing;
              const pct = cohort > 0 ? Math.round((submitted / cohort) * 100) : 0;
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
                          {a.courseSlug}
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
                          {a.specRefs.length} subtopic{a.specRefs.length === 1 ? "" : "s"}
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
                          {submitted}/{cohort} handed in
                          {late > 0 && ` · ${late} late`}
                          {meanScore !== null && ` · mean ${Math.round(meanScore * 10) / 10}/${a.marksTotal}`}
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
      {selectedSummary && (
        <section aria-labelledby="asg-detail">
          <h2 id="asg-detail" className="text-sm font-semibold">
            {selectedSummary.assignment.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedSummary.assignment.courseLabel} · due{" "}
            {fmtDate(selectedSummary.assignment.dueAt)} ·{" "}
            {selectedSummary.assignment.marksTotal} marks · targets{" "}
            {selectedSummary.assignment.specRefs.join(", ")}
          </p>

          {statusError && (
            <p className="mt-2 text-xs font-medium text-destructive" role="alert">
              {statusError}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 text-[10px] font-normal">
              <CheckCircle2 className="size-3" aria-hidden /> {selectedSummary.submitted} handed in
            </Badge>
            <Badge variant="outline" className="gap-1 text-[10px] font-normal">
              <CircleAlert className="size-3" aria-hidden /> {selectedSummary.late} late
            </Badge>
            <Badge variant="outline" className="gap-1 text-[10px] font-normal">
              <XCircle className="size-3" aria-hidden /> {selectedSummary.missing} missing
            </Badge>
            {selectedSummary.meanScore !== null && (
              <Badge variant="secondary" className="text-[10px] font-normal tabular-nums">
                mean {Math.round(selectedSummary.meanScore * 10) / 10}/
                {selectedSummary.assignment.marksTotal}
              </Badge>
            )}
          </div>

          {rosterLoading && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading the roster…
            </p>
          )}
          {rosterError && (
            <p className="mt-3 text-xs font-medium text-destructive" role="alert">
              {rosterError}
            </p>
          )}

          {roster && !rosterLoading && (
            <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Roster completion for {roster.assignment.title}
                </caption>
                <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Student</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Done</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Score</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.rows.map((r) => (
                    <tr key={r.learnerId} className="border-t">
                      <td className="px-3 py-2">{r.displayName}</td>
                      <td className="px-3 py-2">
                        {r.state === "complete" && (
                          <span className="flex items-center gap-1 text-xs">
                            <CheckCircle2 className="size-3.5 text-primary" aria-hidden /> on time
                          </span>
                        )}
                        {r.state === "late" && (
                          <span className="flex items-center gap-1 text-xs">
                            <CircleAlert className="size-3.5 text-amber-500" aria-hidden /> late
                          </span>
                        )}
                        {r.state === "missing" && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <XCircle className="size-3.5" aria-hidden /> missing
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.questionsCompleted !== null
                          ? `${r.questionsCompleted}/${roster.assignment.questionCount}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.score !== null ? `${r.score}/${roster.assignment.marksTotal}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                        {fmtDate(r.submittedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link
                href={`/teacher/test-builder?course=${selectedSummary.assignment.courseSlug}&subtopics=${selectedSummary.assignment.specRefs.join(",")}`}
              >
                <Printer className="size-3.5" aria-hidden />
                Print the paper (Test Builder)
              </Link>
            </Button>
            {selectedSummary.assignment.status === "open" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={statusBusy}
                onClick={() => flipStatus(selectedSummary.assignment.id, "closed")}
              >
                Close assignment
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={statusBusy}
                onClick={() => flipStatus(selectedSummary.assignment.id, "open")}
              >
                Reopen
              </Button>
            )}
            <span className="self-center text-[11px] text-muted-foreground">
              Assignments are workflow records on core — close instead of delete, so a learner&apos;s
              handed-in evidence keeps its context.
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
