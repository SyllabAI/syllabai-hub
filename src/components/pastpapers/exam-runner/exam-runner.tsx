/**
 * ExamRunner — the Paper Run shell (PAST_PAPER_RUN_MODE_DESIGN.md §5.2/§5.3).
 *
 * One shell for Track A (PDF + AnswerOverlay) and, later, Track B
 * (reconstruction exam mode). Practice integrity only: everything is local
 * and labeled; core evidence flows exclusively through the existing
 * attempt-bridge at grading time (never during the run).
 *
 * State machine (all transitions persist to IndexedDB):
 *   intro → running → (auto at zero: time-up-pending-submission, written
 *   BEFORE grading so a crash can never lose the deadline fact) → grading →
 *   done. A load of a "running" record whose deadline has passed recovers
 *   deterministically via recoverPhase() — the run never depends on the
 *   timer callback having executed.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlarmClock,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Flag,
  Info,
  ListChecks,
  PenLine,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ExamQuestion } from "@/lib/contracts";
import { api } from "@/lib/api";
import {
  useAttemptBridge,
  coreEvidenceChanged,
  type AttemptBridgeStatus,
} from "@/lib/attempt-bridge";
import {
  deleteRun,
  findResumableRun,
  gcRuns,
  loadRun,
  recoverPhase,
  saveRun,
} from "@/lib/paper-run-store";
import {
  ACCOMMODATION_CEILING,
  type CapturedPartAnswer,
  type DurationPolicy,
  type PaperRunManifest,
  type PaperRunRecord,
  type PaperRunResult,
} from "@/lib/paper-run/types";
import { GradingConsole } from "@/components/pastpapers/exam-runner/grading-console";
import { PdfCanvas } from "@/components/pastpapers/exam-runner/pdf-canvas";

export interface ReconForRun {
  key: string;
  questions: ExamQuestion[];
  questionNumbers: Array<number | null>;
}

interface ExamRunnerProps {
  course: string;
  corpusKey: string;
  manifest: PaperRunManifest;
  qpUrl: string;
  msUrl: string;
  paperTitle: string;
  backHref: string;
  /** matched parsed-corpus reconstruction — the core join lane (pilot only) */
  recon: ReconForRun | null;
  /** official-blueprint coverage of the manifest (design §5.5) */
  coverageState: "full" | "partial";
}

export function partKeyOf(qn: string, part: string): string {
  return `${qn}:${part}`;
}

export function ExamRunner({
  course,
  corpusKey,
  manifest,
  qpUrl,
  msUrl,
  paperTitle,
  backHref,
  recon,
  coverageState,
}: ExamRunnerProps) {
  const officialMin = manifest.paper.durationMin;
  const ceilingMin = Math.ceil(officialMin * ACCOMMODATION_CEILING);

  // ── setup (intro) ────────────────────────────────────────────────────────
  const [durationMin, setDurationMin] = useState(officialMin);
  const policy: DurationPolicy = durationMin > officialMin ? "ACCOMMODATED" : "OFFICIAL";
  const [resumable, setResumable] = useState<PaperRunRecord | null>(null);
  const [busy, setBusy] = useState(false);

  // ── run state ────────────────────────────────────────────────────────────
  const [record, setRecord] = useState<PaperRunRecord | null>(null);
  const [phase, setPhase] = useState<"intro" | "running" | "pending" | "grading" | "done">(
    "intro",
  );
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [result, setResult] = useState<PaperRunResult | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    gcRuns();
    findResumableRun(course, corpusKey).then((r) => {
      if (!r) return;
      const { record: fixed } = recoverPhase(r);
      if (fixed.phase !== r.phase) {
        // deadline passed while away — persist the durable recovery state
        saveRun(fixed);
      }
      setResumable(fixed);
    });
  }, [course, corpusKey]);

  const persist = useCallback((next: PaperRunRecord) => {
    setRecord(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveRun(next), 400);
  }, []);

  const captureAnswer = useCallback(
    (key: string, patch: Partial<CapturedPartAnswer>) => {
      setRecord((prev) => {
        if (!prev) return prev;
        const prevAns = prev.answers[key];
        const next: CapturedPartAnswer = {
          partKey: key,
          value: patch.value ?? prevAns?.value ?? "",
          paperOnly: patch.paperOnly ?? prevAns?.paperOnly ?? false,
          editedAt: new Date().toISOString(),
        };
        const rec = {
          ...prev,
          answers: { ...prev.answers, [key]: next },
          currentIndex: pageNo - 1,
        };
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void saveRun(rec), 400);
        return rec;
      });
    },
    [pageNo],
  );

  const toggleFlag = useCallback(
    (qn: string) => {
      setRecord((prev) => {
        if (!prev) return prev;
        const rec = { ...prev, flags: { ...prev.flags, [qn]: !prev.flags[qn] } };
        void saveRun(rec);
        return rec;
      });
    },
    [],
  );

  const beginRun = useCallback(
    async (resume?: PaperRunRecord) => {
      setBusy(true);
      try {
        if (resume) {
          const { record: fixed, recovered } = recoverPhase(resume);
          setRecord(fixed);
          setDurationMin(fixed.durationMin);
          setSecondsLeft(Math.max(0, fixed.durationMin * 60 - fixed.timeUsedSec));
          if (fixed.phase === "time-up-pending-submission") setPhase("pending");
          else {
            setPhase("running");
            void transitionQuiet(fixed);
          }
          if (recovered) await saveRun(fixed);
          return;
        }
        const now = new Date();
        const rec: PaperRunRecord = {
          runId: `${course}:${corpusKey}:${now.toISOString()}`,
          course,
          corpusKey,
          ref: manifest.paper.ref,
          phase: "running",
          startedAt: now.toISOString(),
          lastSavedAt: now.toISOString(),
          submittedAt: null,
          endedAt: null,
          durationMin,
          durationPolicy: policy,
          timeUsedSec: 0,
          timeUpAutoSubmitted: false,
          manifestVersion: manifest.version,
          answers: {},
          flags: {},
          currentIndex: 0,
        };
        await saveRun(rec);
        setRecord(rec);
        setSecondsLeft(durationMin * 60);
        setPageNo(manifest.questions[0]?.page ?? 1);
        setResumable(null);
        setPhase("running");
      } finally {
        setBusy(false);
      }
    },
    [course, corpusKey, manifest, durationMin, policy],
  );

  /** persist without touching react state (resume path housekeeping) */
  const transitionQuiet = (rec: PaperRunRecord) => saveRun(rec);

  const endRun = useCallback(
    async (auto: boolean) => {
      if (!record) return;
      const nowIso = new Date().toISOString();
      // 1) durable deadline/submission fact FIRST (crash-safe ordering)
      const pending: PaperRunRecord = {
        ...record,
        phase: "time-up-pending-submission",
        timeUpAutoSubmitted: auto,
        endedAt: auto
          ? new Date(new Date(record.startedAt).getTime() + record.durationMin * 60_000).toISOString()
          : nowIso,
        timeUsedSec: auto
          ? record.durationMin * 60
          : Math.min(record.durationMin * 60, record.durationMin * 60 - secondsLeft),
        submittedAt: auto ? null : nowIso,
      };
      await saveRun(pending);
      setRecord(pending);
      // 2) then move to grading (if the browser dies between 1 and 2, the
      //    pending record recovers on next load — nothing is lost)
      const grading: PaperRunRecord = { ...pending, phase: "grading", submittedAt: nowIso };
      await saveRun(grading);
      setRecord(grading);
      setPhase("grading");
    },
    [record, secondsLeft],
  );

  // timer — one tick per second while running
  useEffect(() => {
    if (phase !== "running") return;
    const t = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(t);
          void endRun(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [phase, endRun]);

  // ── derived ──────────────────────────────────────────────────────────────
  const answeredByQn = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const q of manifest.questions) {
      m.set(
        q.number,
        q.parts.some((p) => {
          const a = record?.answers[partKeyOf(q.number, p.part)];
          return !!a && (a.value.trim().length > 0 || a.paperOnly);
        }),
      );
    }
    return m;
  }, [manifest, record]);

  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;
  const lowTime = phase === "running" && secondsLeft <= 300;

  // ── grading finish ───────────────────────────────────────────────────────
  const finishRun = useCallback(
    (r: PaperRunResult) => {
      setResult(r);
      setPhase("done");
      if (record) void deleteRun(record.runId);
    },
    [record],
  );

  // ── intro ────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BuiltinHeader {...{ paperTitle, backHref, manifest }} />
        {resumable && resumable.phase === "time-up-pending-submission" && (
          <Card className="border-warn/40 bg-warn/5">
            <CardContent className="space-y-3 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlarmClock className="size-4 text-warn" aria-hidden />
                Your previous run&apos;s time ran out — the answers were saved.
              </p>
              <p className="text-xs text-muted-foreground">
                Started {new Date(resumable.startedAt).toLocaleString()} · official{" "}
                {resumable.durationMin} min ·{" "}
                {Object.keys(resumable.answers).length} captured answer
                {Object.keys(resumable.answers).length === 1 ? "" : "s"}. You can grade it now, or
                discard it and start fresh.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => beginRun(resumable)}>
                  Grade the saved run
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    await deleteRun(resumable.runId);
                    setResumable(null);
                  }}
                >
                  Discard it
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        {resumable && resumable.phase === "running" && (
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-medium">Run in progress — resume?</p>
              <p className="text-xs text-muted-foreground">
                Started {new Date(resumable.startedAt).toLocaleString()} ·{" "}
                {Object.keys(resumable.answers).length} captured answer
                {Object.keys(resumable.answers).length === 1 ? "" : "s"} so far.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => beginRun(resumable)}>
                  Resume run
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    await deleteRun(resumable.runId);
                    setResumable(null);
                  }}
                >
                  Start over
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="space-y-4 p-5">
            <div>
              <h2 className="text-lg font-semibold">Paper Run — {manifest.paper.ref}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Type answers on the paper, click the multiple-choice options, and manage the
                official timer yourself. Feedback is deferred to the end — like the real thing.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Duration (minutes)
                </span>
                <input
                  type="number"
                  min={5}
                  max={ceilingMin}
                  value={durationMin}
                  onChange={(e) => {
                    const v = Math.max(5, Math.min(ceilingMin, Number(e.target.value) || officialMin));
                    setDurationMin(v);
                  }}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <span className="block text-[11px] text-muted-foreground">
                  Official: {officialMin} min · accommodation ceiling: {ceilingMin} min
                </span>
              </label>
              <div className="space-y-1 text-xs text-muted-foreground">
                <span className="block font-medium text-foreground">Run facts</span>
                <span className="block">
                  {manifest.questions.length} questions · {manifest.paper.totalMarks} marks
                  (official blueprint)
                </span>
                <span className="block">
                  Mode: Paper Run · integrity: practice · duration policy: {policy}
                </span>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
              <p className="flex items-start gap-1.5">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium text-foreground">Practice run.</span> Answers and
                  results stay in this browser and are labeled SIMULATED where the course is not
                  core-backed{recon ? "; on the 4CH1 pilot, verified joins also record real core attempts at grading time" : ""}.
                  Manifest {manifest.provenance.status} · curated by{" "}
                  <span className="font-mono">{manifest.provenance.curatedBy}</span>. Parts whose
                  answer space is a diagram/table (or an image-layer page) are marked &quot;answer
                  on paper&quot; and self-marked against the mark scheme.
                </span>
              </p>
            </div>
            <Button size="lg" className="w-full" disabled={busy} onClick={() => beginRun()}>
              Start the run
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── pending (durable time-up recovery) ───────────────────────────────────
  if (phase === "pending" && record) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-warn/40">
          <CardContent className="space-y-3 p-5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlarmClock className="size-4 text-warn" aria-hidden />
              Time is up — your answers were saved before the browser closed.
            </p>
            <p className="text-xs text-muted-foreground">
              The run reached its {record.durationMin}-minute deadline. Nothing was lost:{" "}
              {Object.keys(record.answers).length} captured answer
              {Object.keys(record.answers).length === 1 ? "" : "s"}. Submit them for grading
              whenever you&apos;re ready.
            </p>
            <Button onClick={() => setPhase("grading")}>Go to grading</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── grading / done (rendered by the console) ─────────────────────────────
  if ((phase === "grading" || phase === "done") && record) {
    return (
      <GradingConsole
        course={course}
        manifest={manifest}
        record={record}
        msUrl={msUrl}
        paperTitle={paperTitle}
        backHref={backHref}
        recon={recon}
        coverageState={coverageState}
        result={result}
        onDone={finishRun}
      />
    );
  }

  // ── running ──────────────────────────────────────────────────────────────
  const partsForPage = (page: number) =>
    manifest.questions.flatMap((q) =>
      q.parts.map((p) => ({ q, p })),
    );

  return (
    <div className="space-y-3">
      {/* top bar: timer + submit */}
      <div className="sticky top-14 z-20 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div
            className={`flex items-center gap-1.5 font-mono text-lg font-bold tabular-nums ${
              lowTime ? "text-destructive" : ""
            }`}
            aria-live="off"
          >
            <AlarmClock className="size-4" aria-hidden />
            {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
          </div>
          <Badge variant="outline" className="text-[10px]">
            {policy === "ACCOMMODATED" ? "accommodated duration" : "official duration"}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void endRun(false)}>
              Finish &amp; grade
            </Button>
          </div>
        </div>
        {/* palette */}
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="navigation" aria-label="Question palette">
          {manifest.questions.map((q) => {
            const answered = answeredByQn.get(q.number);
            const flagged = record?.flags[q.number];
            return (
              <button
                key={q.number}
                onClick={() => setPageNo(q.page)}
                className={`flex h-7 min-w-7 shrink-0 items-center justify-center gap-0.5 rounded-md border px-1.5 text-xs font-semibold ${
                  q.page === pageNo
                    ? "border-primary bg-primary text-primary-foreground"
                    : answered
                      ? "border-success/50 bg-success/10 text-success"
                      : "bg-background text-muted-foreground"
                }`}
                title={`Question ${q.number}${answered ? " — answered" : ""}${flagged ? " — flagged" : ""}`}
              >
                {flagged && <Flag className="size-3 fill-current" aria-hidden />}
                {q.number}
              </button>
            );
          })}
        </div>
      </div>

      {/* PDF + overlay */}
      <div className="relative mx-auto max-w-3xl">
        <PdfCanvas url={qpUrl} pageNo={pageNo} />
        {/* answer overlay — rects are page-fraction UI metadata (design §5.1) */}
        <PageOverlay
          pageNo={pageNo}
          manifest={manifest}
          answers={record?.answers ?? {}}
          onCapture={captureAnswer}
        />
      </div>

      {/* per-page paper-only parts + flag */}
      <PaperOnlyBar
        pageNo={pageNo}
        items={partsForPage(pageNo)}
        answers={record?.answers ?? {}}
        onCapture={captureAnswer}
        flagged={manifest.questions.find((q) => q.page === pageNo)?.number ?? null}
        onFlag={toggleFlag}
        flags={record?.flags ?? {}}
      />

      {/* page nav */}
      <PageNav pageNo={pageNo} setPageNo={setPageNo} />
    </div>
  );
}

// ── overlay (answer capture over the PDF) ───────────────────────────────────

function PageOverlay({
  pageNo,
  manifest,
  answers,
  onCapture,
}: {
  pageNo: number;
  manifest: PaperRunManifest;
  answers: Record<string, CapturedPartAnswer>;
  onCapture: (key: string, patch: Partial<CapturedPartAnswer>) => void;
}) {
  const zones = manifest.questions.flatMap((q) =>
    q.parts
      .filter((p) => p.kind === "mcq")
      .flatMap((p) => (p.mcq?.zones ?? []).map((z) => ({ q, p, z })))
      .filter(({ z }) => z.page === pageNo),
  );
  const areas = manifest.questions.flatMap((q) =>
    q.parts
      .filter((p) => p.kind === "structured" && p.answerKind === "text")
      .flatMap((p) => (p.answerAreas ?? []).map((a) => ({ q, p, a })))
      .filter(({ a }) => a.page === pageNo),
  );
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden={false}>
      {zones.map(({ q, p, z }) => {
        const key = partKeyOf(q.number, p.part);
        const chosen = answers[key]?.value;
        const selected = chosen === z.option;
        return (
          <button
            key={`${key}-${z.option}`}
            onClick={(e) => {
              e.preventDefault();
              onCapture(key, { value: selected ? "" : z.option });
            }}
            className={`pointer-events-auto absolute rounded border text-left ${
              selected
                ? "border-primary bg-primary/25 ring-2 ring-primary"
                : "border-primary/30 bg-primary/5 hover:bg-primary/15"
            }`}
            style={{
              left: `${z.rect[0] * 100}%`,
              top: `${z.rect[1] * 100}%`,
              width: `${z.rect[2] * 100}%`,
              height: `${z.rect[3] * 100}%`,
            }}
            aria-pressed={selected}
            aria-label={`Question ${q.number} part ${p.part} — option ${z.option}`}
          >
            {selected && (
              <Check className="absolute left-0.5 top-1/2 size-3 -translate-y-1/2 text-primary" aria-hidden />
            )}
          </button>
        );
      })}
      {areas.map(({ q, p, a }) => {
        const key = partKeyOf(q.number, p.part);
        return (
          <textarea
            key={key}
            value={answers[key]?.value ?? ""}
            onChange={(e) => onCapture(key, { value: e.target.value })}
            placeholder={`Q${q.number}${p.part}) — type your answer`}
            className="pointer-events-auto absolute resize-none rounded border border-dashed border-primary/50 bg-primary/5 p-1 text-[13px] leading-snug focus:bg-background focus:ring-2 focus:ring-primary"
            style={{
              left: `${a.rect[0] * 100}%`,
              top: `${a.rect[1] * 100}%`,
              width: `${a.rect[2] * 100}%`,
              height: `${a.rect[3] * 100}%`,
            }}
            aria-label={`Answer area for question ${q.number} part ${p.part}`}
          />
        );
      })}
    </div>
  );
}

// ── paper-only bar + flag ───────────────────────────────────────────────────

function PaperOnlyBar({
  pageNo,
  items,
  answers,
  onCapture,
  flagged,
  onFlag,
  flags,
}: {
  pageNo: number;
  items: Array<{ q: PaperRunManifest["questions"][number]; p: PaperRunManifest["questions"][number]["parts"][number] }>;
  answers: Record<string, CapturedPartAnswer>;
  onCapture: (key: string, patch: Partial<CapturedPartAnswer>) => void;
  flagged: string | null;
  onFlag: (qn: string) => void;
  flags: Record<string, boolean>;
}) {
  const paperOnly = items.filter(
    ({ q, p }) =>
      p.kind === "structured" &&
      p.answerKind === "paper-only" &&
      q.parts.some((pp) => (pp.answerAreas ?? []).some((a) => a.page === pageNo) || pp.answerKind === "paper-only") &&
      q.page === pageNo,
  );
  const distinct = [...new Map(paperOnly.map(({ q, p }) => [partKeyOf(q.number, p.part), { q, p }])).values()];
  return (
    <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
      <ListChecks className="size-3.5 text-muted-foreground" aria-hidden />
      {distinct.length === 0 ? (
        <span className="text-muted-foreground">Nothing to answer on paper for this page.</span>
      ) : (
        distinct.map(({ q, p }) => {
          const key = partKeyOf(q.number, p.part);
          const done = !!answers[key]?.paperOnly;
          return (
            <label key={key} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={done}
                onChange={(e) => onCapture(key, { paperOnly: e.target.checked, value: e.target.checked ? "done" : "" })}
                className="size-3.5"
              />
              <span>
                Q{q.number}
                {p.part}) answer on paper — self-mark later
              </span>
            </label>
          );
        })
      )}
      {flagged && (
        <button
          onClick={() => onFlag(flagged)}
          className={`ml-auto flex items-center gap-1 rounded-md border px-2 py-1 ${
            flags[flagged] ? "border-warn/60 bg-warn/10 text-warn" : "text-muted-foreground"
          }`}
        >
          <Flag className="size-3" aria-hidden />
          {flags[flagged] ? "Flagged" : "Flag for review"}
        </button>
      )}
    </div>
  );
}

function PageNav({
  pageNo,
  setPageNo,
}: {
  pageNo: number;
  setPageNo: (n: number) => void;
}) {
  return (
    <div className="mx-auto flex max-w-3xl items-center justify-between pb-8">
      <Button variant="outline" size="sm" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)}>
        <ArrowLeft className="size-4" aria-hidden /> Previous page
      </Button>
      <span className="text-xs text-muted-foreground">page {pageNo}</span>
      <Button variant="outline" size="sm" onClick={() => setPageNo(pageNo + 1)}>
        Next page <ArrowRight className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

export function BuiltinHeader({
  paperTitle,
  backHref,
  manifest,
}: {
  paperTitle: string;
  backHref: string;
  manifest: PaperRunManifest;
}) {
  return (
    <div className="flex items-center gap-2 pt-4">
      <Button asChild variant="ghost" size="sm">
        <Link href={backHref}>
          <ChevronRight className="size-4 rotate-180" aria-hidden /> Past Papers
        </Link>
      </Button>
      <Badge variant="outline" className="text-[10px]">
        <PenLine className="mr-1 size-3" aria-hidden />
        Paper Run · practice
      </Badge>
      <span className="truncate text-sm font-semibold">{paperTitle}</span>
      <span className="sr-only">manifest {manifest.paper.corpusKey}</span>
    </div>
  );
}
