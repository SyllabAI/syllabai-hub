"use client";

/**
 * Question set player — the SME practice loop (research §6.2–6.4), upgraded:
 *   - difficulty tabs + question-number grid above the question list;
 *   - per-question toolbar: Full screen, Save (bookmark), difficulty chip;
 *   - MCQs are ANSWERABLE (SME parity — live SME markup verified 2026-09-18):
 *     the answer UI is always "Choose your answer" letter buttons → Submit
 *     answer → instant marking (green/red) → "Why this is the answer"
 *     explanation (mark scheme) → Try again. Option CONTENT varies exactly
 *     as on SME: text rows (structured choices), or kept verbatim in the
 *     stem as a composite image / option table; where the import captured no
 *     artwork at all, an honest notice points to the past paper while the
 *     attested answer key still marks instantly;
 *   - structured parts get the SME typed-answer workspace ("Your answer"),
 *     autosaved to the local SIMULATED overlay, plus AI "Mark my answer"
 *     against the mark scheme (server-side provider, AI_SUGGESTED, explicit
 *     apply);
 *   - structured questions: "How did you do?" self-score box (score / marks)
 *     → SIMULATED overlay → sidebar rings react;
 *   - "View answer" → full-screen mark-scheme modal (topic pill, question
 *     restated with Show more, AND-joined marking points with [N mark] tags,
 *     your typed answers shown alongside for comparison);
 *   - "Question help" → the question↔note help panel (revision notes joined
 *     through the question's spec-point codes), with the grounded tutor as
 *     the escape hatch.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Maximize2,
  MinusCircle,
  PenLine,
  RotateCcw,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { QuestionHelpPanel } from "@/components/question-help-panel";
import { Markdown } from "@/components/markdown";
import { PartProblem } from "@/components/part-problem";
import {
  recordMcqAnswer,
  recordSelfScore,
  saveTypedAnswer,
  toggleSavedQuestion,
  useCourseProgress,
  getProgressSnapshot,
  type Course,
} from "@/lib/progress";
import type { ExamQuestion } from "@/lib/contracts";
import { api, ApiError, aiAskErrorMessage } from "@/lib/api";
import type {
  SmartMarkAttemptView,
  SmartMarkFeedbackExplanation,
  SmartMarkImprovementPlan,
  StructuredAttemptResultView,
} from "@/lib/types";
import {
  useAttemptBridge,
  coreEvidenceChanged,
  type AttemptBridgeStatus,
  type BridgeMcqPart,
  type BridgeQuestion,
} from "@/lib/attempt-bridge";
import { cn } from "@/lib/utils";

const DIFFICULTIES = ["all", "easy", "medium", "hard"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

interface McqChoice {
  label: string;
  isCorrect: boolean;
  textMd: string;
}

interface MarkPoint {
  point: string;
  achieved: "yes" | "no" | "unclear";
  comment: string;
}

// ── AI marking availability (module-level — one probe per session) ──────

let aiMarkProbe: Promise<boolean> | null = null;

function aiMarkAvailable(): Promise<boolean> {
  if (!aiMarkProbe) {
    aiMarkProbe = fetch("/api/ai/mark")
      .then((r) => r.json())
      .then((j: { available?: boolean }) => !!j.available)
      .catch(() => false);
  }
  return aiMarkProbe;
}

type MarkState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "done";
      score: number;
      max: number;
      points: MarkPoint[];
      overall: string;
      provider: string;
    };

export function QuestionPlayer({
  course,
  topicName,
  topicSlug,
  subtopicCode,
  subtopicTitle,
  questions,
}: {
  course: Course;
  topicName: string;
  topicSlug: string;
  subtopicCode: string | null;
  subtopicTitle: string | null;
  questions: ExamQuestion[];
}) {
  const progress = useCourseProgress(course);
  const [difficulty, setDifficulty] = useState<Difficulty>("all");
  const [schemeFor, setSchemeFor] = useState<ExamQuestion | null>(null);
  const [fullFor, setFullFor] = useState<ExamQuestion | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // 4CH1 bridge — resolves this set's corpus questions to core identity when
  // the course is the pilot and the learner is signed in (ADR-029 tranche 4)
  const bridge = useAttemptBridge(course, topicSlug);

  const counts = useMemo(() => {
    const c: Record<Difficulty, number> = { all: questions.length, easy: 0, medium: 0, hard: 0 };
    for (const q of questions) {
      const d = (q.difficulty as Difficulty) ?? "medium";
      if (d in c) c[d] += 1;
    }
    return c;
  }, [questions]);

  const visible = useMemo(
    () =>
      difficulty === "all"
        ? questions
        : questions.filter((q) => (q.difficulty ?? "medium") === difficulty),
    [questions, difficulty],
  );

  const isAttempted = (q: ExamQuestion) =>
    !!progress.selfScores[q.id] || q.parts.some((p) => !!progress.mcqAnswers[p.id]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-5">
      {/* 4CH1 bridge status — one honest line, never a blocker */}
      <BridgeBanner status={bridge} />

      {/* difficulty tabs + guided practice (SME controls, research §6.2) */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={difficulty === d}
              onClick={() => setDifficulty(d)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13px] font-medium capitalize transition-colors",
                difficulty === d
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {d === "all" ? "All" : d}
              <span className="ml-1.5 text-[11px] tabular-nums opacity-70">{counts[d]}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex cursor-not-allowed items-center gap-2 text-[13px] text-muted-foreground" title="Adaptive sessions are Phase C of the build plan">
          Guided practice
          <Switch disabled aria-label="Guided practice (roadmap)" />
        </label>
      </div>

      {/* question number grid (SME) */}
      <div ref={gridRef} className="flex flex-wrap gap-1.5" aria-label="Jump to question">
        {visible.map((q, i) => (
          <button
            key={q.id}
            onClick={() => scrollTo(`q-${q.id}`)}
            aria-label={`Question ${i + 1}${isAttempted(q) ? " (attempted)" : ""}`}
            className={cn(
              "flex size-9 items-center justify-center rounded-md border text-[13px] font-medium transition-colors",
              isAttempted(q)
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:border-primary/50 hover:text-primary",
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* questions */}
      <div className="space-y-4">
        {visible.map((q, qi) => (
          <article key={q.id} id={`q-${q.id}`} className="scroll-mt-24 rounded-xl border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
              <span className="rounded-md bg-muted px-2 py-0.5 text-[13px] font-semibold">{qi + 1}</span>
              <Badge variant="outline" className="text-[10px]">
                {q.totalMarks} mark{q.totalMarks === 1 ? "" : "s"}
              </Badge>
              {q.difficulty && (
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {q.difficulty}
                </Badge>
              )}
              {isAttempted(q) && (
                <Badge variant="outline" className="border-success/30 text-[10px] text-success">
                  <CheckCircle2 className="mr-0.5 size-3" aria-hidden /> attempted
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 px-2 text-xs"
                  onClick={() => setFullFor(q)}
                >
                  <Maximize2 className="size-3.5" aria-hidden /> Full screen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 px-2 text-xs"
                  onClick={() => toggleSavedQuestion(course, q.id, topicSlug, subtopicCode)}
                  aria-pressed={!!progress.saved[q.id]}
                >
                  {progress.saved[q.id] ? (
                    <>
                      <BookmarkCheck className="size-3.5 text-primary" aria-hidden /> Saved
                    </>
                  ) : (
                    <>
                      <Bookmark className="size-3.5" aria-hidden /> Save
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="px-4 py-4">
              <QuestionBody
                course={course}
                question={q}
                topicSlug={topicSlug}
                subtopicCode={subtopicCode}
                subtopicTitle={subtopicTitle}
                onViewModel={() => setSchemeFor(q)}
                bridge={bridge}
              />
            </div>
          </article>
        ))}
        {visible.length === 0 && (
          <p className="rounded-lg border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            No {difficulty} questions in this set.
          </p>
        )}
      </div>

      {/* full-screen question */}
      <Dialog open={!!fullFor} onOpenChange={(o) => !o && setFullFor(null)}>
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {topicName}
              {fullFor && <Badge variant="outline" className="text-[10px]">{fullFor.totalMarks} marks</Badge>}
            </DialogTitle>
          </DialogHeader>
          {fullFor && (
            <QuestionBody
              course={course}
              question={fullFor}
              topicSlug={topicSlug}
              subtopicCode={subtopicCode}
              subtopicTitle={subtopicTitle}
              onViewModel={() => {
                setSchemeFor(fullFor);
              }}
              bridge={bridge}
            />
          )}
        </DialogContent>
      </Dialog>

      <MarkSchemeDialog
        course={course}
        question={schemeFor}
        topicName={topicName}
        subtopicTitle={subtopicTitle}
        onClose={() => setSchemeFor(null)}
      />
    </div>
  );
}

// ── bridge status banner — one honest line, never a blocker ──────────────

function BridgeBanner({ status }: { status: AttemptBridgeStatus }) {
  if (status.kind === "ready") {
    const skipped = status.data.skipped.length;
    return (
      <div className="rounded-lg border border-success/25 bg-success/5 px-4 py-2.5 text-[13px] leading-relaxed">
        <span className="inline-flex items-center gap-1.5 font-medium text-success">
          <CheckCircle2 className="size-3.5" aria-hidden /> Live · SyllabAI core
        </span>{" "}
        <span className="text-muted-foreground">
          answers in this set are recorded to your real learner model — Smart Mark,
          mastery, review queue and history update from the backend.
        </span>
        {skipped > 0 && (
          <span className="text-muted-foreground">
            {" "}({skipped} question{skipped === 1 ? "" : "s"} could not be verified against the
            backend and stay local-only.)
          </span>
        )}
      </div>
    );
  }
  if (status.kind === "unauthenticated") {
    return (
      <div className="rounded-lg border bg-muted/30 px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
        Practice works locally right now.{" "}
        <a href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
          Sign in
        </a>{" "}
        to record answers to your real SyllabAI learner model (the pilot subject is
        connected to the backend — Smart Mark, mastery and history).
      </div>
    );
  }
  return null;
}

// ── question body (shared by list + full-screen) ────────────────────────

function QuestionBody({
  course,
  question,
  topicSlug,
  subtopicCode,
  subtopicTitle,
  onViewModel,
  bridge,
}: {
  course: Course;
  question: ExamQuestion;
  topicSlug: string;
  subtopicCode: string | null;
  subtopicTitle: string | null;
  onViewModel: () => void;
  bridge: AttemptBridgeStatus;
}) {
  const progress = useCourseProgress(course);
  const [scoreDraft, setScoreDraft] = useState<string>("");
  const [helpOpen, setHelpOpen] = useState(false);
  const anchorSpec = question.parts.flatMap((p) => p.specPointCodes)[0] ?? null;
  const helpHref = `/tutor?q=${encodeURIComponent(
    `Help me with this exam question: ${firstLine(question)} — walk me through how to answer it`,
  )}${anchorSpec ? `&spec=${encodeURIComponent(anchorSpec)}` : ""}`;
  const recorded = progress.selfScores[question.id];

  /** SME: MCQs are marked instantly — no manual "How did you do?" box.
   * Mixed MCQ+structured questions keep the self-score box (their MCQ parts
   * still record instant per-part marks). */
  const autoMarked =
    question.parts.length > 0 &&
    question.parts.every((p) => p.questionType === "multiple_choice" && hasAnswerKey(p));

  const coreJoin: BridgeQuestion | null =
    bridge.kind === "ready" ? (bridge.data.questions[question.id] ?? null) : null;
  const coreLive = bridge.kind === "ready" && coreJoin !== null;

  return (
    <div className="space-y-4">
      {question.parts.map((p, idx) => {
        if (p.questionType === "multiple_choice") {
          return (
            <McqPart
              key={p.id}
              course={course}
              part={p}
              topicSlug={topicSlug}
              subtopicCode={subtopicCode}
              optionsVisible={mcqOptionsVisible(question, idx)}
              onViewModel={onViewModel}
              coreJoin={coreJoin?.mcq[p.id] ?? null}
            />
          );
        }
        return (
          <StructuredPart
            key={p.id}
            course={course}
            question={question}
            part={p}
            topicSlug={topicSlug}
            subtopicCode={subtopicCode}
            showPartBadge={question.parts.length > 1}
            coreLive={coreLive}
          />
        );
      })}

      {/* 4CH1 bridge — real attempts + Smart Mark on the learner's core
          account (pilot + signed in + join verified for this question) */}
      {coreLive && coreJoin && coreJoin.structured.length > 0 && (
        <CoreMarkingFlow course={course} question={question} join={coreJoin} topicSlug={topicSlug} subtopicCode={subtopicCode} />
      )}

      {/* SME self-marking footer (research §6.3, figure 10) — structured only;
          auto-marked MCQs already recorded their mark on submit */}
      <div className="flex flex-wrap items-center gap-3 border-t pt-3">
        {!autoMarked && (
          <>
            <label className="flex items-center gap-2 text-[13px]">
              How did you do?
              <span className="inline-flex items-center gap-1">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={question.totalMarks}
                  value={scoreDraft}
                  onChange={(e) => setScoreDraft(e.target.value)}
                  placeholder="–"
                  aria-label={`Self score out of ${question.totalMarks}`}
                  className="h-9 w-16 text-center"
                />
                <span className="text-muted-foreground">/ {question.totalMarks}</span>
              </span>
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={scoreDraft === "" || Number.isNaN(Number(scoreDraft))}
              onClick={() => {
                const v = Math.max(0, Math.min(question.totalMarks, Number(scoreDraft)));
                recordSelfScore(course, question.id, topicSlug, subtopicCode, v, question.totalMarks);
                setScoreDraft(String(v));
              }}
            >
              Save score
            </Button>
          </>
        )}
        {recorded && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="size-3.5" aria-hidden /> {recorded.score}/{recorded.max} recorded
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-xs"
            onClick={() => setHelpOpen((o) => !o)}
            aria-expanded={helpOpen}
          >
            <BookOpen className="size-3.5" aria-hidden /> Question help
          </Button>
          <Button size="sm" variant="outline" onClick={onViewModel}>
            View answer
          </Button>
        </div>
      </div>

      {/* the question↔note cross-link: notes joined through the question's
          spec-point codes, bodies lazy on expand (web parity, ADR-026) */}
      {helpOpen && (
        <QuestionHelpPanel
          course={course}
          questionId={question.id}
          specPointCodes={question.parts.flatMap((p) => p.specPointCodes)}
          tutorHref={helpHref}
        />
      )}
    </div>
  );
}

// ── structured part (statement + SME typed-answer workspace) ───────────

function StructuredPart({
  course,
  question,
  part,
  topicSlug,
  subtopicCode,
  showPartBadge,
  coreLive,
}: {
  course: Course;
  question: ExamQuestion;
  part: ExamQuestion["parts"][number];
  topicSlug: string;
  subtopicCode: string | null;
  showPartBadge: boolean;
  coreLive: boolean;
}) {
  return (
    <div className="space-y-2">
      {/* SME (figure 16): per-part marks right-aligned, no chips/spec codes on
          the learner face. Single-part questions dedupe — the header badge
          already carries the total (figure 24). */}
      {showPartBadge && (
        <div className="flex items-center">
          <span className="ml-auto text-xs text-muted-foreground">
            {part.marks} mark{part.marks === 1 ? "" : "s"}
          </span>
        </div>
      )}
      <PartProblem md={part.problemMd} />
      {part.solutionMd && (
        <TypedAnswerWorkspace
          course={course}
          question={question}
          part={part}
          topicSlug={topicSlug}
          subtopicCode={subtopicCode}
          coreLive={coreLive}
        />
      )}
    </div>
  );
}

// ── typed-answer workspace (SME "type your answer" + "Mark my answer") ──

function TypedAnswerWorkspace({
  course,
  question,
  part,
  topicSlug,
  subtopicCode,
  coreLive,
}: {
  course: Course;
  question: ExamQuestion;
  part: ExamQuestion["parts"][number];
  topicSlug: string;
  subtopicCode: string | null;
  coreLive: boolean;
}) {
  const progress = useCourseProgress(course);
  const savedText = progress.typedAnswers[part.id]?.text ?? "";
  const [text, setText] = useState(savedText);
  const [justSaved, setJustSaved] = useState(false);
  const [probedAi, setProbedAi] = useState<boolean | null>(null);
  const [mark, setMark] = useState<MarkState>({ kind: "idle" });
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    // the old free-text AI marking lane is superseded by core Smart Mark
    // whenever the bridge is live for this question — probe only then
    if (coreLive) return;
    let live = true;
    aiMarkAvailable().then((v) => live && setProbedAi(v));
    return () => {
      live = false;
    };
  }, [coreLive]);
  /** derived, not state: when the core flow owns this question the legacy
   *  lane is deterministically off — no effect-time setState needed */
  const aiAvailable = coreLive ? false : probedAi;

  const persist = (value: string) => {
    saveTypedAnswer(course, part.id, value);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
  };

  const onType = (value: string) => {
    setText(value);
    // save synchronously (no debounce): the question-level "Submit for
    // marking" reads the store, so a fast click right after typing must
    // still submit the current text — a stale submission would be fake
    // evidence. The payload is small; per-keystroke persistence is cheap.
    persist(value);
  };

  const flushNow = () => {
    if (text !== savedText) persist(text);
  };

  const canMark = aiAvailable === true && text.trim().length > 0 && mark.kind !== "loading";

  const runMark = async () => {
    if (!canMark) return;
    setMark({ kind: "loading" });
    setApplied(false);
    try {
      const res = await fetch("/api/ai/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemMd: part.problemMd.slice(0, 6000),
          solutionMd: (part.solutionMd ?? "").slice(0, 6000),
          marks: part.marks,
          answer: text.slice(0, 4000),
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        score?: number;
        max?: number;
        points?: MarkPoint[];
        overall?: string;
        provider?: string;
        detail?: string;
      };
      if (!res.ok || !j.ok) {
        setMark({
          kind: "error",
          message:
            j.detail ??
            "AI marking is unavailable right now — use “How did you do?” to self-mark instead.",
        });
        return;
      }
      setMark({
        kind: "done",
        score: j.score ?? 0,
        max: j.max ?? part.marks,
        points: j.points ?? [],
        overall: j.overall ?? "",
        provider: j.provider ?? "ai",
      });
    } catch {
      setMark({
        kind: "error",
        message: "Network error while marking — use “How did you do?” to self-mark instead.",
      });
    }
  };

  const singlePart = question.parts.length === 1;

  return (
    <div className="mt-3 rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <PenLine className="size-3.5 text-primary" aria-hidden />
        <span className="text-[13px] font-medium">Your answer</span>
        <Badge
          variant="outline"
          className={cn(
            "px-1 text-[10.5px] uppercase",
            coreLive ? "border-success/30 text-success" : "text-muted-foreground",
          )}
        >
          {coreLive ? "live draft" : "simulated"}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          {coreLive ? "saved in this browser — submit below to mark it" : "saved in this browser"}
        </span>
        {justSaved && (
          <span className="inline-flex items-center gap-1 text-[11px] text-success">
            <CheckCircle2 className="size-3" aria-hidden /> saved
          </span>
        )}
      </div>
      <Textarea
        value={text}
        onChange={(e) => onType(e.target.value)}
        onBlur={flushNow}
        rows={4}
        aria-label={`Your typed answer for part ${part.order + 1}`}
        placeholder="Type your answer here…"
        className="min-h-24 bg-background text-[13px]"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {aiAvailable !== false ? (
          <Button size="sm" variant="outline" disabled={!canMark} onClick={runMark} className="gap-1.5 text-xs">
            {mark.kind === "loading" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5 text-primary" aria-hidden />
            )}
            Mark my answer
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            AI marking needs a provider key on the server — self-mark via “How did you do?” below.
          </span>
        )}
        {mark.kind !== "loading" && mark.kind !== "idle" && (
          <Button asChild size="sm" variant="ghost" className="text-xs">
            <a
              href={`/tutor?q=${encodeURIComponent(
                `I answered: "${text.slice(0, 300)}" — how could my answer to this question be improved? ${firstLine(question)}`,
              )}`}
            >
              Ask the tutor how to improve
            </a>
          </Button>
        )}
      </div>

      {mark.kind === "error" && (
        <p className="mt-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn-ink">
          {mark.message}
        </p>
      )}

      {mark.kind === "done" && (
        <div className="mt-3 space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="gap-1 text-[11px]">
              <Sparkles className="size-3" aria-hidden /> AI-suggested mark: {mark.score}/{mark.max}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              via {mark.provider} · AI_SUGGESTED — check against the mark scheme
            </span>
            {singlePart && !applied && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 text-xs"
                onClick={() => {
                  recordSelfScore(course, question.id, topicSlug, subtopicCode, mark.score, mark.max);
                  setApplied(true);
                }}
              >
                Apply score
              </Button>
            )}
            {applied && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="size-3.5" aria-hidden /> applied
              </span>
            )}
          </div>
          <ul className="space-y-1.5">
            {mark.points.map((pt, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed">
                {pt.achieved === "yes" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : pt.achieved === "no" ? (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                ) : (
                  <MinusCircle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                )}
                <span>
                  <span className="font-medium">{pt.point}</span>
                  {pt.comment ? <span className="text-muted-foreground"> — {pt.comment}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {mark.overall && (
            <div className="border-t pt-2 text-[13px]">
              <Markdown>{mark.overall}</Markdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MCQ part — answerable, marked instantly (SME, research figure 24) ───

function hasUsableChoices(part: ExamQuestion["parts"][number]): boolean {
  const c = part.choices;
  return !!c && c.length > 0 && c.some((o) => o.label && o.textMd.trim());
}

/**
 * SME parity (live SME markup verified 2026-09-18): the answer UI is always
 * the letter buttons; option CONTENT may be text rows, a composite image, or
 * table rows kept verbatim in the stem. A part is answerable whenever the
 * corpus carries an attested key — labeled choices with exactly one
 * isCorrect flag — regardless of whether option text was captured.
 */
function hasAnswerKey(part: ExamQuestion["parts"][number]): boolean {
  const c = part.choices;
  if (!c || c.length < 2) return false;
  return c.every((o) => !!o.label) && c.filter((o) => o.isCorrect).length === 1;
}

/**
 * True when the option content for the MCQ part at `idx` is visible to the
 * learner: own stem media (composite image / option table) or an earlier
 * part's media (SME's "Which of the symbols in (a)…" pattern, where the
 * stimulus diagram is a separate part of the same question).
 */
function mcqOptionsVisible(question: ExamQuestion, idx: number): boolean {
  const IMG = /!\[[^\]]*\]\([^)]+\)|<img\b/;
  const TABLE = /^\s*\|.+\|$/m;
  for (let i = 0; i <= idx; i++) {
    const md = question.parts[i]?.problemMd ?? "";
    if (IMG.test(md) || TABLE.test(md)) return true;
  }
  return false;
}

function McqPart({
  course,
  part,
  topicSlug,
  subtopicCode,
  optionsVisible,
  onViewModel,
  coreJoin,
}: {
  course: Course;
  part: ExamQuestion["parts"][number];
  topicSlug: string;
  subtopicCode: string | null;
  /** option content is visible somewhere (stem media or an earlier part) */
  optionsVisible: boolean;
  onViewModel: () => void;
  /** core identity for this part, when the 4CH1 bridge verified the join */
  coreJoin: BridgeMcqPart | null;
}) {
  const progress = useCourseProgress(course);
  // 182 questions carry more than one MCQ part — key attempts by part id
  const key = part.id;
  const answer = progress.mcqAnswers[key];
  // response time is measured from mount to submit — core's learner model
  // uses it as fluency telemetry (Paper B §3.5)
  const shownAt = useRef(Date.now());
  const [coreState, setCoreState] = useState<"idle" | "sending" | "recorded" | "failed">(
    "idle",
  );

  const keyedText = hasUsableChoices(part);
  const letterOnly = !keyedText && hasAnswerKey(part);

  const options: McqChoice[] = useMemo(() => {
    if (keyedText) {
      return part.choices!.map((c) => ({ label: c.label, isCorrect: c.isCorrect, textMd: c.textMd }));
    }
    if (letterOnly) {
      // SME: option content may live in the stem (composite image / table);
      // the answer UI is the letter buttons alone
      return part.choices!.map((c) => ({ label: c.label, isCorrect: c.isCorrect, textMd: "" }));
    }
    // legacy fallback: options inline in the problem markdown (correct letter
    // parsed from the mark scheme) — still never invented
    const correct = parseCorrectOption(part.solutionMd);
    return parseOptions(part.problemMd).map((o) => ({
      label: o.letter,
      isCorrect: correct === o.letter,
      textMd: o.text,
    }));
  }, [part, keyedText, letterOnly]);

  const correctLabel = useMemo(() => options.find((o) => o.isCorrect)?.label ?? null, [options]);
  const [chosen, setChosen] = useState<string | null>(answer?.chosen ?? null);
  const [submitted, setSubmitted] = useState<boolean>(!!answer);
  const [showWhy, setShowWhy] = useState(true);
  const answerable = options.length > 0 && correctLabel !== null;

  const submit = () => {
    if (!chosen) return;
    recordMcqAnswer(course, key, topicSlug, subtopicCode, chosen, chosen === correctLabel);
    setSubmitted(true);
    // 4CH1 bridge — the same answer becomes a REAL attempt on the learner's
    // core account. Fire-and-observe: the local ring recorded already; the
    // core write is reported honestly and never blocks the instant mark.
    if (coreJoin && !coreStateRecorded()) {
      const optionId = coreJoin.options[chosen];
      if (optionId) {
        setCoreState("sending");
        api
          .submitAttempt({
            questionId: coreJoin.questionId,
            chosenOptionId: optionId,
            responseTimeMs: Math.max(0, Date.now() - shownAt.current),
            confidence: null,
            selfDoubtFlag: false,
            timedCondition: false,
          })
          .then(() => {
            setCoreState("recorded");
            coreEvidenceChanged();
          })
          .catch(() => setCoreState("failed"));
      }
    }
  };

  /** a recorded core attempt must not be re-submitted on "Try again" —
   * evidence is immutable; trying again is local practice only */
  const coreStateRecorded = () => coreState === "recorded" || coreState === "sending";

  return (
    <div className="space-y-3">
      <PartProblem
        md={keyedText || letterOnly ? part.problemMd : stripOptionLines(part.problemMd)}
      />
      {answerable ? (
        <>
          <p className="text-[13px] font-medium">Choose your answer</p>
          {letterOnly && !optionsVisible && (
            <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn-ink">
              The option artwork for this question (diagrams on the source site) was not captured
              by the authorized import — the demo never fabricates content. Refer to your past
              paper, or use <span className="font-medium">Question help</span> to work through it
              with the tutor. The answer key is attested, so you can still commit an answer below.
            </div>
          )}
          {keyedText ? (
          <div className="space-y-2" role="radiogroup" aria-label="MCQ options">
            {options.map((o) => {
              const isChosen = chosen === o.label;
              const showCorrect = submitted && o.isCorrect;
              const showWrong = submitted && isChosen && !o.isCorrect;
              return (
                <div
                  key={o.label}
                  role="radio"
                  aria-checked={isChosen}
                  tabIndex={submitted ? -1 : 0}
                  onClick={() => !submitted && setChosen(o.label)}
                  onKeyDown={(e) => {
                    if (submitted) return;
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      setChosen(o.label);
                    }
                  }}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    submitted && "cursor-default",
                    showWrong
                      ? "border-destructive/40 bg-destructive/10"
                      : showCorrect
                        ? "border-success/40 bg-success/10"
                        : isChosen
                          ? "border-primary bg-primary/5"
                          : "hover:border-primary/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold",
                      showWrong
                        ? "border-destructive/40 bg-destructive/15 text-destructive"
                        : showCorrect
                          ? "border-success/40 bg-success/15 text-success"
                          : isChosen
                            ? "border-primary bg-primary/10 text-primary"
                            : "text-primary",
                    )}
                    aria-hidden
                  >
                    {o.label}
                  </span>
                  <span className="flex-1 text-[13px] leading-relaxed">
                    <Markdown>{o.textMd}</Markdown>
                  </span>
                  {showCorrect && (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  )}
                  {showWrong && <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
                </div>
              );
            })}
          </div>
          ) : (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="MCQ answer letters">
              {options.map((o) => {
                const isChosen = chosen === o.label;
                const showCorrect = submitted && o.isCorrect;
                const showWrong = submitted && isChosen && !o.isCorrect;
                return (
                  <button
                    key={o.label}
                    role="radio"
                    aria-checked={isChosen}
                    disabled={submitted}
                    onClick={() => setChosen(o.label)}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full border text-sm font-semibold transition-colors",
                      showWrong
                        ? "border-destructive/40 bg-destructive/15 text-destructive"
                        : showCorrect
                          ? "border-success/40 bg-success/15 text-success"
                          : isChosen
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-primary hover:border-primary/60 hover:bg-primary/5",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {!submitted ? (
              <Button size="sm" disabled={!chosen} onClick={submit}>
                Submit answer
              </Button>
            ) : (
              <>
                <p
                  className={cn(
                    "text-[13px] font-medium",
                    chosen === correctLabel
                      ? "text-success"
                      : "text-destructive",
                  )}
                >
                  {chosen === correctLabel
                    ? "Correct — well done."
                    : `Not quite. The correct answer is ${correctLabel}.`}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-xs text-muted-foreground"
                  onClick={() => {
                    setChosen(null);
                    setSubmitted(false);
                    setShowWhy(true);
                  }}
                >
                  <RotateCcw className="size-3.5" aria-hidden /> Try again
                </Button>
                {coreJoin && coreState === "sending" && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" aria-hidden /> recording to your learner model…
                  </span>
                )}
                {coreJoin && coreState === "recorded" && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-success">
                    <CheckCircle2 className="size-3" aria-hidden /> recorded to your learner model
                  </span>
                )}
                {coreJoin && coreState === "failed" && (
                  <span className="text-[11px] text-warn">
                    not recorded (backend unreachable) — your local mark is safe
                  </span>
                )}
              </>
            )}
          </div>
          {submitted && part.solutionMd && (
            <div className="rounded-lg border bg-muted/20">
              <button
                className="flex w-full items-center gap-1.5 px-3 py-2 text-[13px] font-medium"
                onClick={() => setShowWhy((v) => !v)}
                aria-expanded={showWhy}
              >
                {showWhy ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
                Why this is the answer
              </button>
              {showWhy && (
                <div className="border-t px-3 py-2">
                  <Markdown>{part.solutionMd}</Markdown>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn-ink">
          This is a multiple-choice question, but its option content and answer key were not
          captured by the authorized import — the demo never fabricates content. Use{" "}
          <button className="font-medium underline underline-offset-2" onClick={onViewModel}>
            View answer
          </button>{" "}
          for the final answer and explanation.
        </div>
      )}
    </div>
  );
}

// ── core marking flow — real attempt → Smart Mark → coaching (4CH1) ──────

function markFlowError(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) {
    return "This attempt was already settled — the marks you see are the recorded ones.";
  }
  return aiAskErrorMessage(
    e,
    "The backend marking pipeline is unavailable right now — your answers are saved locally; try again in a moment.",
  );
}

/**
 * The pilot's real practice loop for structured questions: submit every
 * typed answer as a REAL attempt on the learner's core account, then Smart
 * Mark it through core's κ-gated pipeline, then the two coaching actions
 * (feedback explanation / improvement plan) per part. Everything renders
 * core's own decisions — the hub never invents a mark, and the honest
 * `authoritative` flag is shown, κ gate and all.
 */
function CoreMarkingFlow({
  course,
  question,
  join,
  topicSlug,
  subtopicCode,
}: {
  course: Course;
  question: ExamQuestion;
  join: BridgeQuestion;
  topicSlug: string;
  subtopicCode: string | null;
}) {
  const progress = useCourseProgress(course);
  const shownAt = useRef(Date.now());
  const [phase, setPhase] = useState<
    "draft" | "submitting" | "submitted" | "marking" | "marked"
  >("draft");
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<StructuredAttemptResultView[]>([]);
  const [marks, setMarks] = useState<SmartMarkAttemptView[]>([]);
  const [applied, setApplied] = useState(false);
  const [extras, setExtras] = useState<
    Record<string, SmartMarkFeedbackExplanation | SmartMarkImprovementPlan | "loading" | "error">
  >({});

  const structuredHubParts = question.parts.filter(
    (p) => p.questionType !== "multiple_choice",
  );
  const answerFor = (hubPartId: string) =>
    progress.typedAnswers[hubPartId]?.text ?? "";
  const hasAnyText = structuredHubParts.some((p) => answerFor(p.id).trim().length > 0);

  /** core part UUID → hub part (labels/prompts stay corpus-rendered) */
  const hubByCorePartId = useMemo(() => {
    const m = new Map<string, ExamQuestion["parts"][number]>();
    for (const sub of join.structured) {
      for (const [hubPartId, corePartId] of Object.entries(sub.parts)) {
        const hub = structuredHubParts.find((p) => p.id === hubPartId);
        if (hub) m.set(corePartId, hub);
      }
    }
    return m;
  }, [join, structuredHubParts]);

  const submit = async () => {
    setPhase("submitting");
    setError(null);
    try {
      const results = await Promise.all(
        join.structured.map((sub) =>
          api.submitStructuredAttempt({
            questionId: sub.questionId,
            partAnswers: Object.entries(sub.parts).map(([hubPartId, corePartId]) => ({
              partId: corePartId,
              answerText: answerFor(hubPartId),
            })),
            responseTimeMs: Math.max(0, Date.now() - shownAt.current),
            confidence: null,
            selfDoubtFlag: false,
            timedCondition: false,
          }),
        ),
      );
      setAttempts(results);
      setPhase("submitted");
      coreEvidenceChanged();
    } catch (e) {
      setError(markFlowError(e));
      setPhase("draft");
    }
  };

  const smartMark = async () => {
    setPhase("marking");
    setError(null);
    try {
      const results = await Promise.all(
        attempts.map((a) => api.smartMarkAttempt(a.attemptId)),
      );
      setMarks(results);
      setPhase("marked");
      coreEvidenceChanged();
    } catch (e) {
      setError(markFlowError(e));
      setPhase("submitted");
    }
  };

  const loadExtra = async (attemptId: string, partId: string, kind: "explain" | "improve") => {
    const key = `${kind}:${partId}`;
    setExtras((prev) => ({ ...prev, [key]: "loading" }));
    try {
      const res =
        kind === "explain"
          ? await api.explainSmartFeedback(attemptId, partId)
          : await api.smartImprovementPlan(attemptId, partId);
      setExtras((prev) => ({ ...prev, [key]: res }));
    } catch {
      setExtras((prev) => ({ ...prev, [key]: "error" }));
    }
  };

  const totalAwarded = marks.reduce(
    (a, m) => a + m.parts.reduce((s, p) => s + (p.marksAwarded ?? 0), 0),
    0,
  );
  const totalPossible = marks.reduce((a, m) => a + m.marksPossible, 0);
  const anyAuthoritative = marks.some((m) => m.parts.some((p) => p.authoritative));

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/[0.03] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 text-primary" aria-hidden />
        <span className="text-[13px] font-medium">Submit for marking — SyllabAI core</span>
        <Badge variant="outline" className="border-success/30 px-1 text-[10.5px] uppercase text-success">
          live
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          your written answers go to your real learner account
        </span>
      </div>

      {/* phase machine */}
      {(phase === "draft" || phase === "submitting") && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!hasAnyText || phase === "submitting"} onClick={submit}>
            {phase === "submitting" ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Submitting…
              </>
            ) : (
              "Submit answers"
            )}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {hasAnyText
              ? "then Smart Mark marks every part against the mark scheme"
              : "type an answer above first"}
          </span>
        </div>
      )}

      {(phase === "submitted" || phase === "marking" || phase === "marked") && phase !== "marked" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success">
            <CheckCircle2 className="size-3.5" aria-hidden /> Answers submitted
          </span>
          <Button size="sm" variant="outline" disabled={phase === "marking"} onClick={smartMark}>
            {phase === "marking" ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Marking…
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" aria-hidden /> Smart Mark my answers
              </>
            )}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            AI marks each part through the marking pipeline; marks drive your mastery
          </span>
        </div>
      )}

      {phase === "marked" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="gap-1 text-[11px]">
              <Sparkles className="size-3" aria-hidden /> Smart Mark: {totalAwarded}/{totalPossible}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {anyAuthoritative
                ? "authoritative marks — they feed your mastery and review schedule"
                : "indicative marks — the pipeline's κ release gate hasn't certified this batch yet, so treat them as AI-suggested and check against the scheme"}
            </span>
            {!applied && !progress.selfScores[question.id] && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 text-xs"
                onClick={() => {
                  recordSelfScore(
                    course,
                    question.id,
                    topicSlug,
                    subtopicCode,
                    totalAwarded,
                    Math.max(1, totalPossible || question.totalMarks),
                  );
                  setApplied(true);
                }}
              >
                Apply score
              </Button>
            )}
            {(applied || progress.selfScores[question.id]) && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="size-3.5" aria-hidden /> applied
              </span>
            )}
          </div>

          {marks.map((m) =>
            m.parts.map((p) => {
              const hub = hubByCorePartId.get(p.partId);
              const explainKey = `explain:${p.partId}`;
              const improveKey = `improve:${p.partId}`;
              const explain = extras[explainKey];
              const improve = extras[improveKey];
              return (
                <div key={p.partId} className="rounded-lg border bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">
                      Part {p.label}
                      {hub && question.parts.filter((x) => x.questionType !== "multiple_choice").length > 1
                        ? ` · ${hub.marks} mark${hub.marks === 1 ? "" : "s"}`
                        : ""}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[11px]",
                        p.marksAwarded > 0 ? "border-success/40 text-success" : "text-destructive",
                      )}
                    >
                      {p.marksAwarded}/{p.marksPossible}
                    </Badge>
                    {!p.authoritative && (
                      <Badge variant="secondary" className="text-[10px]">
                        indicative · κ gate
                      </Badge>
                    )}
                    {p.modelId && (
                      <span className="text-[10.5px] text-muted-foreground">via {p.modelId}</span>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={explain === "loading"}
                        onClick={() => loadExtra(m.attemptId, p.partId, "explain")}
                      >
                        {explain === "loading" ? (
                          <Loader2 className="size-3 animate-spin" aria-hidden />
                        ) : (
                          "Explain my feedback"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={improve === "loading"}
                        onClick={() => loadExtra(m.attemptId, p.partId, "improve")}
                      >
                        {improve === "loading" ? (
                          <Loader2 className="size-3 animate-spin" aria-hidden />
                        ) : (
                          "Improve my answer"
                        )}
                      </Button>
                    </div>
                  </div>

                  {p.breakdown.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {p.breakdown.map((d, i) => (
                        <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed">
                          {d.awarded ? (
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                          ) : (
                            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                          )}
                          <span>
                            <span className="font-medium">{d.pointLabel ?? d.ref ?? "mark point"}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              — {d.rationale || d.evidence} [{d.marksAwarded}/{d.marks}]
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {explain === "error" && (
                    <p className="mt-2 text-xs text-warn">
                      The explanation could not be generated — try again in a moment.
                    </p>
                  )}
                  {improve === "error" && (
                    <p className="mt-2 text-xs text-warn">
                      The improvement plan could not be generated — try again in a moment.
                    </p>
                  )}
                  {explain && explain !== "loading" && explain !== "error" && "explanation" in explain && (
                    <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-2.5">
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Why this feedback
                      </p>
                      <div className="text-[13px] leading-relaxed">
                        <Markdown>{explain.explanation}</Markdown>
                      </div>
                    </div>
                  )}
                  {improve && improve !== "loading" && improve !== "error" && "plan" in improve && (
                    <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-2.5">
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        How to improve
                      </p>
                      <div className="text-[13px] leading-relaxed">
                        <Markdown>{improve.plan}</Markdown>
                      </div>
                    </div>
                  )}
                </div>
              );
            }),
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn-ink">
          {error}
        </p>
      )}
    </div>
  );
}

// ── option parsing helpers (legacy inline-options fallback) ─────────────

function parseOptions(problemMd: string): { letter: string; text: string }[] {
  const lines = problemMd.split("\n");
  const opts: { letter: string; text: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-D])[\.\)]\s+(.+)$/);
    if (m) opts.push({ letter: m[1], text: m[2].trim() });
  }
  return opts;
}

/** Remove the A./B./C./D. lines so the statement doesn't render twice. */
function stripOptionLines(problemMd: string): string {
  return problemMd
    .split("\n")
    .filter((l) => !/^\s*[A-D][\.\)]\s+/.test(l))
    .join("\n");
}

function parseCorrectOption(solutionMd: string | null): string | null {
  if (!solutionMd) return null;
  const m = solutionMd.match(/correct answer is\s*\**\s*([A-D])/i);
  return m ? m[1].toUpperCase() : null;
}

// ── mark scheme modal (SME full-screen scheme, research §6.3, figure 9) ─

function transformMarkTags(md: string): string {
  // "**[1]**" → "**[1 mark]**" so the corpus's own tags read like SME's
  return md.replace(/\*\*\[(\d+)\]\*\*/g, (_m, n) => `**[${n} mark${Number(n) === 1 ? "" : "s"}]**`);
}

function MarkSchemeDialog({
  course,
  question,
  topicName,
  subtopicTitle,
  onClose,
}: {
  course: Course;
  question: ExamQuestion | null;
  topicName: string;
  subtopicTitle: string | null;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const progress = useCourseProgress(course);
  const restated = question ? firstLine(question) : "";
  const longRestate = restated.length > 220;

  return (
    <Dialog open={!!question} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="h-[92vh] max-w-4xl overflow-y-auto sm:h-[92vh]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs font-medium">
              {subtopicTitle ?? topicName}
            </Badge>
            <span className="text-sm font-normal text-muted-foreground">Mark scheme</span>
          </DialogTitle>
        </DialogHeader>
        {question && (
          <div className="space-y-4">
            {question.parts.map((p) => {
              const typed = progress.typedAnswers[p.id]?.text ?? null;
              return (
                <section key={p.id} className="space-y-2 rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[13px] font-semibold">
                      {question.parts.length > 1 ? `${p.order + 1}` : "Q"}
                    </span>
                    {/* SME (figure 16): part marks right-aligned in the scheme row */}
                    <span className="ml-auto text-[13px] text-muted-foreground">
                      {p.marks} mark{p.marks === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className={cn(!expanded && longRestate && "relative max-h-24 overflow-hidden")}>
                    <Markdown>{p.problemMd}</Markdown>
                    {!expanded && longRestate && (
                      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" aria-hidden />
                    )}
                  </div>
                  {longRestate && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-primary" onClick={() => setExpanded((v) => !v)}>
                      {expanded ? "Show less" : "Show more"}
                    </Button>
                  )}
                  {typed && (
                    <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
                      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                        <PenLine className="size-3" aria-hidden /> Your typed answer
                      </p>
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{typed}</p>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Compare it with the marking points below — award yourself the marks you clearly earned.
                      </p>
                    </div>
                  )}
                  {p.solutionMd && (
                    <div className="border-t pt-3">
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        The completed answer should show:
                      </p>
                      <Markdown>{transformMarkTags(p.solutionMd)}</Markdown>
                    </div>
                  )}
                </section>
              );
            })}
            <p className="text-xs text-muted-foreground">
              Marking points are AND-joined in the corpus (all required for the mark). Self-mark
              honestly — your score stays in this browser only.
            </p>
          </div>
        )}
        <button
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100"
          onClick={onClose}
          aria-label="Close mark scheme"
        >
          <X className="size-4" aria-hidden />
        </button>
      </DialogContent>
    </Dialog>
  );
}

function firstLine(q: ExamQuestion): string {
  const md = q.parts[0]?.problemMd ?? "";
  return md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("!["))[0]
    ?.slice(0, 220) ?? "this question";
}
