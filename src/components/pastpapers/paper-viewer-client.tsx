"use client";

/**
 * PaperViewerClient — one corpus paper, two modes (decided with the user):
 *
 *   view — traditional PDF mode. QP and MS panes (pdf.js, mobile-first);
 *          desktop shows a QP|MS split, mobile gets a sticky A/B toggle pill
 *          that keeps each document's scroll position (both panes stay
 *          mounted, the hidden one just isn't displayed).
 *
 *   mock — exam simulation. The QP goes fullscreen with the OFFICIAL exam
 *          duration (attested durations from the corpus mapping; unverified
 *          papers show an editable estimate, honestly labelled). A lazy
 *          question jump (detected from the QP text) helps navigate. Time-up
 *          or "Finish" hands over to the grading screen: the MS beside a
 *          mark tally the student enters themselves — either whole-paper or
 *          per-question rows (structure lazily auto-detected from the MS
 *          text on this device, honestly labelled, manual fallback). The
 *          result is saved to the local SIMULATED overlay (lib/mock-results.ts)
 *          and never any canonical store.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  Hourglass,
  Info,
  ListChecks,
  Loader2,
  Plus,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { ExamCodePill } from "@/components/hub/chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PdfPane, type PdfPaneHandle } from "@/components/pastpapers/pdf-pane";
import { corpusRawUrl, type CorpusPaperEntry } from "@/lib/pastpapers-shared";
import { formatSpent, saveMockResult } from "@/lib/mock-results";
import {
  detectMsStructure,
  detectQpQuestions,
  type QpQuestion,
} from "@/lib/ms-questions";

type Doc = "qp" | "ms" | "split";
type MockPhase = "intro" | "running" | "grading";
type BreakState = "loading" | "ready";
type BreakSource = "detected" | "manual";

interface BreakRow {
  key: string;
  label: string;
  marks: string;
  max: string;
}

export interface PaperViewerClientProps {
  course: string;
  paper: CorpusPaperEntry;
  sessionLabelStr: string;
  initialDoc: Doc;
  mode: "view" | "mock";
  /** corpus provenance string for the honesty note */
  metaGeneratedAt: string;
  /** spec exam code pill (e.g. 4CH1) — shown in the compact toolbar row */
  examCode?: string;
}

export function PaperViewerClient({
  course,
  paper,
  sessionLabelStr,
  initialDoc,
  mode,
  metaGeneratedAt,
  examCode,
}: PaperViewerClientProps) {
  const router = useRouter();
  const isSplitCapable = Boolean(paper.qpBytes && paper.msBytes);
  const [doc, setDoc] = useState<Doc>(
    initialDoc === "ms" && !paper.msBytes
      ? "qp"
      : initialDoc === "split" && !isSplitCapable
        ? "qp"
        : initialDoc,
  );
  const [mockPhase, setMockPhase] = useState<MockPhase>(mode === "mock" ? "intro" : "grading");
  const [durationMin, setDurationMin] = useState<number>(paper.durationMin ?? 90);
  const [remainingSec, setRemainingSec] = useState(0);
  const [spentSec, setSpentSec] = useState(0);
  const [endedHow, setEndedHow] = useState<"time-up" | "self" | "exited">("self");
  const [marks, setMarks] = useState<string>("");
  const [total, setTotal] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const startedAtRef = useRef<number>(0);

  // per-question scoring — the LAZY alternative to a repo-wide question
  // index: structure is extracted from THIS paper's MS text at grading time
  // (via the pane's text index), labelled "auto-detected", manual fallback.
  const qpPaneRef = useRef<PdfPaneHandle | null>(null);
  const msPaneRef = useRef<PdfPaneHandle | null>(null);
  const [breakState, setBreakState] = useState<BreakState>("loading");
  const [breakSource, setBreakSource] = useState<BreakSource>("manual");
  const [rows, setRows] = useState<BreakRow[]>([]);
  const [qpQuestions, setQpQuestions] = useState<QpQuestion[] | null>(null);

  const qpUrl = paper.qpPath ? corpusRawUrl(paper.qpPath) : null;
  const msUrl = paper.msPath ? corpusRawUrl(paper.msPath) : null;
  const backHref = `/courses/${course}/past-papers`;

  // ── mock countdown ───────────────────────────────────────────────────────
  useEffect(() => {
    if (mockPhase !== "running") return;
    const iv = window.setInterval(() => {
      setSpentSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      setRemainingSec((r) => {
        if (r <= 1) {
          window.clearInterval(iv);
          setEndedHow("time-up");
          setMockPhase("grading");
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(iv);
  }, [mockPhase]);

  const beginMock = () => {
    startedAtRef.current = Date.now();
    setRemainingSec(durationMin * 60);
    setSpentSec(0);
    setSaved(false);
    setMarks("");
    setEndedHow("self");
    setQpQuestions(null);
    setMockPhase("running");
    // best-effort browser fullscreen (mobile Safari ignores it; the CSS
    // fullscreen overlay below is the real guarantee)
    try {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    } catch {
      /* unsupported — fine */
    }
  };

  const endMock = (how: "self" | "exited") => {
    setEndedHow(how);
    setMockPhase("grading");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  };

  const commitResult = () => {
    const m = Number.parseInt(marks, 10);
    const t = Number.parseInt(total, 10);
    if (Number.isNaN(m) || Number.isNaN(t)) return;
    // optional per-question tally — only rows the student actually filled
    const breakdown = rows
      .map((r) => ({
        label: r.label.trim(),
        marks: Number.parseInt(r.marks, 10),
        max: Number.parseInt(r.max, 10),
      }))
      .filter((q) => q.label !== "" && !Number.isNaN(q.marks))
      .map((q) => ({
        label: q.label,
        marks: q.marks,
        max: Number.isNaN(q.max) ? null : q.max,
      }));
    saveMockResult({
      id: `${course}:${paper.sessionId}:${paper.dir}:${startedAtRef.current}`,
      course,
      ref: paper.ref,
      title: paper.title,
      sessionId: paper.sessionId,
      finishedAt: new Date().toISOString(),
      durationMin,
      timeUsedSec: spentSec,
      marks: m,
      total: t,
      ended: endedHow,
      ...(breakdown.length > 0 ? { questions: breakdown } : {}),
    });
    setSaved(true);
    window.setTimeout(() => router.push(backHref), 900);
  };

  const durationLabel = useMemo(() => {
    if (paper.durationMin == null) return "not verified";
    const h = Math.floor(paper.durationMin / 60);
    const m = paper.durationMin % 60;
    return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
  }, [paper.durationMin]);

  // ── per-question breakdown: lazy structure detection at grading time ─────
  useEffect(() => {
    if (mode !== "mock" || mockPhase !== "grading") return;
    let alive = true;
    void (async () => {
      // the MS pane's text index powers this — no second download, no
      // repo-wide question DB; null (scanned/unparseable MS) → manual rows
      const doc = await msPaneRef.current?.extractLines();
      if (!alive) return;
      const detected = doc ? detectMsStructure(doc.flatMap((d) => d.lines)) : null;
      if (detected) {
        setRows(
          detected.map((r, i) => ({
            key: `q${i}`,
            label: r.label,
            marks: "",
            max: r.max != null ? String(r.max) : "",
          })),
        );
        setBreakSource("detected");
      } else {
        setRows([{ key: "q0", label: "", marks: "", max: "" }]);
        setBreakSource("manual");
      }
      setBreakState("ready");
    })();
    return () => {
      alive = false;
    };
  }, [mode, mockPhase]);

  // ── mock overlay: lazy question jump (from QP text, honest fallback) ─────
  useEffect(() => {
    if (mode !== "mock" || mockPhase !== "running") return;
    let alive = true;
    void (async () => {
      const doc = await qpPaneRef.current?.extractLines();
      if (!alive || !doc) return;
      const qs = detectQpQuestions(doc.flatMap((d) => d.lines));
      if (alive && qs) setQpQuestions(qs.slice(0, 30));
    })();
    return () => {
      alive = false;
    };
  }, [mode, mockPhase]);

  const updateRow = useCallback((key: string, field: keyof BreakRow, value: string) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }, []);

  const addRow = useCallback(() => {
    setRows((rs) => [...rs, { key: `q${Date.now()}`, label: "", marks: "", max: "" }]);
  }, []);

  const removeRow = useCallback((key: string) => {
    setRows((rs) =>
      rs.length > 1
        ? rs.filter((r) => r.key !== key)
        : [{ key: `q${Date.now()}`, label: "", marks: "", max: "" }],
    );
  }, []);

  /** Sums over filled rows — "complete" requires marks+max in EVERY row. */
  const rowSum = useMemo(() => {
    if (breakState !== "ready" || rows.length === 0) return null;
    let marks = 0;
    let max = 0;
    let any = false;
    let complete = true;
    for (const r of rows) {
      const m = Number.parseInt(r.marks, 10);
      const x = Number.parseInt(r.max, 10);
      if (Number.isNaN(m) || Number.isNaN(x)) {
        complete = false;
        continue;
      }
      marks += m;
      max += x;
      any = true;
    }
    return { marks, max, complete: complete && any };
  }, [breakState, rows]);

  const mmss = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  // ── MOCK: fullscreen running overlay ─────────────────────────────────────
  if (mockPhase === "running") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Badge variant="destructive" className="gap-1 font-mono tabular-nums" aria-live="off">
              <Timer className="size-3" aria-hidden />
              {mmss(remainingSec)}
            </Badge>
            <span className="min-w-0 truncate text-sm font-semibold">{paper.ref}</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {paper.title} · {sessionLabelStr}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => endMock("self")}
            aria-label="Finish mock and grade"
          >
            <CheckCircle2 className="size-4" aria-hidden />
            Finish & grade
          </Button>
          {qpQuestions && (
            <select
              aria-label="Jump to question"
              value=""
              onChange={(e) => {
                const page = Number(e.target.value);
                if (page >= 1) qpPaneRef.current?.scrollToPage(page);
              }}
              className="h-9 rounded-md border bg-background px-1.5 text-xs"
            >
              <option value="">Jump to…</option>
              {qpQuestions.map((q) => (
                <option key={q.label} value={q.page}>
                  {q.label}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="size-9 px-0"
            onClick={() => endMock("exited")}
            aria-label="Exit mock without grading"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <p className="shrink-0 bg-muted/50 px-3 py-1 text-center text-[11px] text-muted-foreground">
          Exam conditions — solve in your physical notebook. The mark scheme stays hidden until you
          finish.
        </p>
        {qpUrl ? (
          <PdfPane
            ref={qpPaneRef}
            url={qpUrl}
            downloadUrl={qpUrl}
            label={`Question paper — ${paper.ref}`}
            active
            className="min-h-0 flex-1 rounded-none border-0"
          />
        ) : (
          <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No question paper held for this paper.
          </p>
        )}
      </div>
    );
  }

  // ── MOCK: grading screen ─────────────────────────────────────────────────
  if (mockPhase === "grading" && mode === "mock") {
    return (
      <div className="flex min-h-[70vh] flex-col gap-3 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="h-8">
            <Link href={backHref}>
              <ArrowLeft className="size-4" aria-hidden />
              Past Papers
            </Link>
          </Button>
          <Badge variant={endedHow === "time-up" ? "destructive" : "secondary"} className="gap-1">
            {endedHow === "time-up" ? (
              <>
                <Hourglass className="size-3" aria-hidden /> Time&apos;s up
              </>
            ) : (
              <>Finished in {formatSpent(spentSec)}</>
            )}
          </Badge>
          <span className="text-sm font-semibold">{paper.ref}</span>
          <span className="text-xs text-muted-foreground">Grade yourself against the mark scheme</span>
        </div>

        <Card className="border-dashed">
          <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="mock-marks" className="text-sm">
                Your mark
              </Label>
              <Input
                id="mock-marks"
                type="number"
                min={0}
                inputMode="numeric"
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
                placeholder="e.g. 54"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mock-total" className="text-sm">
                Out of (paper total)
              </Label>
              <Input
                id="mock-total"
                type="number"
                min={1}
                inputMode="numeric"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="e.g. 80"
                className="h-9"
              />
            </div>
            <Button onClick={commitResult} disabled={!marks.trim() || !total.trim() || saved} className="h-9">
              {saved ? (
                <>
                  <CheckCircle2 className="size-4" aria-hidden /> Saved
                </>
              ) : (
                "Save result"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* per-question tally — detected from THIS MS's text on this device,
            or plain manual rows; always optional, never claimed authoritative */}
        <Card className="border-dashed">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <ListChecks className="size-4 text-primary" aria-hidden />
              <h3 className="text-sm font-semibold">
                Question breakdown{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </h3>
              {breakState === "loading" ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  reading the mark scheme…
                </span>
              ) : breakSource === "detected" ? (
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  title="Extracted from the mark scheme text in this browser — check it against the paper"
                >
                  auto-detected — check totals
                </Badge>
              ) : null}
              <Button size="sm" variant="ghost" className="ml-auto h-9 text-xs" onClick={addRow}>
                <Plus className="size-3.5" aria-hidden />
                Add question
              </Button>
            </div>
            {breakState === "ready" && (
              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={r.key} className="flex items-center gap-1.5">
                    <Input
                      value={r.label}
                      onChange={(e) => updateRow(r.key, "label", e.target.value)}
                      placeholder="e.g. 2(a)"
                      aria-label={`Question ${i + 1} label`}
                      className="h-8 w-24 shrink-0 text-xs sm:w-28"
                    />
                    <Input
                      value={r.marks}
                      onChange={(e) => updateRow(r.key, "marks", e.target.value)}
                      inputMode="numeric"
                      placeholder="mark"
                      aria-label={`Question ${i + 1} marks scored`}
                      className="h-8 w-16 shrink-0 text-right text-xs"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">/</span>
                    <Input
                      value={r.max}
                      onChange={(e) => updateRow(r.key, "max", e.target.value)}
                      inputMode="numeric"
                      placeholder="max"
                      aria-label={`Question ${i + 1} marks available`}
                      className="h-8 w-16 shrink-0 text-right text-xs"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-9 shrink-0 px-0 text-muted-foreground"
                      onClick={() => removeRow(r.key)}
                      aria-label={`Remove question row ${i + 1}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">
                    {rowSum === null
                      ? "Enter what you scored per question — or just use the totals above."
                      : rowSum.complete
                        ? `Rows sum to ${rowSum.marks} / ${rowSum.max}.`
                        : `Rows sum to ${rowSum.marks ?? "?"} / ${rowSum.max ?? "?!"} — fill marks and max in every row to use them.`}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-9 text-xs"
                    disabled={!rowSum?.complete}
                    onClick={() => {
                      if (rowSum?.complete) {
                        setMarks(String(rowSum.marks));
                        setTotal(String(rowSum.max));
                      }
                    }}
                  >
                    Use for totals
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {msUrl ? (
          <PdfPane
            ref={msPaneRef}
            url={msUrl}
            downloadUrl={msUrl}
            label={`Mark scheme — ${paper.ref}`}
            active
            /* NO flex-1 here: in this auto-height column flex-basis 0% +
               min-height:auto lets the document content stretch the pane to
               its full 40k-page height (the page scrolled 43,380px in E2E).
               A plain h-[60vh] keeps the pane bounded with internal scroll. */
            className="h-[60dvh]"
          />
        ) : (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No mark scheme is held for this paper yet.
          </p>
        )}
      </div>
    );
  }

  // ── MOCK: intro ──────────────────────────────────────────────────────────
  if (mode === "mock") {
    return (
      <div className="space-y-4 pb-6">
        <Button asChild size="sm" variant="ghost" className="h-8">
          <Link href={backHref}>
            <ArrowLeft className="size-4" aria-hidden />
            Past Papers
          </Link>
        </Button>
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Timer className="size-5 text-primary" aria-hidden />
              <h2 className="text-lg font-semibold">Mock exam — {paper.ref}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {paper.title} · {sessionLabelStr} · {paper.specTitle}. The question paper goes
              fullscreen with a countdown; solve in your physical notebook. When you finish (or the
              time is up) you grade yourself against the official mark scheme and the result is
              saved to this browser.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Official duration
                </p>
                <p className="mt-1 text-sm font-semibold">{durationLabel}</p>
                {paper.durationMin == null && (
                  <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
                    <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                    Not attested for this paper — the pre-filled value below is an estimate, adjust
                    it before you begin.
                  </p>
                )}
              </div>
              <div className="space-y-1.5 rounded-lg border p-3">
                <Label htmlFor="mock-duration" className="text-sm">
                  Timer (minutes)
                </Label>
                <Input
                  id="mock-duration"
                  type="number"
                  min={5}
                  max={360}
                  value={durationMin}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    setDurationMin(Number.isNaN(v) ? 0 : Math.min(360, Math.max(5, v)));
                  }}
                  className="h-9 w-28"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={beginMock} disabled={durationMin < 5} className="gap-1.5">
                <Timer className="size-4" aria-hidden />
                Begin mock
              </Button>
              <Button asChild variant="outline">
                <Link href={`/courses/${course}/past-papers/${paper.sessionId}/${paper.dir}?doc=qp`}>
                  <BookOpenCheck className="size-4" aria-hidden />
                  Just view the paper
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── VIEW mode ────────────────────────────────────────────────────────────
  // Layout discipline: the panes fill the viewport below the app header
  // (56px) + this page's 12px top padding — on mobile the sticky course
  // "Menu" bar (49px) is added. Everything else collapses into ONE compact
  // toolbar row; the old breadcrumb + h1 hero + footer note (≈140px) are
  // gone, and the mobile A/B pill floats over the pane instead of pushing it
  // down. Height numbers must stay in sync with the viewer page's padding.
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[420px] flex-col gap-2 lg:h-[calc(100dvh-4.5rem)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="ghost" className="h-8">
          <Link href={backHref}>
            <ArrowLeft className="size-4" aria-hidden />
            Past Papers
          </Link>
        </Button>
        <h1 className="font-mono text-sm font-semibold tracking-tight">{paper.ref}</h1>
        <span className="hidden min-w-0 truncate text-xs text-muted-foreground md:inline">
          {paper.title}
          {paper.variantChip ? ` · ${paper.variantChip}` : ""} · {sessionLabelStr}
        </span>
        {examCode && <ExamCodePill code={examCode} className="hidden py-1 text-[11px] sm:inline-flex" />}
        <Badge
          variant="outline"
          className="hidden text-[10px] md:inline-flex"
          title={`AI-IDENTIFIED corpus — provenance ratification pending · index generated ${metaGeneratedAt.slice(0, 10)}`}
        >
          AI-IDENTIFIED
        </Badge>
        {/* doc switch — three states on desktop (QP | MS | Split). Gated to
            lg+: the two-pane split grid only exists at lg, so exposing the
            Split tab in the 640–1023px band made it a silent no-op. Below lg
            the floating A/B pill is the doc switch (split falls back to QP). */}
        <div className="ml-auto hidden items-center gap-1 rounded-lg border p-1 lg:flex" role="tablist" aria-label="Document view">
          <Button
            size="sm"
            variant={doc === "qp" ? "secondary" : "ghost"}
            className="h-7 text-xs"
            aria-pressed={doc === "qp"}
            disabled={!qpUrl}
            onClick={() => setDoc("qp")}
          >
            Question paper
          </Button>
          <Button
            size="sm"
            variant={doc === "ms" ? "secondary" : "ghost"}
            className="h-7 text-xs"
            aria-pressed={doc === "ms"}
            disabled={!msUrl}
            title={msUrl ? undefined : "No mark scheme held for this paper"}
            onClick={() => setDoc("ms")}
          >
            Mark scheme
          </Button>
          {isSplitCapable && (
            <Button
              size="sm"
              variant={doc === "split" ? "default" : "ghost"}
              className="h-7 text-xs"
              aria-pressed={doc === "split"}
              aria-label="Split view: question paper and mark scheme side by side"
              onClick={() => setDoc("split")}
            >
              Split
            </Button>
          )}
        </div>
      </div>

      {/* pane area — flex row for a single doc, 2-col grid for desktop split.
          Panes are h-full: no fixed 70vh/16rem math, the area below the
          toolbar row is the PDF's to fill. */}
      <div
        className={cn(
          "relative flex min-h-0 flex-1 gap-2",
          isSplitCapable && doc === "split" && "lg:grid lg:grid-cols-2",
        )}
      >
        {/* mobile A/B toggle — floats over the pane's bottom edge so it costs
            zero vertical space; preserves each doc's scroll */}
        {isSplitCapable && (
          <div
            className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background/95 p-1 shadow-md backdrop-blur lg:hidden"
            role="tablist"
            aria-label="Switch document"
          >
            {/* mobile pill: doc === "split" behaves as "qp" (CSS below) */}
            {(["qp", "ms"] as const).map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={doc === d || (doc === "split" && d === "qp")}
                className={cn(
                  "h-8 rounded-full px-4 text-xs font-medium transition-colors",
                  doc === d || (doc === "split" && d === "qp")
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground",
                )}
                onClick={() => setDoc(d)}
              >
                {d === "qp" ? "Question paper" : "Mark scheme"}
              </button>
            ))}
          </div>
        )}
        {qpUrl && (
          <PdfPane
            url={qpUrl}
            downloadUrl={qpUrl}
            label={`Question paper — ${paper.ref}`}
            active={doc === "qp" || doc === "split"}
            className={cn(
              "h-full min-h-0 w-full flex-1",
              doc === "ms" && "hidden",
              doc === "split" && "lg:block", // mobile split falls back to QP-only
            )}
          />
        )}
        {msUrl && (
          <PdfPane
            url={msUrl}
            downloadUrl={msUrl}
            label={`Mark scheme — ${paper.ref}`}
            active={doc === "ms" || doc === "split"}
            className={cn(
              "h-full min-h-0 w-full flex-1",
              doc === "qp" && "hidden",
              doc === "split" && "hidden lg:block",
            )}
          />
        )}
        {!qpUrl && !msUrl && (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No PDFs are held for this paper in the archive yet.
          </p>
        )}
      </div>
    </div>
  );
}
