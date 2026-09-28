"use client";

/**
 * Teacher marking console — ported from syllabai-web's TeacherReviewView
 * (T-029, Master Spec §6.10/§15/§22) onto the hub (teacher-console tranche,
 * 2026-09-28): class list, Smart Mark review queue, human-mark overrides and
 * the κ agreement gate, all reading live core data.
 *
 * Everything here is a projection of backend read models — no business rules.
 * The backend enforces /api/v1/teacher/** (TEACHER/ADMIN via @PreAuthorize);
 * the UI role check that gates this route is an affordance, never
 * authorization.
 *
 * Honesty rules carried over from the backend read models:
 * - smart-mark failures render their failure reason (e.g. PROVIDER_UNAVAILABLE),
 *   never a fabricated score;
 * - per-point decisions are only offered when a smart-mark breakdown exists
 *   (the κ pairing needs them);
 * - κ states are explicit: none recorded yet / not enough paired decisions;
 * - a 500 / network failure is NOT "none recorded" — the reason is surfaced.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClipboardCheck,
  ClipboardList,
  Gauge,
  ListChecks,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { TeacherNav } from "@/components/teacher/teacher-nav";
import { formatRelative, humanizeCode } from "@/lib/format";
import type {
  AnswerMarkingView,
  KappaEvaluationView,
  MarkingQueueView,
  MarkingThroughputView,
  SmartMarkBreakdownItem,
  SmartMarkView,
  TeacherLearnerView,
} from "@/lib/types";

const QUEUE_STATES = [
  { value: "PENDING", label: "Pending" },
  { value: "SMART_MARKED", label: "Smart-marked" },
  { value: "HUMAN_MARKED", label: "Human-marked" },
  { value: "OVERRIDDEN", label: "Overridden" },
] as const;

/** G-5: paper groups per queue-v2 page, fixed for Cycle 1 (the backend owns counts) */
const QUEUE_PAGE_SIZE = 5;

/* Status badges ride the semantic slots as outline pills (border + slot
   text — the hub's status-chip pattern; slot text voices pass on card in
   every theme-mode, while slot-on-self-wash fails for mid-tone voices).
   Slots flip per mode — no dark: overrides. Design-audit second pass (m5). */
const stateBadgeClass: Record<string, string> = {
  PENDING: "border border-warn/40 text-warn",
  SMART_MARKED: "border border-info/40 text-info",
  HUMAN_MARKED: "border border-success/40 text-success",
  OVERRIDDEN: "border border-cat/40 text-cat",
};

function is404(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

function is409(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}

export function MarkingConsoleClient() {
  // class list
  const [learners, setLearners] = useState<TeacherLearnerView[] | null>(null);
  const [learnersError, setLearnersError] = useState<string | null>(null);

  // marking queue (sprint-2 §6/§7: the deterministic paper-grouped v2 queue)
  const [queueState, setQueueState] = useState<string>("PENDING");
  const [queue, setQueue] = useState<MarkingQueueView | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  // G-5: opt-in paper-group pagination — the backend owns the counts (never
  // client-side estimates)
  const [queuePage, setQueuePage] = useState(0);
  const [queueTotalPages, setQueueTotalPages] = useState(0);
  const [queueTotalGroups, setQueueTotalGroups] = useState(0);
  const [queueTotalItems, setQueueTotalItems] = useState(0);

  // marking throughput metrics (counts of what happened)
  const [throughput, setThroughput] = useState<MarkingThroughputView | null>(null);
  // P2-1: a failed fetch must not render as a forever-skeleton — surface it
  const [throughputError, setThroughputError] = useState<string | null>(null);

  // selected answer detail + actions
  const [detail, setDetail] = useState<AnswerMarkingView | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // human mark form
  const [marksInput, setMarksInput] = useState("");
  const [comments, setComments] = useState("");
  const [pointDecisions, setPointDecisions] = useState<Record<string, number>>({});

  // kappa gate
  const [kappa, setKappa] = useState<KappaEvaluationView | null>(null);
  const [kappaStatus, setKappaStatus] = useState<
    "none" | "conflict" | "ok" | "loading" | "error"
  >("loading");
  const [kappaError, setKappaError] = useState<string | null>(null);
  // G-5: κ scope — "ALL" (the whole bank) or one paper id from the queue groups
  const [kappaPaperId, setKappaPaperId] = useState<string>("ALL");

  const loadLearners = useCallback(async () => {
    setLearnersError(null);
    try {
      setLearners(await api.teacherLearners());
    } catch (e) {
      setLearnersError(e instanceof ApiError ? e.message : "Could not load the class list.");
    }
  }, []);

  // Last-request-wins guards: rapid state-tab switches or answer clicks must
  // never let a slower older response overwrite the newer one (a human mark
  // recorded from a queue/detail that no longer matches the visible list is a
  // wrong-mark hazard, not a cosmetic glitch).
  const queueSeq = useRef(0);
  const detailSeq = useRef(0);
  // P3-5: bring the detail panel into view when a NEW answer is selected —
  // on mobile the queue sits above it and a tap otherwise looks like a no-op
  const detailRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledAnswerId = useRef<string | null>(null);

  const loadQueue = useCallback(async (state: string, page: number) => {
    const seq = ++queueSeq.current;
    setQueueLoading(true);
    setQueueError(null);
    try {
      const view = await api.markingQueueV2Page(state, page, QUEUE_PAGE_SIZE);
      if (seq !== queueSeq.current) return; // a newer state switch won
      // the page view structurally carries the full view's fields
      setQueue(view);
      setQueueTotalPages(view.totalPages);
      setQueueTotalGroups(view.totalGroups);
      setQueueTotalItems(view.totalItems);
    } catch (e) {
      if (seq !== queueSeq.current) return;
      setQueueError(e instanceof ApiError ? e.message : "Could not load the marking queue.");
    } finally {
      if (seq === queueSeq.current) setQueueLoading(false);
    }
  }, []);

  const loadThroughput = useCallback(async () => {
    setThroughputError(null);
    try {
      setThroughput(await api.markingThroughput());
    } catch (e) {
      // the throughput panel is a convenience — its failure never blocks
      // marking, but swallowing it into null rendered an eternal Skeleton
      // (P2-1). Fail honestly with a retry instead.
      setThroughput(null);
      setThroughputError(
        e instanceof ApiError ? e.message : "Could not load the throughput counts.",
      );
    }
  }, []);

  const loadKappa = useCallback(async () => {
    setKappaStatus("loading");
    setKappaError(null);
    try {
      // G-5: the scope is real — a paper selection reads the PAPER-scoped row,
      // never silently falls back to ALL
      setKappa(await api.kappaLatest(kappaPaperId === "ALL" ? undefined : kappaPaperId));
      setKappaStatus("ok");
    } catch (e) {
      setKappa(null);
      if (is404(e)) {
        setKappaStatus("none");
      } else if (is409(e)) {
        setKappaStatus("conflict");
      } else {
        // honesty rule (file header): a 500 / network failure is NOT "none
        // recorded" — say so and surface the reason instead
        setKappaStatus("error");
        setKappaError(e instanceof ApiError ? e.message : "Could not reach the κ evaluation.");
      }
    }
  }, [kappaPaperId]);

  useEffect(() => {
    loadLearners();
    loadKappa();
    loadThroughput();
  }, [loadLearners, loadKappa, loadThroughput]);

  useEffect(() => {
    loadQueue(queueState, queuePage);
    setDetail(null);
    setDetailError(null);
    setActionError(null);
    setActionNotice(null);
  }, [queueState, queuePage, loadQueue]);

  const selectAnswer = useCallback(
    async (answerId: string) => {
      const seq = ++detailSeq.current;
      setDetailError(null);
      setActionError(null);
      setActionNotice(null);
      try {
        const view = await api.markingAnswer(answerId);
        if (seq !== detailSeq.current) return; // a newer selection won
        setDetail(view);
        setMarksInput(view.latestHumanMark ? String(view.latestHumanMark.marksAwarded) : "");
        setComments(view.latestHumanMark?.comments ?? "");
        // seed per-point decisions from the smart-mark breakdown so κ pairing
        // has something concrete to align against; teacher can flip each one
        const seeds: Record<string, number> = {};
        view.latestSmartMark?.breakdown?.forEach((b: SmartMarkBreakdownItem) => {
          if (b.markPointId) seeds[b.markPointId] = b.awarded ? 1 : 0;
        });
        setPointDecisions(seeds);
      } catch (e) {
        if (seq !== detailSeq.current) return;
        setDetail(null);
        setDetailError(e instanceof ApiError ? e.message : "Could not load the answer.");
      }
    },
    [],
  );

  // P3-5: scroll on new selections only — same-answer refreshes (e.g. after
  // a Smart Mark run) must not yank the page while the teacher is reading
  useEffect(() => {
    const id = detail?.answerId;
    if (!id || id === lastScrolledAnswerId.current) return;
    lastScrolledAnswerId.current = id;
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [detail]);

  const refreshDetailAndQueue = useCallback(
    async (answerId: string) => {
      await selectAnswer(answerId);
      await loadQueue(queueState, queuePage);
      await loadThroughput();
      await loadKappa(); // human marks extend the κ pairing set
    },
    [selectAnswer, loadQueue, queueState, queuePage, loadThroughput, loadKappa],
  );

  /** sprint-2 §6: bounded Smart Mark batch for one paper group — runs the
   * existing per-answer pipeline with honest per-item outcomes; partial
   * success is reported, never hidden. */
  const runBatchForGroup = useCallback(
    async (paperId: string) => {
      if (!queue) return;
      const ids = queue.items
        .filter((i) => i.paperId === paperId)
        .map((i) => i.answer.answerId)
        .slice(0, 50);
      if (ids.length === 0) return;
      setActionBusy("batch");
      setActionError(null);
      setActionNotice(null);
      try {
        const result = await api.smartMarkBatch(ids);
        setActionNotice(
          `Smart Mark batch: ${result.marked} marked · ${result.skipped} skipped (already marked) · ${result.failed} failed` +
            (result.failed > 0
              ? ` — first failure: ${result.items.find((i) => i.outcome === "FAILED")?.reason ?? "unknown"}`
              : ""),
        );
        if (detail) {
          await selectAnswer(detail.answerId);
        }
        await loadQueue(queueState, queuePage);
        await loadThroughput();
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : "The batch could not run.");
      } finally {
        setActionBusy(null);
      }
    },
    [queue, detail, selectAnswer, loadQueue, queueState, queuePage, loadThroughput],
  );

  const runSmartMark = useCallback(
    async (answerId: string) => {
      setActionBusy("smart");
      setActionError(null);
      setActionNotice(null);
      try {
        const result: SmartMarkView = await api.runSmartMark(answerId);
        if (result.validationPassed) {
          setActionNotice(
            `Smart Mark awarded ${result.marksAwarded} mark(s) — provisional until the κ gate passes.`,
          );
        } else {
          setActionError(
            `Smart Mark did not produce marks: ${humanizeCode(result.failureReason ?? "FAILED")}.`,
          );
        }
        await refreshDetailAndQueue(answerId);
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : "Smart Mark could not run.");
      } finally {
        setActionBusy(null);
      }
    },
    [refreshDetailAndQueue],
  );

  const submitHumanMark = useCallback(
    async (answerId: string, partMarks: number) => {
      // Guard the blank field FIRST: Number("") is 0, so the old check let an
      // empty input through as a legitimate zero-mark submission.
      const raw = marksInput.trim();
      if (raw === "") {
        setActionError("Enter the marks awarded before submitting.");
        return;
      }
      const marks = Number(raw);
      if (!Number.isInteger(marks) || marks < 0 || marks > partMarks) {
        setActionError(`Marks must be a whole number between 0 and ${partMarks}.`);
        return;
      }
      setActionBusy("human");
      setActionError(null);
      setActionNotice(null);
      try {
        await api.recordHumanMark(answerId, {
          marksAwarded: marks,
          perPointDecisions: Object.keys(pointDecisions).length ? pointDecisions : null,
          comments: comments.trim() || null,
        });
        setActionNotice("Human mark recorded — it is now the authoritative grade.");
        await refreshDetailAndQueue(answerId);
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : "The mark could not be recorded.");
      } finally {
        setActionBusy(null);
      }
    },
    [marksInput, comments, pointDecisions, refreshDetailAndQueue],
  );

  /** sprint-2 §6: record the mark, then advance to the next answer in the
   *  deterministic queue order — the mark&next workflow. The queue payload
   *  carries the chain; no second lookup needed. */
  const submitHumanMarkAndNext = useCallback(
    async (answerId: string, partMarks: number) => {
      // capture the next link BEFORE the queue refresh removes the row
      const nextId =
        queue?.items.find((i) => i.answer.answerId === answerId)?.nextAnswerId ?? null;
      await submitHumanMark(answerId, partMarks);
      if (nextId) {
        await selectAnswer(nextId);
      } else {
        setDetail(null); // queue exhausted for this state
      }
    },
    [queue, submitHumanMark, selectAnswer],
  );

  const recomputeKappa = useCallback(async () => {
    setActionBusy("kappa");
    setActionError(null);
    setActionNotice(null);
    try {
      const evaluation = await api.evaluateKappa(
        kappaPaperId === "ALL" ? undefined : kappaPaperId,
      );
      setKappa(evaluation);
      setKappaStatus("ok");
      setActionNotice(
        `κ = ${evaluation.kappa.toFixed(2)} on ${evaluation.sampleSize} paired point decisions (${evaluation.scope === "PAPER" ? "this paper's scope" : "all papers"}; gate ${evaluation.passed ? "PASSED" : "not passed"}, threshold ${evaluation.threshold.toFixed(2)}).`,
      );
    } catch (e) {
      if (is409(e)) {
        setActionError(
          "κ needs paired per-point decisions: record human marks with point decisions after a validated Smart Mark run.",
        );
      } else {
        setActionError(e instanceof ApiError ? e.message : "κ could not be evaluated.");
      }
    } finally {
      setActionBusy(null);
    }
  }, [kappaPaperId]);

  // G-5: papers offered as κ scope = the distinct papers in the loaded queue
  // view's groups. The unfiled (question-bank) group has no paper id BY
  // DESIGN — it is excluded, never invented into a scope.
  const kappaPaperOptions = useMemo(() => {
    const seen = new Map<string, string>();
    queue?.groups.forEach((group) => {
      if (group.paperId) {
        seen.set(
          group.paperId,
          group.paperTitle ?? group.paperCode ?? group.paperId,
        );
      }
    });
    return Array.from(seen.entries()).map(([id, title]) => ({ id, title }));
  }, [queue]);

  const smartBreakdownPoints = useMemo(() => {
    const points: { markPointId: string; awarded: boolean }[] = [];
    detail?.latestSmartMark?.breakdown?.forEach((b) => {
      if (b.markPointId) {
        points.push({ markPointId: b.markPointId, awarded: Boolean(b.awarded) });
      }
    });
    return points;
  }, [detail]);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Marking review
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Live from the SyllabAI backend: the class list is the whole pilot cohort (classes are a
          Cycle-2+ concept). Human marks are the authoritative grade; Smart Mark results are
          provisional until the κ agreement gate passes. This surface presents facts only — no
          recommendations.
        </p>
      </div>

      <TeacherNav />

      <Alert>
        <ShieldCheck className="size-4" aria-hidden="true" />
        <AlertTitle>Teacher review surface (minimal, Cycle 1)</AlertTitle>
        <AlertDescription>
          The queue is grouped by exam paper (one mark scheme in working memory), oldest-waiting
          learners first — a deterministic order that never changes any mark or gate. Review the
          answer, compare against the mark scheme via Smart Mark, then record the authoritative
          human mark.
        </AlertDescription>
      </Alert>

      {/* ── Class list ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-primary" aria-hidden="true" />
            Class list
            {learners && (
              <Badge variant="secondary" className="ml-1">
                {learners.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Every enabled learner account, ordered by name. Joined dates come from the identity
            store.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {learnersError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load the class list</AlertTitle>
              <AlertDescription>
                {learnersError}
                <Button variant="outline" size="sm" className="h-9" onClick={loadLearners}>
                  <RotateCw className="size-4" aria-hidden="true" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : !learners ? (
            <Skeleton className="h-24 w-full" />
          ) : learners.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No learner accounts yet — learners appear here when they register.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Learner</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {learners.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2 font-medium">{l.displayName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.email}</td>
                      <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                        {formatRelative(l.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── κ agreement gate ───────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-primary" aria-hidden="true" />
            Smart Mark agreement gate (κ)
          </CardTitle>
          <CardDescription>
            Cohen&apos;s κ over paired per-point decisions between the newest accepted Smart Mark
            run and the newest human mark. Fail-closed: below threshold, Smart Mark stays
            provisional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Label htmlFor="kappa-scope" className="text-xs text-muted-foreground">
              Scope
            </Label>
            <Select value={kappaPaperId} onValueChange={(v) => setKappaPaperId(v)}>
              <SelectTrigger id="kappa-scope" className="h-9 w-[280px]">
                <SelectValue placeholder="All papers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All papers (whole bank)</SelectItem>
                {kappaPaperOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              Papers come from the queue view below. Gate rule: the ALL-scope row OR this
              paper&apos;s own row must pass — with neither, Smart Mark stays provisional.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
          {kappaStatus === "loading" ? (
            <Skeleton className="h-9 w-64" />
          ) : kappa ? (
            <>
              <div className="flex items-center gap-2">
                <Badge
                  variant={kappa.passed ? "outline" : "destructive"}
                  className={kappa.passed ? "border-success/40 text-success" : ""}
                >
                  κ {kappa.kappa.toFixed(2)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {kappa.sampleSize} pairs · threshold {kappa.threshold.toFixed(2)} ·{" "}
                  {kappa.scope === "ALL"
                    ? "all papers"
                    : kappaPaperOptions.find((p) => p.id === kappa.paperId)?.title ??
                      "one paper"} ·{" "}
                  {formatRelative(kappa.computedAt)}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={recomputeKappa}
                disabled={actionBusy === "kappa"}
              >
                <RotateCw className="size-4" aria-hidden="true" />
                Recompute
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm text-muted-foreground">
                {kappaStatus === "conflict"
                  ? "No paired smart/human point decisions available yet."
                  : kappaStatus === "error"
                    ? (kappaError ?? "Could not load the κ evaluation.")
                    : "No κ evaluation recorded yet."}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={recomputeKappa}
                disabled={actionBusy === "kappa"}
              >
                <Sparkles className="size-4" aria-hidden="true" />
                Evaluate κ
              </Button>
            </>
          )}
          </div>
        </CardContent>
      </Card>

      {/* ── Marking throughput metrics (§6) ────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="size-4 text-primary" aria-hidden="true" />
            Marking throughput
          </CardTitle>
          <CardDescription>
            Counts of what happened — never estimates. The pending backlog is what keeps class
            mastery from populating: structured evidence fires only at first authoritative
            marking.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {throughputError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load the throughput counts</AlertTitle>
              <AlertDescription>
                {throughputError}
                <Button variant="outline" size="sm" className="h-9" onClick={loadThroughput}>
                  <RotateCw className="size-4" aria-hidden="true" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : !throughput ? (
            <Skeleton className="h-9 w-full max-w-xl" />
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {QUEUE_STATES.map((s) => (
                <Badge key={s.value} variant="secondary" className="gap-1">
                  {s.label}
                  <span className="font-mono">
                    {throughput.answersByState[s.value] ?? 0}
                  </span>
                </Badge>
              ))}
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                human marks 24h <span className="font-mono">{throughput.humanMarks24h}</span>{" "}
                / 7d <span className="font-mono">{throughput.humanMarks7d}</span>
              </span>
              {throughput.oldestPendingAt && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">
                    oldest pending waited{" "}
                    <span className="font-mono">
                      {throughput.oldestPendingHours ?? 0}h
                    </span>
                  </span>
                </>
              )}
            </div>
          )}
          {throughput && throughput.pendingByPaper.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {throughput.pendingByPaper.map((p) => (
                <Badge key={p.paperId} variant="outline" className="text-xs">
                  {p.paperTitle ?? p.paperCode ?? "paper"} · {p.pending} pending
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Marking review queue (§6/§7 deterministic grouping) ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="size-4 text-primary" aria-hidden="true" />
            Marking review queue
          </CardTitle>
          <CardDescription>
            Grouped by exam paper (one mark scheme in working memory), oldest-waiting learners
            first — a deterministic order that never changes any mark or gate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={queueState}
            onValueChange={(v) => {
              // a tab switch resets the page AND the κ scope: the paper list
              // is this view's, and a stale paper id would render as a Select
              // value with no matching option
              setQueueState(v);
              setQueuePage(0);
              setKappaPaperId("ALL");
            }}
          >
            <TabsList className="grid h-auto w-full max-w-xl grid-cols-2 sm:grid-cols-4">
              {QUEUE_STATES.map((s) => (
                <TabsTrigger key={s.value} value={s.value} className="py-2.5 text-xs">
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {!queueError && queue && queue.groups.length > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {queueTotalGroups} paper{queueTotalGroups === 1 ? "" : "s"} ·{" "}
                {queueTotalItems} answer{queueTotalItems === 1 ? "" : "s"} · page{" "}
                {queuePage + 1} of {Math.max(queueTotalPages, 1)}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={queuePage === 0 || queueLoading}
                  onClick={() => setQueuePage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={queuePage + 1 >= queueTotalPages || queueLoading}
                  onClick={() => setQueuePage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          {queueError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load the marking queue</AlertTitle>
              <AlertDescription>
                {queueError}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => void loadQueue(queueState, queuePage)}
                >
                  <RotateCw className="size-4" aria-hidden="true" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : !queue || (queueLoading && !detail) ? (
            <Skeleton className="h-32 w-full" />
          ) : queue.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No answers in this state right now. Learner submissions appear here as they practise.
            </p>
          ) : (
            <div className="space-y-4" aria-live="polite">
              {queue.groups.map((group) => (
                <div key={group.paperId} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {group.paperTitle ?? group.paperCode ?? "Paper"}
                      </span>
                      {group.paperCode && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {group.paperCode}
                        </span>
                      )}
                      {group.sessionLabel && (
                        <span className="text-xs text-muted-foreground">
                          {group.sessionLabel}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{group.count} in this state</Badge>
                      {group.oldestWaitingHours != null && (
                        <span className="text-xs text-muted-foreground">
                          oldest waited {group.oldestWaitingHours}h
                        </span>
                      )}
                      {queueState === "PENDING" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9"
                          onClick={() => runBatchForGroup(group.paperId)}
                          disabled={actionBusy !== null}
                        >
                          <Sparkles className="size-4" aria-hidden="true" />
                          {actionBusy === "batch"
                            ? "Running…"
                            : `Smart Mark ${Math.min(group.count, 50)}`}
                        </Button>
                      )}
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {queue.items
                      .filter((i) => i.paperId === group.paperId)
                      .map((item) => (
                        <li key={item.answer.answerId}>
                          <button
                            type="button"
                            onClick={() => selectAnswer(item.answer.answerId)}
                            className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 ${
                              detail?.answerId === item.answer.answerId
                                ? "border-primary bg-muted/40"
                                : ""
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                  {item.answer.learnerDisplayName ?? "Unknown learner"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {item.answer.questionExternalRef ?? "question"} · part{" "}
                                  {item.answer.partLabel} · {item.answer.partMarks} mark
                                  {item.answer.partMarks === 1 ? "" : "s"}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                {item.answer.marksAwarded != null && (
                                  <span className="text-xs text-muted-foreground">
                                    {item.answer.marksAwarded}/{item.answer.partMarks}
                                  </span>
                                )}
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    stateBadgeClass[item.answer.markingState] ?? ""
                                  }`}
                                >
                                  {humanizeCode(item.answer.markingState)}
                                </span>
                              </div>
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {item.answer.answerText || "(blank answer)"}
                            </p>
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {detailError && (
            <Alert variant="destructive">
              <AlertTitle>Could not load the answer</AlertTitle>
              <AlertDescription>
                {detailError} — pick it from the queue again to retry.
              </AlertDescription>
            </Alert>
          )}

          {/* P3-4: persistent live regions — the queue list announces changes
              politely, and mark results must announce too. The Alerts mount
              and unmount, and an aria-live region has to exist BEFORE the
              content change to be spoken reliably; sr-only keeps the empty
              wrappers out of sight but in the accessibility tree. */}
          <div aria-live="assertive" className={actionError ? undefined : "sr-only"}>
            {actionError && (
              <Alert variant="destructive">
                <AlertTitle>Could not complete</AlertTitle>
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            )}
          </div>
          <div aria-live="polite" className={actionNotice ? undefined : "sr-only"}>
            {actionNotice && (
              <Alert>
                <AlertTitle>Done</AlertTitle>
                <AlertDescription>{actionNotice}</AlertDescription>
              </Alert>
            )}
          </div>

          {detail && (
            <div ref={detailRef} className="rounded-lg border p-4 space-y-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {detail.learnerDisplayName ?? "Unknown learner"} — part {detail.partLabel}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {detail.questionExternalRef ?? "question"}
                    </span>
                  </h3>
                  <Badge variant="outline">{humanizeCode(detail.markingState)}</Badge>
                </div>
                <p className="mt-2 text-sm">{detail.partPrompt}</p>
                <div className="mt-2 rounded-md bg-muted/60 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Learner answer</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {detail.answerText || "(blank answer)"}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Latest Smart Mark (provisional)
                  </p>
                  {detail.latestSmartMark ? (
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="font-medium">
                          {detail.latestSmartMark.marksAwarded}/{detail.partMarks}
                        </span>{" "}
                        {detail.latestSmartMark.confidence != null && (
                          <span className="text-muted-foreground">
                            · confidence {(detail.latestSmartMark.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {detail.latestSmartMark.validationPassed
                          ? `validated · ${detail.latestSmartMark.modelId ?? "unknown model"} · pipeline ${detail.latestSmartMark.pipelineVersion ?? "?"} · ${formatRelative(detail.latestSmartMark.createdAt)}`
                          : `failed: ${humanizeCode(detail.latestSmartMark.failureReason ?? "FAILED")} — never fabricated`}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No Smart Mark run yet.</p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => runSmartMark(detail.answerId)}
                    disabled={actionBusy !== null}
                  >
                    <Sparkles className="size-4" aria-hidden="true" />
                    {actionBusy === "smart" ? "Running…" : "Run Smart Mark"}
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Latest human mark (authoritative)
                  </p>
                  {detail.latestHumanMark ? (
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="font-medium">
                          {detail.latestHumanMark.marksAwarded}/{detail.partMarks}
                        </span>
                      </p>
                      {detail.latestHumanMark.comments && (
                        <p className="text-xs text-muted-foreground">
                          “{detail.latestHumanMark.comments}”
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        recorded {formatRelative(detail.latestHumanMark.createdAt)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No human mark yet.</p>
                  )}
                </div>
              </div>

              {smartBreakdownPoints.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Mark-point decisions (for κ pairing)
                  </p>
                  <div className="space-y-1">
                    {smartBreakdownPoints.map((p) => (
                      <div
                        key={p.markPointId}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {p.markPointId.slice(0, 8)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            smart: {p.awarded ? "1" : "0"}
                          </span>
                          <Select
                            value={String(pointDecisions[p.markPointId] ?? (p.awarded ? 1 : 0))}
                            onValueChange={(v) =>
                              setPointDecisions((prev) => ({
                                ...prev,
                                [p.markPointId]: Number(v),
                              }))
                            }
                          >
                            <SelectTrigger className="h-9 w-28 text-xs" aria-label="Human decision">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">human: 1</SelectItem>
                              <SelectItem value="0">human: 0</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Seeded from the Smart Mark breakdown — adjust to your judgement; they drive the
                    κ calibration set.
                  </p>
                </div>
              )}

              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  Record human mark (override)
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="marks" className="text-xs">
                      Marks (0–{detail.partMarks})
                    </Label>
                    <Input
                      id="marks"
                      inputMode="numeric"
                      className="h-9 w-24"
                      value={marksInput}
                      onChange={(e) => setMarksInput(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="min-w-[200px] flex-1 space-y-1">
                    <Label htmlFor="comments" className="text-xs">
                      Comments (rationale)
                    </Label>
                    <Textarea
                      id="comments"
                      className="min-h-9"
                      rows={2}
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      placeholder="Why these marks…"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="h-9"
                    onClick={() =>
                      submitHumanMarkAndNext(detail.answerId, detail.partMarks)
                    }
                    disabled={actionBusy !== null}
                  >
                    <ClipboardCheck className="size-4" aria-hidden="true" />
                    {actionBusy === "human"
                      ? "Recording…"
                      : queue?.items.find(
                            (i) => i.answer.answerId === detail.answerId,
                          )?.nextAnswerId
                        ? "Record & next"
                        : "Record mark"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  First human mark fires the evidence contract once (BKT/fluency react); later
                  marks are overrides that never re-fire evidence. “Record &amp; next” follows
                  the deterministic queue order: one paper group at a time, oldest-waiting
                  learners first.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
