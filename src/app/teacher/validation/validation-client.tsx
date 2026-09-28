"use client";

/**
 * Validation queue — teacher workspace (Phase 2, demo-truth).
 *
 * TEACHER_MODE_PLAN §5 Phase 2: "AI content validation queue: teacher
 * approves/edits AI-marked answers and AI-generated notes before they count
 * (corpus pipeline already anticipates a teacher-validation step)".
 *
 * The queue lists REAL corpus items — AI-authored model solutions from the
 * committed question bank (GET /api/teacher/validation-queue) — and records
 * the teacher's verdict (ContentReview, plan §4: resourceId / reviewer /
 * verdict / comment) in syllabai.contentReviews.v1. Reviewing is a real
 * workflow over real content; the "before it counts" enforcement and the
 * write path are the Phase 1 data foundation, so verdicts stay local for now
 * (honest, on-screen).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileCheck2,
  Loader2,
  Pencil,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TeacherNav } from "@/components/teacher/teacher-nav";
import { useIdentity } from "@/lib/identity";
import { useContentReviews, type ReviewVerdict } from "@/lib/teacher/stores";
import type { SwitchableCourse } from "@/lib/teacher/types";
import { cn } from "@/lib/utils";

interface QueueItem {
  resourceId: string;
  kind: "solution";
  courseId: string;
  courseLabel: string;
  courseCode: string;
  topicSlug: string;
  topicName: string;
  subCode: string;
  subTitle: string;
  href: string;
  part: {
    resourceId: string;
    questionId: string;
    partId: string;
    commandWord: string | null;
    questionType: string | null;
    marks: number;
    problemExcerpt: string;
    solutionExcerpt: string;
  };
}

interface QueuePayload {
  course: { slug: string; label: string; code: string };
  items: QueueItem[];
}

const VERDICT_META: Record<ReviewVerdict, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  approved: { label: "approved", icon: CheckCircle2, cls: "text-primary" },
  edited: { label: "edited & approved", icon: Pencil, cls: "text-amber-500" },
  rejected: { label: "rejected", icon: XCircle, cls: "text-destructive" },
};

function fmtWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function ValidationClient({
  courses,
  initialCourse,
}: {
  courses: SwitchableCourse[];
  initialCourse: string | null;
}) {
  const identity = useIdentity();
  const [course, setCourse] = useState<string | null>(initialCourse);
  const [state, setState] = useState<{
    course: string;
    data?: QueuePayload;
    error?: string;
  } | null>(null);
  const loading = course !== null && state?.course !== course;
  const data = state?.course === course ? state.data : undefined;
  const loadError = state?.course === course ? state.error : undefined;

  const { reviews, add, remove } = useContentReviews();
  // Per-item comment drafts. A single shared string would leak one row's text
  // into every other pending row (and into whatever verdict is committed next).
  const [comments, setComments] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reviewedOpen, setReviewedOpen] = useState(true);

  useEffect(() => {
    if (!course) return;
    let cancelled = false;
    fetch(`/api/teacher/validation-queue?slug=${encodeURIComponent(course)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("unavailable");
        return (await res.json()) as QueuePayload;
      })
      .then((payload) => {
        if (!cancelled) setState({ course, data: payload });
      })
      .catch((err) => {
        if (!cancelled)
          setState({
            course,
            error: err instanceof Error ? err.message : "failed to load the validation queue",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [course]);

  const reviewedByResource = useMemo(() => {
    const map = new Map<string, "approved" | "edited" | "rejected">();
    for (const r of reviews) map.set(r.resourceId, r.verdict);
    return map;
  }, [reviews]);

  const pending = useMemo(
    () => (data?.items ?? []).filter((i) => !reviewedByResource.has(i.resourceId)),
    [data, reviewedByResource],
  );
  const reviewedHere = useMemo(
    () =>
      reviews.filter((r) => r.courseId === course).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [reviews, course],
  );

  const verdict = useCallback(
    (item: QueueItem, v: ReviewVerdict) => {
      setPendingId(item.resourceId);
      const rowComment = (comments[item.resourceId] ?? "").trim();
      // brief round-trip so the row's transition is perceptible, then commit
      window.setTimeout(() => {
        add({
          resourceId: item.resourceId,
          courseId: item.courseId,
          courseCode: item.courseCode,
          kind: item.kind,
          verdict: v,
          comment: rowComment,
          reviewer: identity?.name ?? "teacher",
        });
        setComments((prev) => {
          if (!(item.resourceId in prev)) return prev;
          const next = { ...prev };
          delete next[item.resourceId];
          return next;
        });
        setPendingId(null);
      }, 350);
    },
    [add, comments, identity],
  );

  const current = courses.find((c) => c.slug === course) ?? null;

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1 text-[10px] font-normal">
            <FileCheck2 className="size-3" aria-hidden />
            Validation
          </Badge>
          <Badge variant="secondary" className="text-[10px] font-normal">
            Phase 2 · demo-truth
          </Badge>
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          AI content validation
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The teacher gate in the content loop: AI-authored model solutions are reviewed before
          they count toward mastery. The queue lists real items from the committed question bank —
          nothing is invented. Verdicts persist locally in the demo until the write path exists
          (Phase 1 data foundation); in production this queue is backed by{" "}
          <span className="font-mono text-xs">ContentReview</span> and enforced at the pipeline
          boundary.
        </p>
      </div>

      <TeacherNav />

      {/* subject selector */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            aria-label="Subject"
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
          {loading
            ? "loading queue…"
            : loadError
              ? "queue unavailable"
              : `${pending.length} item${pending.length === 1 ? "" : "s"} pending`}
        </span>
      </div>

      <Alert className="border-dashed">
        <ShieldCheck className="size-4" aria-hidden />
        <AlertTitle className="text-sm">Real items, demo workflow</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          Each item is an actual AI-authored model solution from the corpus (problem + solution
          excerpts, marks, spec links). Approve, edit &amp; approve, or reject with a comment —
          verdicts are stored locally in this demo and supersede earlier verdicts on the same item.
        </AlertDescription>
      </Alert>

      {loadError && (
        <Alert variant="destructive">
          <XCircle className="size-4" aria-hidden />
          <AlertTitle className="text-sm">Couldn&rsquo;t load the validation queue</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            {loadError}. Check the connection, then switch subject and back to retry.
          </AlertDescription>
        </Alert>
      )}

      {/* queue */}
      <section aria-labelledby="vq-queue">
        <h2 id="vq-queue" className="text-sm font-semibold">
          Pending review
        </h2>
        {loading && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> loading queue…
          </p>
        )}
        {!loading && !loadError && data && pending.length === 0 && (
          <p className="mt-3 rounded-lg border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
            {data.items.length === 0
              ? "This course has no AI-authored model solutions in the bank."
              : "Queue clear — every item for this subject has a verdict. Switch subject to review more."}
          </p>
        )}
        <ul className="mt-3 space-y-3">
          {pending.map((item) => (
            <li key={item.resourceId}>
              <Card className="py-0">
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px] font-normal">
                      {item.subCode}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {item.subTitle} · {item.topicName}
                    </span>
                    <Badge variant="secondary" className="text-[10px] font-normal tabular-nums">
                      {item.part.marks} mark{item.part.marks === 1 ? "" : "s"}
                    </Badge>
                    {item.part.commandWord && (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {item.part.commandWord}
                      </Badge>
                    )}
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      open in Exam Questions
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </div>

                  <p className="rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
                    <span className="font-medium">Problem: </span>
                    {item.part.problemExcerpt}
                  </p>
                  <p className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed">
                    <span className="font-medium">AI model solution under review: </span>
                    {item.part.solutionExcerpt}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={`cmt-${item.part.partId}`} className="sr-only">
                      Review comment
                    </Label>
                    <Input
                      id={`cmt-${item.part.partId}`}
                      value={comments[item.resourceId] ?? ""}
                      onChange={(e) =>
                        setComments((prev) => ({ ...prev, [item.resourceId]: e.target.value }))
                      }
                      placeholder="Optional comment for the pipeline log…"
                      className="h-8 min-w-56 flex-1 text-xs"
                    />
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1"
                        disabled={pendingId === item.resourceId}
                        onClick={() => verdict(item, "approved")}
                      >
                        <CheckCircle2 className="size-3.5" aria-hidden />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1"
                        disabled={pendingId === item.resourceId}
                        onClick={() => verdict(item, "edited")}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        Edit &amp; approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1 text-destructive hover:text-destructive"
                        disabled={pendingId === item.resourceId}
                        onClick={() => verdict(item, "rejected")}
                      >
                        <XCircle className="size-3.5" aria-hidden />
                        Reject
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {/* reviewed log */}
      <section aria-labelledby="vq-reviewed">
        <button
          type="button"
          onClick={() => setReviewedOpen((v) => !v)}
          aria-expanded={reviewedOpen}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <h2 id="vq-reviewed" className="flex items-center gap-2 text-sm font-semibold">
            <BadgeCheck className="size-4 text-primary" aria-hidden />
            Your verdicts for this subject ({reviewedHere.length})
          </h2>
          <ChevronDown
            className={cn("size-4 text-muted-foreground transition-transform", reviewedOpen && "rotate-180")}
            aria-hidden
          />
        </button>
        {reviewedOpen && (
          <div className="mt-3">
            {reviewedHere.length === 0 ? (
              <p className="rounded-lg border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
                No verdicts recorded yet for {current?.label ?? "this subject"}.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {reviewedHere.map((r) => {
                  const meta = VERDICT_META[r.verdict];
                  const Icon = meta.icon;
                  return (
                    <li
                      key={r.resourceId}
                      className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs"
                    >
                      <Icon className={cn("size-3.5", meta.cls)} aria-hidden />
                      <span className="font-medium">{meta.label}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{r.courseCode}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {r.comment ? `“${r.comment}”` : r.resourceId}
                      </span>
                      <span className="tabular-nums text-[10px] text-muted-foreground">
                        {fmtWhen(r.createdAt)} · {r.reviewer}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        aria-label="Withdraw verdict (item returns to the queue)"
                        onClick={() => remove(r.resourceId)}
                      >
                        <Trash2 className="size-3" aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
