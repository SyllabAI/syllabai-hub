"use client";

/**
 * Note-anchored CLA island (Contextual Learning Assistant).
 *
 * The CLA product shape, on the Revision Note reader: every note page carries
 * one overlay entry (the floating CLA button; the guided-study banner opens
 * the same panel), and the panel is EXPLICITLY CONTEXTUAL — it answers only
 * about the note being read, with citations into that note and an honest
 * refusal when the note doesn't cover the ask (server-side scope gate,
 * /api/ai/cla). This is the demo twin of production's
 * `POST /api/v1/learners/me/cla/ask` — the free Tutor tab remains the
 * whole-corpus surface, mirroring the production Tutor/CLA split.
 *
 * The 4 quick actions are the operator's spec, verbatim:
 *   Definitions · Summary · Pitfalls · Exam help
 * each mapping to a production ResponseMode (EXPLAIN/SUMMARIZE). HINT and
 * CHECK exist in the production vocabulary but are question-context modes
 * (attempt-gated in core's ClaLeakagePolicy) — they render disabled here,
 * and the API rejects them for note contexts. The exam-question CLA
 * (anchored to PAST_PAPER_QUESTION contexts, where HINT/CHECK unlock
 * post-attempt) is a later, separate surface by operator decision.
 *
 * SME chat-widget dual form (HUB-CLA-POPUP): the panel opens as a floating
 * popup — fixed bottom-right, 410×640, rounded-3xl, shadowed, NO backdrop
 * (the page stays interactive), SME's verbatim geometry — and can be
 * expanded into the docked right sidebar (the Sheet — SME's "expanded"
 * full-height column). The choice persists across the CLA panels; below lg
 * the popup form yields to the Sheet's fullscreen overlay (SME's mobile
 * wash behaviour). The transcript/draft/busy state lives in this component,
 * so toggling mid-conversation switches shells without losing the thread.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookMarked,
  BookOpenText,
  FileText,
  GraduationCap,
  Info,
  Loader2,
  ListChecks,
  Minimize2,
  PanelRightOpen,
  Send,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Markdown } from "@/components/markdown";
import type { TutorCitation } from "@/lib/contracts";
import { getToken } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useClaPanelForm, useIsDesktop, claHeaderCircleBtn } from "./cla-panel-mode";

type NoteMode = "EXPLAIN" | "SUMMARIZE";

interface QuickAction {
  id: string;
  title: string;
  description: string;
  prompt: string;
  mode: NoteMode;
  icon: typeof BookMarked;
}

/** Operator spec, verbatim — titles, descriptions and prompts. */
const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "definitions",
    title: "Definitions",
    description: "Define the key terms in this revision note",
    prompt: "Define the key terms in this revision note",
    mode: "EXPLAIN",
    icon: BookMarked,
  },
  {
    id: "summary",
    title: "Summary",
    description: "Summarise the key points",
    prompt: "Summarise the key points",
    mode: "SUMMARIZE",
    icon: ListChecks,
  },
  {
    id: "pitfalls",
    title: "Pitfalls",
    description: "Examine common misconceptions",
    prompt: "Examine common misconceptions",
    mode: "EXPLAIN",
    icon: TriangleAlert,
  },
  {
    id: "exam-help",
    title: "Exam help",
    description: "Tips for understanding this topic",
    prompt: "Give tips for understanding this topic and how it is examined",
    mode: "EXPLAIN",
    icon: GraduationCap,
  },
];

interface ClaMessage {
  role: "user" | "assistant";
  content: string;
  mode?: NoteMode;
  citations?: TutorCitation[];
  provider?: string;
  model?: string | null;
  refused?: boolean;
  evidenceCount?: number;
  latencyMs?: number;
}

export function NoteCla({
  course,
  noteId,
  noteTitle,
  specPointCodes,
  subtopicTitle,
  guidedStudy,
}: {
  course: string;
  noteId: string;
  noteTitle: string;
  specPointCodes: string[];
  subtopicTitle: string | null;
  guidedStudy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ClaMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [freeMode, setFreeMode] = useState<NoteMode>("EXPLAIN");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // SME chat-widget parity (HUB-CLA-POPUP): popup (floating, bottom-right) or
  // sidebar (the right Sheet — SME's "expanded" docked column). One shared
  // preference across the CLA panels; the popup form is desktop-only (below
  // lg the Sheet's fullscreen overlay matches SME's mobile wash).
  const [form, setForm] = useClaPanelForm();
  const isDesktop = useIsDesktop();
  const usePopup = open && form === "popup" && isDesktop;

  // the popup shell is non-modal (SME's popup floats over a live page) — it
  // owns its own Escape handling; the Sheet keeps Radix's
  useEffect(() => {
    if (!usePopup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    popupRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [usePopup]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread, busy]);

  async function ask(mode: NoteMode, question: string, isQuickAction: boolean) {
    if (busy || !question.trim()) return;
    const history = thread.map((m) => ({ role: m.role, content: m.content }));
    setThread((t) => [...t, { role: "user", content: question.trim() }]);
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
        body: JSON.stringify({ course, noteId, mode, question: question.trim(), history, isQuickAction }),
      });
      const data = await res.json();
      if (!res.ok) {
        // fail-closed server verdicts render as guidance, never as noise
        setError(
          data.error === "context_not_found"
            ? "The server could not resolve this note — reload the page and try again."
            : data.error === "mode_not_valid_for_context"
              ? "That mode needs an exam-question context (arriving with the exam-question CLA)."
              : (data.detail ?? "The assistant call failed."),
        );
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
        },
      ]);
    } catch {
      setError("Network error while asking — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // SME's expand/collapse toggle (labels verbatim: "Expand chat" when the
  // popup can grow into the sidebar, "Collapse chat" when it can come back)
  const formToggleButton = (
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
  );

  // one panel body, rendered by whichever shell is active — SME's gradient
  // header title rides both shells (background-clip:text, their verbatim
  // flourish)
  const panelTitle = (
    <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
      Contextual Learning Assistant
    </span>
  );

  const panelBody = (
    <>
      {/* amber honesty banner — the Save My Exams reference panel's
          signature (HUB-TUTOR-CLA-LOOK), on the hub's theme-aware warn
          tokens */}
      <div className="flex items-start gap-2 border-b bg-warn/10 px-4 py-2.5 text-xs leading-relaxed text-warn-ink">
        <Info className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
        <p>
          The assistant can make mistakes. It answers only from this note
          and validated material — check the citations on every answer.
        </p>
      </div>

      {/* server-resolved context: data, not judgment (production §3) */}
      <div className="space-y-1.5 border-b bg-muted/40 px-4 py-3">
        <div className="flex items-start gap-2">
          <BookOpenText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <p className="min-w-0 text-[13px] font-medium leading-snug">{noteTitle}</p>
        </div>
        <div className="flex flex-wrap gap-1 pl-6">
          {subtopicTitle && <Badge variant="outline" className="text-[10px]">{subtopicTitle}</Badge>}
          {specPointCodes.slice(0, 4).map((c) => (
            <Badge key={c} variant="secondary" className="font-mono text-[10px]">
              {c}
            </Badge>
          ))}
        </div>
        <p className="pl-6 text-[11px] leading-snug text-muted-foreground">
          The server resolves this context from the page you&apos;re on — the assistant cannot be
          pointed anywhere else.
        </p>
      </div>

      {/* mode vocabulary — EXPLAIN/SUMMARIZE select the free-input mode;
          HINT/CHECK are question-context modes (exam-question CLA, later) */}
      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
        <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Mode
        </span>
        {(["EXPLAIN", "SUMMARIZE"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setFreeMode(m)}
            aria-pressed={freeMode === m}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
              freeMode === m
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            {m === "EXPLAIN" ? (
              <Sparkles className="size-3" aria-hidden />
            ) : (
              <ListChecks className="size-3" aria-hidden />
            )}
            {m === "EXPLAIN" ? "Explain" : "Summarize"}
          </button>
        ))}
        {(["HINT", "CHECK"] as const).map((m) => (
          <span
            key={m}
            title="Question contexts only — arriving with the exam-question CLA (attempt-gated in production)"
            className="cursor-not-allowed rounded-full border border-dashed px-2.5 py-0.5 text-[11px] text-muted-foreground/60"
          >
            {m === "HINT" ? "Hint" : "Check"}
          </span>
        ))}
      </div>

      {/* the 4 quick options (operator spec, verbatim) */}
      <div className="grid grid-cols-2 gap-2 border-b px-4 py-3">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy}
            onClick={() => ask(a.mode, a.prompt, true)}
            className="group flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5">
              <a.icon className="size-3.5 text-primary" aria-hidden />
              <span className="text-[13px] font-semibold">{a.title}</span>
              <span className="ml-auto rounded-full bg-muted px-1.5 py-px font-mono text-[9px] font-medium text-muted-foreground">
                {a.mode}
              </span>
            </span>
            <span className="text-[11px] leading-snug text-muted-foreground">{a.description}</span>
          </button>
        ))}
      </div>

      {/* thread */}
      <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {thread.length === 0 && !busy && (
          <p className="pt-2 text-center text-xs leading-relaxed text-muted-foreground">
            Ask about this note — the assistant answers only from the note you&apos;re reading,
            cites the sections it used, and refuses rather than guessing when the note
            doesn&apos;t cover your question.
          </p>
        )}
        {thread.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-[13px]">
              {m.content}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                "space-y-2 rounded-lg border px-3 py-2.5",
                m.refused ? "border-warn/40 bg-warn/5" : "bg-muted/40",
              )}
            >
              {m.refused && (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-warn">
                  <TriangleAlert className="size-3.5" aria-hidden />
                  Honest refusal — bounded to this note
                </p>
              )}
              <Markdown className="text-sm [&_p]:text-sm">{m.content}</Markdown>
              {m.citations && m.citations.length > 0 && !m.refused && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {m.citations.map((c) => (
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
              <p className="text-[10px] text-muted-foreground">
                {m.provider === "unavailable"
                  ? "no AI provider answered — structured fallback shown"
                  : m.provider === "mock"
                    ? "demo fallback provider"
                    : `Answered by ${m.provider ?? "?"}`}
                {m.model ? ` · ${m.model}` : ""} · mode {m.mode}
                {typeof m.evidenceCount === "number" ? ` · ${m.evidenceCount} note section${m.evidenceCount === 1 ? "" : "s"}` : ""}
                {typeof m.latencyMs === "number" ? ` · ${m.latencyMs}ms` : ""}
              </p>
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            grounding in this note…
          </div>
        )}
      </div>

      {/* free input */}
      <div className="space-y-2 border-t px-4 py-3">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
            {error}
          </p>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = draft;
            setDraft("");
            ask(freeMode, q, false);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Ask anything about “${noteTitle.slice(0, 28)}${noteTitle.length > 28 ? "…" : ""}”`}
            maxLength={600}
            disabled={busy}
            aria-label="Ask the contextual assistant about this note"
          />
          <Button type="submit" size="icon" className="size-10 shrink-0" disabled={busy || !draft.trim()} aria-label="Send">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
          </Button>
        </form>
      </div>
    </>
  );

  return (
    <>
      {/* guided-study banner (SME anatomy, research §5.3) — now opens the CLA
          panel instead of navigating to /tutor: asking about THIS note is the
          CLA's job; the free Tutor stays in the nav for whole-corpus asks */}
      {guidedStudy && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="size-4 text-primary" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Contextual help available on this note</p>
            <p className="text-xs text-muted-foreground">
              Ask the CLA about this note — answers are grounded in this note with citations, and it
              says so when the note doesn&apos;t cover your question.
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
            Ask about this
          </Button>
        </div>
      )}

      {/* the overlay entry — one CLA button on every note page */}
      <Button
        size="sm"
        className="fixed bottom-6 right-6 z-40 h-12 gap-2 rounded-full px-5 shadow-lg"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="size-4" aria-hidden />
        CLA
      </Button>

      {/* ── the popup shell (SME's default form, HUB-CLA-POPUP) ──
          fixed bottom-right, 410×640 (min 400, max 100dvh−navbar−2rem),
          rounded-3xl, shadow, NO backdrop — the page stays interactive.
          Portaled to body: an ancestor transform anywhere in the note page
          would otherwise become the containing block for position:fixed
          (probe-caught: bottom measured 36px instead of 16px). */}
      {usePopup &&
        createPortal(
          <div
            ref={popupRef}
            role="dialog"
            aria-modal="false"
            aria-label="Contextual Learning Assistant"
            aria-describedby="cla-popup-context"
            tabIndex={-1}
            className="fixed bottom-4 right-4 z-50 flex h-[640px] min-h-[400px] max-h-[calc(100dvh-5.5rem)] w-[410px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl border bg-background shadow-lg outline-none"
          >
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-sm font-semibold">{panelTitle}</p>
                <p id="cla-popup-context" className="text-[11px] text-muted-foreground">
                  Grounded in the note you&apos;re reading — nothing else.
                </p>
              </div>
              {formToggleButton}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                title="Close chat"
                className={claHeaderCircleBtn}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            {panelBody}
          </div>,
          document.body,
        )}

      {/* ── the sidebar shell (SME's "expanded" form) — the right Sheet,
          fullscreen overlay below lg (SME's mobile wash) ── */}
      <Sheet open={open && !usePopup} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
          aria-describedby="cla-context"
        >
          <SheetHeader className="flex-row items-center gap-0 border-b px-4 py-3 text-left">
            <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1 pl-2 leading-tight">
              <SheetTitle className="block text-sm font-semibold">{panelTitle}</SheetTitle>
              <SheetDescription id="cla-context" className="text-[11px] leading-tight">
                Grounded in the note you&apos;re reading — nothing else.
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
