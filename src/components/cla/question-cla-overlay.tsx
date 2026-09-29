"use client";

/**
 * Question-anchored CLA overlay (Contextual Learning Assistant, exam-questions
 * slice — web s129 parity, operator trace 1a0ea01d0f9a8495).
 *
 * The CLA product shape on the hub's exam-questions player: every question
 * card carries one header entry ("Ask CLA"), and each answer box's lightbulb
 * opens the same panel pre-targeted at that part. The panel answers only
 * about the question being read, through the SAME production contract as web
 * (`POST /api/v1/learners/me/cla/ask`, hub `api.claAsk`), anchored to:
 *
 *   Understand — PAST_PAPER_QUESTION on the family's first row (the whole
 *                question; core serves the stem AND every part prompt as
 *                id-anchored lead evidence — the SME corpus keeps most
 *                structured questions' text in the parts)
 *   Approach   — QUESTION_PART on the selected answer box (part-scoped
 *                scaffolding: the box's prompt, command word and marks ride
 *                the anchor), or PAST_PAPER_QUESTION on an MCQ row (an MCQ
 *                is atomic — the row IS the part)
 *
 * The 2 quick actions are the operator's spec, verbatim:
 *   Understand · Approach
 * Understand maps to EXPLAIN — which on question contexts is DECODE-ONLY in
 * core (command words, marks, examiner intent; never the answer). Approach
 * maps to HINT — scaffolding only, no final answers, no scheme points, pre-
 * or post-attempt (deterministic in core's ClaLeakagePolicy). CHECK stays
 * out of this surface by operator decision: post-attempt review belongs to
 * Smart Mark ("Explain my feedback" / "Improve my answer"), so it renders
 * disabled with that pointer. SUMMARIZE is a topic/notes mode and renders
 * disabled with its pointer too.
 *
 * Hub adaptation (the honest delta vs web): the hub renders the SME-parity
 * corpus while core knows questions by UUID — so the anchors resolve ONLY
 * through the 4CH1 identity bridge's server-side join
 * (/api/core/questions), the exact join that turns answers into real
 * attempts. A question the join cannot verify is never anchored — a
 * client-invented id would be a fabricated anchor, the same rule the
 * attempt bridge enforces for submissions. Bridge-off states (not the
 * pilot / signed out / core unreachable) never render the entries at all:
 * the assistant cannot be pointed anywhere else, so it is absent rather
 * than broken.
 *
 * Transcripts live in React state lifted to the player, keyed by the hub
 * question id (one transcript per whole question — switching questions
 * switches transcripts, and answers anchored to one question never read as
 * anchored to another).
 *
 * SME chat-widget dual form (HUB-CLA-POPUP + HUB-CLA-SIDEBAR): popup
 * (floating, bottom-right) or sidebar — a PHYSICALLY DOCKED right column,
 * not an overlay (SME's expanded chat goes `flex: 0 0 400px; position:
 * static` in the page row; the hub's .course-shell-row cedes the 400px via
 * globals.css). Below 1400px the dock can't exist (SME's expand button is
 * display:none there) and a stored "sidebar" pref degrades to the popup;
 * below lg the Sheet's fullscreen wash carries SME's mobile behaviour.
 * Density (HUB-CLA-SIDEBAR): SME's panel anatomy — one-line verbatim banner,
 * ONE anchor line (question number · marks · parts, with the Approach part
 * pills merged in), the 2 quick options as SME-style prefilled chips in the
 * empty state only, then chat + input; the per-answer trace collapses
 * behind a tiny disclosure. CHECK/SUMMARIZE stay out of this surface by
 * operator decision (post-attempt review belongs to Smart Mark;
 * SUMMARIZE is a topic/notes mode) — see this header's mode notes below.
 */

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Markdown } from "@/components/markdown";
import { ApiError, aiAskErrorMessage, api } from "@/lib/api";
import type { ClaAnswerView, ClaCitation } from "@/lib/types";
import type { ExamQuestion } from "@/lib/contracts";
import type { BridgeQuestion } from "@/lib/attempt-bridge";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Compass,
  FileText,
  Info,
  Lightbulb,
  Loader2,
  Lock,
  Minimize2,
  PanelRightOpen,
  Send,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";

import { useClaPanelForm, useClaDock, useIsDesktop, useIsWide, claHeaderCircleBtn } from "./cla-panel-mode";

/** Question-surface free-input modes — the two that mean anything here. */
type QuestionMode = "EXPLAIN" | "HINT";

/** One Approach target: an answer box (QUESTION_PART) or an atomic MCQ row. */
export interface ClaTarget {
  /** the hub part id (the player's vocabulary) */
  hubPartId: string;
  anchor: "QUESTION_PART" | "PAST_PAPER_QUESTION";
  /** core row UUIDs — resolved by the identity bridge, never client-invented */
  questionId: string;
  corePartId: string | null;
  /** chip label — a/b/c… on multi-part questions, "question" when atomic */
  label: string;
  marks: number;
  commandWord: string | null;
}

/**
 * Derive the Approach targets from the hub question + its verified join, in
 * card order: an MCQ part anchors the row itself (PAST_PAPER_QUESTION), a
 * structured part anchors its core part (QUESTION_PART). Only parts the
 * bridge verified produce targets — an unverified question yields none.
 */
export function claTargetsOf(question: ExamQuestion, join: BridgeQuestion | null): ClaTarget[] {
  if (!join) return [];
  const multi = question.parts.length > 1;
  const targets: ClaTarget[] = [];
  question.parts.forEach((part, idx) => {
    const label = multi ? String.fromCharCode(97 + idx) : "question";
    if (part.questionType === "multiple_choice") {
      const m = join.mcq[part.id];
      if (m) {
        targets.push({
          hubPartId: part.id,
          anchor: "PAST_PAPER_QUESTION",
          questionId: m.questionId,
          corePartId: null,
          label,
          marks: part.marks,
          commandWord: part.commandWord,
        });
      }
      return;
    }
    for (const s of join.structured) {
      const corePartId = s.parts[part.id];
      if (corePartId) {
        targets.push({
          hubPartId: part.id,
          anchor: "QUESTION_PART",
          questionId: s.questionId,
          corePartId,
          label,
          marks: part.marks,
          commandWord: part.commandWord,
        });
        break;
      }
    }
  });
  return targets;
}

export type QuestionClaMessage =
  | { kind: "user"; text: string; at: number }
  | { kind: "assistant"; result: ClaAnswerView; at: number }
  | { kind: "gate"; text: string; at: number }
  | { kind: "error"; text: string; question: string; at: number };

export const EMPTY_CLA_MESSAGES: QuestionClaMessage[] = [];

export function QuestionClaOverlay({
  open,
  onOpenChange,
  rootId,
  question,
  join,
  questionNumber,
  initialTargetId,
  messages,
  setMessages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the core subject root — scopes the server-side part → question resolution */
  rootId: string | null;
  /** the open question (the hub corpus identity) */
  question: ExamQuestion | null;
  /** its verified core join — no join, no anchors, no overlay entries */
  join: BridgeQuestion | null;
  /** 1-based display number of the card (the header chip the learner sees) */
  questionNumber: number | null;
  /** a hub part id to pre-aim Approach at (from a part's lightbulb button) */
  initialTargetId: string | null;
  messages: QuestionClaMessage[];
  setMessages: Dispatch<SetStateAction<QuestionClaMessage[]>>;
}) {
  const [freeMode, setFreeMode] = useState<QuestionMode>("HINT");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  // SME chat-widget parity (HUB-CLA-POPUP + HUB-CLA-SIDEBAR): popup
  // (floating, bottom-right), sidebar (the physically docked right column),
  // or the Sheet's fullscreen wash on mobile. One shared preference across
  // the CLA panels; the dock only exists ≥1400px (SME's expanded gate — a
  // stored "sidebar" below it degrades to the popup). The transcript is
  // lifted to the player, so a mid-conversation toggle switches shells
  // without losing a turn.
  const [form, setForm] = useClaPanelForm();
  const isDesktop = useIsDesktop();
  const isWide = useIsWide();
  const docked = open && form === "sidebar" && isWide;
  const usePopup = open && !docked && isDesktop;
  // the physical reflow: marks <html> for globals.css's 400px right inset
  useClaDock(docked);

  // the popup + dock shells are non-modal (SME's popup floats over a live
  // page) — they own their own Escape handling; the Sheet keeps Radix's
  useEffect(() => {
    if (!usePopup && !docked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    popupRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [usePopup, docked, onOpenChange]);

  const targets = useMemo(
    () => (question ? claTargetsOf(question, join) : []),
    [question, join],
  );

  // the part lightbulb pre-aims Approach; every other open resets to the
  // first target (the overlay's target is per-open, the transcript per-question)
  useEffect(() => {
    if (!open) return;
    setTargetId(
      initialTargetId && targets.some((t) => t.hubPartId === initialTargetId)
        ? initialTargetId
        : (targets[0]?.hubPartId ?? null),
    );
  }, [open, question, initialTargetId, targets]);

  const target = targets.find((t) => t.hubPartId === targetId) ?? targets[0] ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const ask = async (
    anchor: { kind: "WHOLE" } | { kind: "TARGET"; target: ClaTarget },
    mode: QuestionMode,
    text: string,
  ) => {
    const q = text.trim();
    if (!q || busy || !question) return;
    setMessages((m) => [...m, { kind: "user", text: q, at: Date.now() }]);
    setBusy(true);
    try {
      const result = await api.claAsk(
        anchor.kind === "TARGET" && anchor.target.anchor === "QUESTION_PART"
          ? {
              kind: "QUESTION_PART",
              rootId: rootId ?? undefined,
              partId: anchor.target.corePartId ?? undefined,
              mode,
              question: q,
            }
          : {
              kind: "PAST_PAPER_QUESTION",
              questionId:
                anchor.kind === "TARGET"
                  ? anchor.target.questionId
                  : wholeAnchorId(question, targets),
              mode,
              question: q,
            },
      );
      setMessages((m) => [...m, { kind: "assistant", result, at: Date.now() }]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // the §7 answer-leakage gate — guidance, not error (defensive: this
        // surface never sends CHECK, but the branch keeps the semantics)
        setMessages((m) => [...m, { kind: "gate", text: e.message, at: Date.now() }]);
      } else {
        // 404 keeps its specific guidance (unresolvable question/anchor); 5xx
        // maps to the honest AI-unavailable message (web s136 parity)
        const msg =
          e instanceof ApiError && e.status === 404
            ? "The server could not anchor this question — it may not be validated for serving yet. Try again later, or ask on the assistant tab."
            : aiAskErrorMessage(e, "Request failed");
        setMessages((m) => [
          ...m,
          { kind: "error", text: msg, question: q, at: Date.now() },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  const understandPrompt =
    "What is this question asking me to do? Walk through each part — the command words, the marks, and what the examiner is looking for. Don't tell me the answers.";
  const approachPrompt = target
    ? target.anchor === "QUESTION_PART"
      ? `Help me work through part (${target.label}) step by step — coach me toward the answer without giving it away.`
      : "Help me work through this question step by step — coach me toward the answer without giving it away."
    : "";

  const hideTargetRow = targets.length <= 1 && targets[0]?.label === "question";

  // SME's expand/collapse toggle (labels verbatim: "Expand chat" when the
  // popup can grow into the docked sidebar, "Collapse chat" when it can come
  // back). Rendered ≥1400px only — SME's expand button is display:none
  // below, and the dock can't exist there.
  const formToggleButton = isWide ? (
    <button
      type="button"
      onClick={() => setForm(form === "popup" ? "sidebar" : "popup")}
      aria-label={form === "popup" ? "Expand chat" : "Collapse chat"}
      title={form === "popup" ? "Expand chat" : "Collapse chat"}
      className={claHeaderCircleBtn}
    >
      {form === "popup" ? (
        <PanelRightOpen className="size-4" aria-hidden />
      ) : (
        <Minimize2 className="size-4" aria-hidden />
      )}
    </button>
  ) : null;

  // SME's gradient header title (background-clip:text, their verbatim
  // flourish) — short like their "Explain"; the full product name rides
  // the dialog's aria-label. Rides all three shells.
  const panelTitle = (
    <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
      CLA
    </span>
  );

  // one panel body, rendered by whichever shell is active
  const panelBody = (
    <>
        {/* SME's one-line banner — their verbatim copy, on the hub's
            theme-aware warn tokens */}
        <div className="flex items-center gap-2 border-b bg-warn/10 px-4 py-2 text-[11px] leading-snug text-warn-ink">
          <Info className="size-3.5 shrink-0 text-warn" aria-hidden />
          <p>Chat can make mistakes. Please check all responses carefully.</p>
        </div>

        {/* the anchor, ONE line — the question IS the anchor (the server
            resolves the whole family's first row and serves the stem plus
            every part prompt as id-anchored lead evidence). The Approach
            part pills ride the same line: which part the coaching targets */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2">
          <Compass className="size-3.5 shrink-0 text-primary" aria-hidden />
          <p id="cla-question-anchor" className="text-xs font-medium leading-snug">
            {questionNumber != null ? `Question ${questionNumber}` : "Question"}
            <span className="font-normal text-muted-foreground">
              {" · "}
              {question?.totalMarks} mark{question?.totalMarks === 1 ? "" : "s"}
              {question && question.parts.length > 1
                ? ` · ${question.parts.length} parts`
                : ""}
            </span>
          </p>
          {!hideTargetRow && targets.length > 0 && (
            <span
              className="flex flex-wrap items-center gap-1"
              role="group"
              aria-label="Approach part"
            >
              {targets.map((t) => (
                <button
                  key={t.hubPartId}
                  type="button"
                  onClick={() => setTargetId(t.hubPartId)}
                  aria-pressed={target?.hubPartId === t.hubPartId}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none transition-colors",
                    target?.hubPartId === t.hubPartId
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </span>
          )}
        </div>

        {/* transcript — the hub's math-capable Markdown (KaTeX + mhchem) and
            the citation chips; the 2 quick options (operator spec) ride the
            EMPTY state as SME-style prefilled chips and disappear once the
            conversation starts, like SME's suggestions */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.length === 0 && !busy && (
            <div className="grid grid-cols-1 gap-2 pt-1">
              <button
                type="button"
                disabled={!question}
                onClick={() => void ask({ kind: "WHOLE" }, "EXPLAIN", understandPrompt)}
                className="flex flex-col gap-1 rounded-xl bg-primary/10 px-3 py-2.5 text-left transition-colors hover:bg-primary/15 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <Compass className="size-3.5 shrink-0 text-primary" aria-hidden />
                  Understand
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  Explain what this question is asking
                </span>
              </button>
              <button
                type="button"
                disabled={!target}
                onClick={() => target && void ask({ kind: "TARGET", target }, "HINT", approachPrompt)}
                className="flex flex-col gap-1 rounded-xl bg-primary/10 px-3 py-2.5 text-left transition-colors hover:bg-primary/15 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <Lightbulb className="size-3.5 shrink-0 text-primary" aria-hidden />
                  Approach
                  {target && (
                    <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-medium text-muted-foreground">
                      part {target.label}
                    </span>
                  )}
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {target?.anchor === "QUESTION_PART"
                    ? `Coach me through part (${target?.label}) without the answer`
                    : "Coach me through this question without the answer"}
                </span>
              </button>
            </div>
          )}
          {messages.map((m, i) =>
            m.kind === "user" ? (
              <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-[13px]">
                {m.text}
              </div>
            ) : m.kind === "assistant" ? (
              <div
                key={i}
                className={cn(
                  "space-y-2 rounded-lg border bg-card px-3 py-2.5",
                  m.result.refused ? "border-warn/40 bg-warn/5" : "bg-muted/40",
                )}
              >
                {m.result.refused && (
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-warn">
                    <TriangleAlert className="size-3.5" aria-hidden />
                    Not supported by this question
                  </p>
                )}
                <Markdown className="text-sm [&_p]:text-sm">{m.result.answer}</Markdown>
                {m.result.citations.length > 0 && !m.result.refused && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {m.result.citations.map((c: ClaCitation) => (
                      <span
                        key={c.index}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[11px]"
                        title={c.label}
                      >
                        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                          {c.index}
                        </span>
                        <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="max-w-48 truncate font-medium">{c.label}</span>
                      </span>
                    ))}
                  </div>
                )}
                {/* the §19-style traceability footer — collapsed behind a
                    tiny disclosure (SME shows nothing; provider, model, mode,
                    evidence, latency and the read-only tools stay one click
                    away) */}
                <details className="text-[10px] text-muted-foreground">
                  <summary className="w-fit cursor-pointer select-none hover:text-foreground">
                    trace
                  </summary>
                  <p className="pt-0.5">
                    {m.result.provider === "unavailable"
                      ? "no AI provider answered — structured fallback shown"
                      : `Answered by ${m.result.provider}`}
                    {m.result.model ? ` · ${m.result.model}` : ""} · mode{" "}
                    {m.result.context.mode}
                    {` · ${m.result.evidenceCount} evidence chunk${m.result.evidenceCount === 1 ? "" : "s"}`}
                    {` · ${m.result.latencyMs}ms`}
                  </p>
                  {m.result.tools.length > 0 && (
                    <ul className="mt-0.5 space-y-0.5 pl-4">
                      {m.result.tools.map((t, ti) => (
                        <li key={ti}>
                          {t.tool} · {t.resultSize} result(s) · {t.latencyMs}ms
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </div>
            ) : m.kind === "gate" ? (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/5 p-3 text-xs text-warn-ink"
              >
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{m.text}</span>
              </div>
            ) : (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {m.text}
                  <br />
                  <button
                    className="mt-1 underline hover:no-underline"
                    onClick={() => setDraft(m.question)}
                  >
                    Restore question
                  </button>
                </span>
              </div>
            ),
          )}
          {busy && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Grounding in this question…
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        {/* free input — the two live mode pills (EXPLAIN decodes what the
            question asks, HINT coaches; SUMMARIZE/CHECK live on other
            surfaces — this file's header notes the operator decision) + the
            ask box */}
        <div className="space-y-2 border-t px-4 py-3">
          <div className="flex items-center gap-1.5" role="group" aria-label="Answer mode">
            {(["EXPLAIN", "HINT"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setFreeMode(m)}
                aria-pressed={freeMode === m}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  freeMode === m
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                {m === "EXPLAIN" ? "Explain" : "Hint"}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const q = draft;
              setDraft("");
              void ask(
                freeMode === "HINT" && target
                  ? { kind: "TARGET", target }
                  : { kind: "WHOLE" },
                freeMode,
                q,
              );
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                freeMode === "HINT" && target?.anchor === "QUESTION_PART"
                  ? `What needs explaining about part (${target.label})?`
                  : "What needs explaining?"
              }
              maxLength={2000}
              disabled={busy}
              aria-label="Ask the contextual assistant about this question"
            />
            <Button
              type="submit"
              size="icon"
              disabled={busy || !draft.trim()}
              aria-label="Send"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
            </Button>
          </form>
        </div>
    </>
  );

  // SME keeps ONE header across their forms: icon + gradient title + the
  // circle buttons (theirs also has New chat — honest-absent here, the hub's
  // transcript-reset semantics differ; recorded as a follow-up candidate)
  const panelHeader = (
    <>
      <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 truncate pl-1 text-sm font-semibold">{panelTitle}</p>
      {formToggleButton}
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        aria-label="Close chat"
        title="Close chat"
        className={claHeaderCircleBtn}
      >
        <X className="size-4" aria-hidden />
      </button>
    </>
  );

  return (
    <>
      {/* ── the popup shell (SME's default form, HUB-CLA-POPUP) ──
          fixed bottom-right, 410×640 (min 400, max 100dvh−navbar−2rem),
          rounded-3xl, shadow, NO backdrop — the page stays interactive.
          Portaled to body so no ancestor transform becomes the containing
          block for position:fixed (the note-surface probe caught exactly
          that). */}
      {usePopup &&
        createPortal(
          <div
            ref={popupRef}
            role="dialog"
            aria-modal="false"
            aria-label="Contextual Learning Assistant"
            aria-describedby="cla-question-anchor"
            tabIndex={-1}
            className="fixed bottom-4 right-4 z-50 flex h-[640px] min-h-[400px] max-h-[calc(100dvh-5.5rem)] w-[410px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl border bg-background shadow-lg outline-none"
          >
            <div className="flex items-center gap-1 border-b px-3 py-2.5">{panelHeader}</div>
            {panelBody}
          </div>,
          document.body,
        )}

      {/* ── the docked sidebar shell (HUB-CLA-SIDEBAR) — SME's "expanded"
          form as a PHYSICAL layout member, not an overlay: their wrapper
          goes flex 0 0 400px static in the page row; the hub's
          .course-shell-row has ceded exactly this 400px (globals.css via
          <html data-cla-sidebar="open">), so this fixed column under the
          56px navbar occupies freed space — radius 0, border-l, their
          ChatPanel_expanded geometry. The page behind keeps scrolling. */}
      {docked &&
        createPortal(
          <div
            ref={popupRef}
            role="dialog"
            aria-modal="false"
            aria-label="Contextual Learning Assistant"
            aria-describedby="cla-question-anchor"
            tabIndex={-1}
            className="fixed bottom-0 right-0 top-14 z-30 flex w-[400px] flex-col border-l bg-background outline-none"
          >
            <div className="flex items-center gap-1 border-b px-3 py-2.5">{panelHeader}</div>
            {panelBody}
          </div>,
          document.body,
        )}

      {/* ── the mobile shell — the Sheet's fullscreen wash below lg (SME's
          mobile behaviour); the expand toggle is absent (SME hides it below
          1400px) ── */}
      <Sheet open={open && !usePopup && !docked} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
          aria-describedby="cla-question-anchor"
        >
          <SheetHeader className="flex-row items-center gap-0 border-b px-4 py-3 text-left">
            <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1 pl-2 leading-tight">
              <SheetTitle className="block text-sm font-semibold">{panelTitle}</SheetTitle>
              <SheetDescription className="sr-only">
                Answers are grounded in this question only, never its mark scheme before you attempt.
              </SheetDescription>
            </div>
            {/* pr-9 clears the Sheet's built-in close affordance */}
            <div className="flex shrink-0 items-center pr-9">{formToggleButton}</div>
          </SheetHeader>
          {panelBody}
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * Understand's anchor: the family's FIRST row (core serves the whole
 * question from it — stem + every part prompt). Falls back to the first
 * verified target's row; a question with no verified anchors has no overlay
 * entries at all, so this never runs with nothing to return.
 */
function wholeAnchorId(question: ExamQuestion, targets: ClaTarget[]): string {
  const first = question.parts[0];
  if (first) {
    if (first.questionType === "multiple_choice") {
      // the caller passes targets derived from the same question — the
      // first MCQ target IS parts[0] when it resolved
      const mcq = targets.find((t) => t.hubPartId === first.id);
      if (mcq) return mcq.questionId;
    } else {
      const structured = targets.find((t) => t.hubPartId === first.id);
      if (structured) return structured.questionId;
    }
  }
  return targets[0]?.questionId ?? "";
}
