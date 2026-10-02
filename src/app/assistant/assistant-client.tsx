"use client";

/**
 * Standalone Contextual Learning Assistant (CLA) — the free-standing tab.
 *
 * The CLA contract's defining difference from the free Tutor is EXPLICIT
 * context + mode (§3 "explicit, data-not-judgment"): the learner anchors the
 * ask to a spec-tree topic (SPEC_TOPIC — the demo twin of production's
 * KG_TOPIC) or an exam question (EXAM_QUESTION) and picks the mode; the
 * server resolves the context fail-closed and the answer arrives grounded
 * with citations, the deterministic anchor, the evidence count.
 *
 * Honest behavior pinned here (mirrors web's ClaAssistantView):
 * - CHECK is attempt-gated: the 409 attempt_required (the §7 answer-leakage
 *   gate) renders as guidance — "attempt first, then CHECK unlocks full
 *   feedback" — not as error noise. It is the product working as designed.
 *   The attempt flag comes from the local progress store (self-scores, MCQ
 *   marks, typed answers) and is echoed — not verified — by the server.
 * - Refused answers render distinctly (the deterministic refusal path).
 * - Provider/model/latency/evidence-count are shown with every answer
 *   (research traceability, Master Spec §19).
 * - HINT / CHECK are question-context modes; topic contexts accept
 *   EXPLAIN / SUMMARIZE only (the boundary is enforced server-side too).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  BookOpenCheck,
  Compass,
  FileQuestion,
  FileText,
  Info,
  Lightbulb,
  ListChecks,
  Loader2,
  Lock,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { normalizeMathDelimiters } from "@/lib/mathNormalize";
import { useCourseProgress } from "@/lib/progress";
import type { TutorCitation } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/api";

type ContextKind = "SPEC_TOPIC" | "EXAM_QUESTION";
type Mode = "EXPLAIN" | "SUMMARIZE" | "HINT" | "CHECK";

interface CourseOption {
  slug: string;
  label: string;
  level: string;
  subject: string;
  code: string;
}

interface TopicOption {
  code: string;
  number: number;
  title: string;
  specPointCount: number;
}

interface QuestionTopicOption {
  slug: string;
  name: string;
  setName: string | null;
}

interface CatalogQuestion {
  id: string;
  label: string;
  marks: number;
  partIds: string[];
  specPointCodes: string[];
}

interface ClaMessage {
  role: "user" | "assistant";
  content: string;
  mode?: Mode;
  citations?: TutorCitation[];
  provider?: string;
  model?: string | null;
  refused?: boolean;
  evidenceCount?: number;
  latencyMs?: number;
  context?: {
    kind: string;
    anchor: string;
    attempted?: boolean;
  };
}

const MAX_QUESTION_CHARS = 600; // mirrors the API contract (note island parity)

const MODES: { value: Mode; label: string; hint: string; questionOnly: boolean }[] = [
  { value: "EXPLAIN", label: "Explain", hint: "Teach the topic from validated sources", questionOnly: false },
  { value: "SUMMARIZE", label: "Summarize", hint: "Compress the anchored material", questionOnly: false },
  { value: "HINT", label: "Hint", hint: "Scaffolding only — never the answer", questionOnly: true },
  { value: "CHECK", label: "Check", hint: "Full mark-scheme feedback after your attempt", questionOnly: true },
];

export function AssistantClient({
  courses,
  course,
  topics,
  questionTopics,
}: {
  courses: CourseOption[];
  course: CourseOption;
  topics: TopicOption[];
  questionTopics: QuestionTopicOption[];
}) {
  const router = useRouter();
  const progress = useCourseProgress(course.slug);

  const [kind, setKind] = useState<ContextKind>("SPEC_TOPIC");
  const [topicCode, setTopicCode] = useState<string>(topics[0]?.code ?? "");
  const [qTopicSlug, setQTopicSlug] = useState<string>("");
  const [catalog, setCatalog] = useState<{ name: string; questions: CatalogQuestion[] } | null>(null);
  const [questionId, setQuestionId] = useState<string>("");
  const [mode, setMode] = useState<Mode>("EXPLAIN");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [thread, setThread] = useState<ClaMessage[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread, busy]);

  // question contexts load their topic's compact catalog lazily; the loading
  // flag is derived (set selected + no result yet), so the effect only ever
  // sets state from the async fetch itself
  const catalogLoading = kind === "EXAM_QUESTION" && qTopicSlug !== "" && catalog === null;
  useEffect(() => {
    if (kind !== "EXAM_QUESTION" || !qTopicSlug) return;
    let cancelled = false;
    fetch(`/api/questions/${course.slug}/${qTopicSlug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!cancelled) setCatalog({ name: d.name, questions: d.questions ?? [] });
      })
      .catch(() => {
        if (!cancelled) setCatalog({ name: qTopicSlug, questions: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [kind, qTopicSlug, course.slug]);

  const question = catalog?.questions.find((q) => q.id === questionId) ?? null;
  const attempted =
    Boolean(progress.selfScores[question?.id ?? ""]) ||
    (question?.partIds ?? []).some((id) => progress.mcqAnswers[id] || progress.typedAnswers[id]);

  function switchKind(next: ContextKind) {
    setKind(next);
    if (next === "SPEC_TOPIC" && mode !== "EXPLAIN" && mode !== "SUMMARIZE") setMode("EXPLAIN");
    setError(null);
  }

  async function ask() {
    const text = draft.trim();
    if (!text || busy) return;
    if (kind === "SPEC_TOPIC" && !topicCode) return;
    if (kind === "EXAM_QUESTION" && !questionId) return;

    const history = thread.map((m) => ({ role: m.role, content: m.content }));
    const anchor =
      kind === "SPEC_TOPIC"
        ? (topics.find((t) => t.code === topicCode)?.title ?? topicCode)
        : (question?.label ?? questionId);
    setThread((t) => [...t, { role: "user", content: text }]);
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch("/api/ai/cla", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(
          kind === "SPEC_TOPIC"
            ? { kind: "topic", course: course.slug, topicCode, mode, question: text, history }
            : {
                kind: "question",
                course: course.slug,
                questionId,
                mode,
                question: text,
                history,
                attempted,
              },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.error === "attempt_required") {
          // the §7 answer-leakage gate — guidance, not error noise
          setError({ text: data.detail ?? "Attempt first, then CHECK unlocks full feedback.", code: "attempt_required" });
          return;
        }
        setError({
          text:
            data.error === "context_not_found"
              ? "The server could not resolve that context — reload and try again."
              : (data.detail ?? "The assistant call failed."),
        });
        return;
      }
      setThread((t) => [
        ...t,
        {
          role: "assistant",
          content: data.answer,
          mode: data.mode,
          citations: data.citations,
          provider: data.provider,
          model: data.model,
          refused: data.refused,
          evidenceCount: data.evidenceCount,
          latencyMs: data.latencyMs,
          context: {
            kind: data.context?.kind ?? "SPEC_TOPIC",
            anchor:
              data.context?.kind === "EXAM_QUESTION"
                ? (data.context.label ?? anchor)
                : data.context?.topicCode
                  ? `${data.context.topicCode} — ${data.context.topicTitle}`
                  : anchor,
            attempted: data.context?.attempted,
          },
        },
      ]);
    } catch {
      setError({ text: "Network error while asking — check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const disabled =
    busy ||
    !draft.trim() ||
    (kind === "SPEC_TOPIC" ? !topicCode : !questionId);

  // the composer's anchor summary — one honest line for "what am I anchored
  //  to" (HUB-TUTOR-CLA-LOOK, the SME explain-panel reference)
  const selectedTopic = topics.find((t) => t.code === topicCode) ?? null;
  const anchorSummary =
    kind === "SPEC_TOPIC"
      ? selectedTopic
        ? `${selectedTopic.number}. ${selectedTopic.title}`
        : "No topic picked yet"
      : question
        ? `${question.label.slice(0, 48)}${question.label.length > 48 ? "…" : ""} · ${question.marks} marks`
        : "No question picked yet";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      {/* the SME explain-panel reference (HUB-TUTOR-CLA-LOOK): one chat
          canvas — identity strip, amber honesty banner, anchor bar,
          transcript, composer card */}
      <div className="flex min-h-[34rem] flex-col overflow-hidden rounded-xl border bg-background">
        {/* identity strip — the shared chat-canvas header */}
        <div className="flex items-center gap-2.5 border-b px-4 py-3">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
            aria-hidden="true"
          >
            <Sparkles className="size-4" />
          </span>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold">Contextual Learning Assistant</h1>
            <p className="text-[11px] text-muted-foreground">
              you pick the context — it answers from validated course material
            </p>
          </div>
        </div>

        {/* amber honesty banner — the reference's signature, on the hub's
            theme-aware warn tokens */}
        <div className="flex items-start gap-2 border-b bg-warn/10 px-4 py-2.5 text-xs leading-relaxed text-warn-ink">
          <Info className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
          <p>
            The assistant can make mistakes. It answers only from validated course
            material, with citations — always check them.
          </p>
        </div>

        {/* anchor bar — the §3 explicit-context contract as pill segments +
            compact selects (the s129 overlay vocabulary, now shared) */}
        <div className="space-y-2.5 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Anchor</span>
            <span className="flex items-center gap-1.5" role="tablist" aria-label="Context kind">
              <button
                type="button"
                role="tab"
                aria-selected={kind === "SPEC_TOPIC"}
                onClick={() => switchKind("SPEC_TOPIC")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  kind === "SPEC_TOPIC"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                <Sparkles className="size-3" aria-hidden /> Topic
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={kind === "EXAM_QUESTION"}
                onClick={() => switchKind("EXAM_QUESTION")}
                disabled={questionTopics.length === 0}
                title={questionTopics.length === 0 ? "This course has no exam-question sets yet" : undefined}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  kind === "EXAM_QUESTION"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                <FileQuestion className="size-3" aria-hidden /> Question
              </button>
            </span>
            <div className="ml-auto w-full sm:w-56">
              <Select value={course.slug} onValueChange={(slug) => router.push(`/assistant?course=${slug}`)}>
                <SelectTrigger className="h-8 w-full text-xs" aria-label="Course">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {courses.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

        {/* anchored entity */}
        {kind === "SPEC_TOPIC" ? (
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Anchored topic — the server resolves it VALIDATED-only
            </span>
            <Select value={topicCode} onValueChange={setTopicCode}>
              <SelectTrigger className="h-8 w-full text-xs" aria-label="Anchored topic">
                <SelectValue placeholder={topics.length === 0 ? "No spec tree for this course" : "Pick the topic you are studying"} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {topics.map((t) => (
                  <SelectItem key={t.code} value={t.code}>
                    {t.number}. {t.title} · {t.specPointCount} spec pts
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Question set (served from the exam bank)
              </span>
              <Select
                value={qTopicSlug}
                onValueChange={(slug) => {
                  setQTopicSlug(slug);
                  setCatalog(null);
                  setQuestionId("");
                }}
              >
                <SelectTrigger className="h-8 w-full text-xs" aria-label="Question set">
                  <SelectValue placeholder="Pick the set you are working through" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {questionTopics.map((t) => (
                    <SelectItem key={t.slug} value={t.slug}>
                      {t.name}
                      {t.setName ? ` — ${t.setName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Anchored question
              </span>
              <Select
                value={questionId}
                onValueChange={setQuestionId}
                disabled={!qTopicSlug || catalogLoading}
              >
                <SelectTrigger className="h-8 w-full text-xs" aria-label="Anchored question">
                  <SelectValue
                    placeholder={
                      !qTopicSlug
                        ? "Pick a set first"
                        : catalogLoading
                          ? "Loading questions…"
                          : "Pick the question you are working on"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(catalog?.questions ?? []).map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.label.slice(0, 70)} · {q.marks} marks
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {question && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {question.marks} marks
                  {question.specPointCodes.length > 0
                    ? ` · ${question.specPointCodes.slice(0, 3).join(", ")}${question.specPointCodes.length > 3 ? ", …" : ""}`
                    : " · not mapped to spec points"}
                  {" · "}
                  {attempted ? (
                    <span className="text-success">attempt recorded</span>
                  ) : (
                    <span>no attempt recorded yet</span>
                  )}
                </p>
              )}
            </div>
          </div>
        )}

        {/* mode vocabulary */}
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Mode</span>
          {MODES.map((m) => {
            const available = !m.questionOnly || kind === "EXAM_QUESTION";
            return available ? (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                aria-pressed={mode === m.value}
                title={m.hint}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  mode === m.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                {m.value === "HINT" && <Lightbulb className="size-3" aria-hidden />}
                {m.value === "CHECK" && <BookOpenCheck className="size-3" aria-hidden />}
                {m.value === "EXPLAIN" && <Sparkles className="size-3" aria-hidden />}
                {m.value === "SUMMARIZE" && <ListChecks className="size-3" aria-hidden />}
                {m.label}
                {m.value === "CHECK" && !attempted && question && <Lock className="size-2.5 opacity-60" aria-hidden />}
              </button>
            ) : (
              <span
                key={m.value}
                title="Question contexts only — attempt-gated in production"
                className="cursor-not-allowed rounded-full border border-dashed px-2.5 py-0.5 text-[11px] text-muted-foreground/60"
              >
                {m.label}
              </span>
            );
          })}
        </div>

        </div>

        {/* send feedback — the §7 gate stays guidance, never noise (kept
            verbatim, now a strip between the anchor bar and the transcript) */}
        {error && (
          <div
            className={cn(
              "flex items-start gap-2 border-b px-4 py-2.5 text-xs",
              error.code === "attempt_required"
                ? "bg-warn/5 text-warn-ink"
                : "bg-destructive/5 text-destructive",
            )}
          >
            {error.code === "attempt_required" ? (
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            ) : (
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            )}
            <span>
              {error.text}
              {error.code === "attempt_required" && (
                <>
                  {" "}
                  <span className="text-muted-foreground">
                    This is the answer-leakage gate: full feedback unlocks only after the attempt
                    exists, so CHECK can never leak the mark scheme early.
                  </span>
                </>
              )}
            </span>
          </div>
        )}

        {/* transcript — chat-first like the reference panel */}
        <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {thread.length === 0 && !busy && (
          <p className="py-6 text-center text-xs leading-relaxed text-muted-foreground">
            Every answer is grounded in validated course material anchored to the context you
            picked — citations point at the real sources, and nothing is served that the content
            does not support. The free <a href="/tutor" className="underline">AI Tutor</a> stays the
            whole-corpus surface; this assistant is deliberately bounded.
          </p>
        )}
        {thread.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-[13px]">
                {m.content}
              </div>
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                "space-y-2 rounded-xl border bg-muted/30 px-4 py-3",
                m.refused && "border-warn/40 bg-warn/5",
              )}
            >
              {m.refused && (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-warn">
                  <TriangleAlert className="size-3.5" aria-hidden />
                  Honest refusal — the anchored material does not support this
                </p>
              )}
              <Markdown className="text-sm [&_p]:text-sm">{normalizeMathDelimiters(m.content)}</Markdown>
              {m.citations && m.citations.length > 0 && !m.refused && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {m.citations.map((c) => {
                    const pill = (
                      <span
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[11px]"
                        title={c.label}
                      >
                        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                          {c.index}
                        </span>
                        <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="max-w-48 truncate font-medium">{c.label}</span>
                      </span>
                    );
                    return c.url ? (
                      <a key={c.index} href={c.url} className="min-w-0 hover:opacity-80">
                        {pill}
                      </a>
                    ) : (
                      <span key={c.index} className="min-w-0">
                        {pill}
                      </span>
                    );
                  })}
                </div>
              )}
              {m.context && (
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  anchored <span className="font-medium text-foreground">{m.context.anchor}</span>
                  {" · "}
                  {m.context.kind === "EXAM_QUESTION" ? "exam question" : "spec topic"}
                  {typeof m.context.attempted === "boolean" && (
                    <>
                      {" · "}
                      attempted:{" "}
                      <span className={m.context.attempted ? "text-foreground" : "text-warn"}>
                        {String(m.context.attempted)}
                      </span>
                    </>
                  )}
                  {" · "}
                  mode {m.mode} · {m.evidenceCount} evidence
                  {" · "}
                  {m.provider === "unavailable"
                    ? "no AI provider answered — structured fallback shown"
                    : m.provider === "mock"
                      ? "demo fallback provider"
                      : `Answered by ${m.provider ?? "?"}`}
                  {m.model ? ` · ${m.model}` : ""}
                  {typeof m.latencyMs === "number" ? ` · ${(m.latencyMs / 1000).toFixed(1)}s` : ""}
                </p>
              )}
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            resolving context → gathering validated evidence → grounding the answer…
          </div>
        )}
        </div>

        {/* composer — the shared rounded-2xl card: anchor summary pill,
            borderless field, circular send (HUB-TUTOR-CLA-LOOK). The §3
            contract's validation rides the same ask() path + disabled logic */}
        <div className="border-t bg-background p-3 sm:p-4">
          <div className="rounded-2xl border bg-background shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
            <div className="flex items-center px-3.5 pt-3">
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium">
                <Compass className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{anchorSummary}</span>
              </span>
            </div>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_QUESTION_CHARS))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask();
                }
              }}
              rows={2}
              maxLength={MAX_QUESTION_CHARS}
              aria-label="Your question in this context"
              placeholder={
                mode === "CHECK"
                  ? "Describe your answer — Check gives full feedback against the mark scheme"
                  : mode === "HINT"
                    ? "Ask for a hint (scaffolding, never the answer)"
                    : "Ask about the anchored context…"
              }
              className="resize-none border-0 bg-transparent px-3.5 py-2.5 text-sm shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="flex items-center justify-between gap-2 px-3 pb-3">
              <span className="text-[11px] text-muted-foreground">
                Enter to ask · Shift+Enter for a new line
              </span>
              <span className="flex items-center gap-2">
                <span aria-live="polite" className="text-[11px] tabular-nums text-muted-foreground">
                  {draft.length}/{MAX_QUESTION_CHARS}
                </span>
                <Button
                  onClick={() => void ask()}
                  disabled={disabled}
                  aria-label="Ask the contextual assistant"
                  className="size-9 shrink-0 rounded-full"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ArrowUp className="size-4" aria-hidden />
                  )}
                </Button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
