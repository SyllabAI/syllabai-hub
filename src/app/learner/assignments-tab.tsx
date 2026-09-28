"use client";

/**
 * Learner Assignments tab (V49 — the "assignments → core contract" tranche,
 * ADR-029 4.10): the learner side of the two-party workflow. Lists the
 * assignments the teachers set (newest first, straight from core with MY
 * hand-in beside each), deep-links each target subtopic into the existing
 * practice flow (?spec= redirect → the canonical question set), and hands in
 * with the learner's REAL recorded work attached.
 *
 * Honesty rules:
 *   - The hand-in payload is DERIVED from this browser's recorded work on the
 *     assignment's subtopics (questions practiced + self-marked score) — the
 *     counts state what they count, they are never typed in by hand.
 *   - A hand-in is completion evidence ONLY — it never writes mastery
 *     (mastery still comes from marked attempts through the attempt
 *     pipeline); the teacher's roster sees the same fact.
 *   - Errors are surfaced (core unreachable / closed window) — a hand-in that
 *     only reached localStorage would be a lie the teacher's roster couldn't
 *     see. Re-hand-in is allowed: an improved score is new evidence, the
 *     latest row is the current state.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  ExternalLink,
  Loader2,
  Send,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import type { LearnerAssignmentView } from "@/lib/types";
import { useAllCourseProgress, type CourseProgress } from "@/lib/progress";
import { coreEvidenceChanged } from "@/lib/attempt-bridge";
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

/** the work this browser has actually recorded for a set of subtopic codes */
function deriveWork(progress: CourseProgress | undefined, specRefs: string[]) {
  const refs = new Set(specRefs);
  const done = new Set<string>();
  let selfMarked = 0;
  if (progress) {
    for (const [questionId, rec] of Object.entries(progress.selfScores)) {
      if (rec.subtopic && refs.has(rec.subtopic)) {
        done.add(questionId);
        selfMarked += rec.score;
      }
    }
    for (const [questionId, rec] of Object.entries(progress.mcqAnswers)) {
      if (rec.subtopic && refs.has(rec.subtopic)) done.add(questionId);
    }
  }
  return { questionsCompleted: done.size, selfMarked };
}

export function AssignmentsTab() {
  const [rows, setRows] = useState<LearnerAssignmentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [handInError, setHandInError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.learnerAssignments());
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Assignments are unavailable right now — core did not answer.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const slugs = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.assignment.courseSlug))],
    [rows],
  );
  const progressByCourse = useAllCourseProgress(slugs);

  const handIn = useCallback(
    async (view: LearnerAssignmentView) => {
      const { assignment } = view;
      const { questionsCompleted, selfMarked } = deriveWork(
        progressByCourse[assignment.courseSlug],
        assignment.specRefs,
      );
      const capped = Math.min(questionsCompleted, assignment.questionCount);
      if (capped === 0) return;
      setBusyId(assignment.id);
      setHandInError(null);
      try {
        await api.submitAssignmentSubmission(assignment.id, {
          questionsCompleted: capped,
          score: selfMarked > 0 ? Math.min(selfMarked, assignment.marksTotal) : null,
        });
        coreEvidenceChanged();
        await load();
      } catch (err: unknown) {
        setHandInError(
          err instanceof ApiError
            ? err.message
            : "The hand-in could not be recorded — try again in a moment.",
        );
      } finally {
        setBusyId(null);
      }
    },
    [progressByCourse, load],
  );

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading assignments…
      </p>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-6 text-center">
        <p className="text-sm font-medium">Assignments unavailable right now</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center">
        <p className="text-sm font-medium">No assignments yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
          When a teacher sets work for your cohort it appears here, with practice links and a
          hand-in that records what you actually did.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
        Work your teachers set, straight from your SyllabAI account. Hand in records what this
        browser recorded for the target subtopics — it is completion evidence only and never writes
        mastery; your practice still feeds the measured model through attempts.
      </p>

      {handInError && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {handInError}
        </p>
      )}

      {rows.map((view) => {
        const { assignment: a, mySubmission } = view;
        const overdue = a.status === "open" && Date.parse(a.dueAt) < Date.now();
        const dueSoon =
          a.status === "open" &&
          !overdue &&
          Date.parse(a.dueAt) - Date.now() < 3 * DAY;
        const late =
          mySubmission !== null && Date.parse(mySubmission.submittedAt) > Date.parse(a.dueAt);
        const open = openId === a.id;
        const { questionsCompleted, selfMarked } = deriveWork(
          progressByCourse[a.courseSlug],
          a.specRefs,
        );
        const capped = Math.min(questionsCompleted, a.questionCount);
        const score = selfMarked > 0 ? Math.min(selfMarked, a.marksTotal) : null;
        return (
          <Card key={a.id} className="py-0">
            <CardContent className="p-4">
              <button
                type="button"
                onClick={() => {
                  setOpenId(open ? null : a.id);
                  setHandInError(null);
                }}
                aria-expanded={open}
                className="flex w-full items-start justify-between gap-2 text-left"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <ClipboardList className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="text-sm font-semibold">{a.title}</span>
                    <Badge variant="outline" className="font-mono text-[10px] font-normal">
                      {a.courseLabel}
                    </Badge>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="size-3.5" aria-hidden />
                      due {fmtDate(a.dueAt)}
                    </span>
                    <span className="tabular-nums">
                      {a.questionCount} questions · {a.marksTotal} marks
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {a.status === "closed" ? (
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      closed
                    </Badge>
                  ) : overdue ? (
                    <Badge variant="destructive" className="text-[10px] font-normal">
                      overdue
                    </Badge>
                  ) : dueSoon ? (
                    <Badge variant="outline" className="text-[10px] font-normal text-warn">
                      due soon
                    </Badge>
                  ) : null}
                  {mySubmission === null ? (
                    <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                      <XCircle className="size-3" aria-hidden /> not handed in
                    </Badge>
                  ) : late ? (
                    <Badge variant="outline" className="gap-1 text-[10px] font-normal text-warn">
                      <CircleAlert className="size-3" aria-hidden /> handed in late
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-[10px] font-normal text-primary">
                      <CheckCircle2 className="size-3" aria-hidden /> handed in
                    </Badge>
                  )}
                  <ChevronDown
                    className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
                    aria-hidden
                  />
                </span>
              </button>

              {open && (
                <div className="mt-3 space-y-3 border-t pt-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-muted-foreground">Practice:</span>
                    {a.specRefs.map((code) => (
                      <a
                        key={code}
                        href={`/courses/${a.courseSlug}/exam-questions?spec=${encodeURIComponent(code)}`}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px] hover:bg-muted/60"
                      >
                        {code}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ))}
                  </div>

                  {mySubmission !== null && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Current hand-in:</span>{" "}
                      {mySubmission.questionsCompleted}/{a.questionCount} questions
                      {mySubmission.score !== null &&
                        ` · self-marked ${mySubmission.score}/${a.marksTotal}`}{" "}
                      · {fmtDate(mySubmission.submittedAt)}
                    </p>
                  )}

                  {a.status === "open" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={busyId === a.id || capped === 0}
                        onClick={() => void handIn(view)}
                      >
                        {busyId === a.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Send className="size-3.5" aria-hidden />
                        )}
                        {mySubmission === null ? "Hand in" : "Update hand-in"}
                      </Button>
                      <span className="max-w-md text-[11px] leading-relaxed text-muted-foreground">
                        {capped === 0
                          ? "Practice the target subtopics first — hand-in attaches the work this browser recorded."
                          : `Will record ${capped}/${a.questionCount} questions practiced${score !== null ? ` with self-marked ${score}/${a.marksTotal}` : " (no self-marked score yet)"}. Re-hand-in after more practice — the latest counts.`}
                      </span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      This assignment is closed — no new hand-ins. Your recorded hand-in stays on
                      your account.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
