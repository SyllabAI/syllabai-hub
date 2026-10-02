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
 * (attempt-gated in core's ClaLeakagePolicy) — the API rejects them for
 * note contexts, so they are simply not offered here. The exam-question CLA
 * (anchored to PAST_PAPER_QUESTION contexts, where HINT/CHECK unlock
 * post-attempt) is the question-cla-overlay surface.
 *
 * SME chat-widget dual form (HUB-CLA-POPUP + HUB-CLA-SIDEBAR): the panel
 * opens as a floating popup — fixed bottom-right, 410×640, rounded-3xl,
 * shadowed, NO backdrop (the page stays interactive), SME's verbatim
 * geometry — and expands into a PHYSICALLY DOCKED right sidebar: SME's
 * expanded chat is a real layout member (`flex: 0 0 400px; position:
 * static` in the page row — the content cedes 400px and keeps scrolling),
 * which the hub mirrors as a 400px right inset on .course-shell-row
 * (globals.css via <html data-cla-sidebar="open">) plus this fixed right
 * column under the navbar. Below 1400px the dock can't exist (SME's expand
 * button is display:none there) and a stored "sidebar" pref degrades to
 * the popup; below lg the Sheet's fullscreen wash carries SME's mobile
 * behaviour. The choice persists across the CLA panels; the transcript/
 * draft/busy state lives in this component, so toggling mid-conversation
 * switches shells without losing the thread.
 *
 * Density (HUB-CLA-SIDEBAR, operator: "the CLA has way too much info"):
 * the panel follows SME's own anatomy — short gradient title + circle
 * buttons, their verbatim ONE-LINE banner ("Chat can make mistakes.
 * Please check all responses carefully."), ONE anchor line (the note
 * title; spec points collapse into its tooltip), the quick actions as
 * SME-style prefilled chips in the empty state only, then chat + input.
 * The per-answer trace stays but collapses behind a tiny disclosure.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookMarked,
  BookOpenText,
  GraduationCap,
  Info,
  Loader2,
  ListChecks,
  Minimize2,
  PanelRightOpen,
  Send,
  Sparkles,
  SquarePen,
  TriangleAlert,
  X,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Markdown } from "@/components/markdown";
import { normalizeMathDelimiters } from "@/lib/mathNormalize";
import type { TutorCitation } from "@/lib/contracts";
import { getToken } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useClaPanelForm, useClaDock, useIsDesktop, useIsWide, claHeaderCircleBtn } from "./cla-panel-mode";

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
  const panelRef = useRef<HTMLDivElement>(null);

  // SME chat-widget parity (HUB-CLA-POPUP + HUB-CLA-SIDEBAR): popup
  // (floating, bottom-right), sidebar (the physically docked right column),
  // or the Sheet's fullscreen wash on mobile. One shared preference across
  // the CLA panels. The dock only exists ≥1400px (SME's expanded gate —
  // below it their expand button is hidden and the expanded rule is inert,
  // so a stored "sidebar" degrades to the popup).
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
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [usePopup, docked]);

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

  // SME's gradient header title (background-clip:text) — short, like their
  // "Explain"; the full product name rides the dialog's aria-label
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

      {/* the anchor, ONE line — the note the assistant is grounded in
          (server-resolved context: data, not judgment, production §3).
          Spec points + subtopic collapse into the tooltip */}
      <div
        className="flex items-center gap-2 border-b px-4 py-2"
        title={[subtopicTitle, ...specPointCodes].filter(Boolean).join(" · ")}
      >
        <BookOpenText className="size-3.5 shrink-0 text-primary" aria-hidden />
        <p id="cla-note-anchor" className="min-w-0 truncate text-xs font-medium leading-snug">
          {noteTitle}
        </p>
      </div>

      {/* thread — the 4 quick options (operator spec, verbatim) ride the
          EMPTY state as SME-style prefilled chips (their PrefilledPrompts
          grid: 2 columns, icon + label + one line); once the conversation
          starts they're gone, like SME's suggestions */}
      <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {thread.length === 0 && !busy && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={busy}
                onClick={() => ask(a.mode, a.prompt, true)}
                className="flex flex-col gap-1 rounded-xl bg-primary/10 px-3 py-2.5 text-left transition-colors hover:bg-primary/15 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <a.icon className="size-3.5 shrink-0 text-primary" aria-hidden />
                  {a.title}
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">{a.description}</span>
              </button>
            ))}
          </div>
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
                  Not covered by this note
                </p>
              )}
              <Markdown className="text-sm [&_p]:text-sm">{normalizeMathDelimiters(m.content)}</Markdown>
              {m.citations && m.citations.length > 0 && !m.refused && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {m.citations.map((c) => {
                    // a citation with an in-app surface (the F-022 source
                    // reader for corpus documents) becomes a link; everything
                    // else stays the honest read-only badge
                    const badgeClass =
                      "inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[11px]";
                    const badge = (
                      <>
                        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                          {c.index}
                        </span>
                        <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="max-w-48 truncate font-medium">{c.label}</span>
                      </>
                    );
                    return c.url ? (
                      <a key={c.index} href={c.url} className={badgeClass} title={c.label}>
                        {badge}
                      </a>
                    ) : (
                      <span key={c.index} className={badgeClass} title={c.label}>
                        {badge}
                      </span>
                    );
                  })}
                </div>
              )}
              {/* the §19-style traceability footer — collapsed behind a
                  tiny disclosure (SME shows nothing; the data stays one
                  click away) */}
              <details className="text-[10px] text-muted-foreground">
                <summary className="w-fit cursor-pointer select-none hover:text-foreground">
                  trace
                </summary>
                <p className="pt-0.5">
                  {m.provider === "unavailable"
                    ? "no AI provider answered — structured fallback shown"
                    : m.provider === "mock"
                      ? "demo fallback provider"
                      : `Answered by ${m.provider ?? "?"}`}
                  {m.model ? ` · ${m.model}` : ""} · mode {m.mode}
                  {typeof m.evidenceCount === "number" ? ` · ${m.evidenceCount} note section${m.evidenceCount === 1 ? "" : "s"}` : ""}
                  {typeof m.latencyMs === "number" ? ` · ${m.latencyMs}ms` : ""}
                </p>
              </details>
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Grounding in this note…
          </div>
        )}
      </div>

      {/* free input — the two live mode pills + the ask box */}
      <div className="space-y-2 border-t px-4 py-3">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-center gap-1.5" role="group" aria-label="Answer mode">
          {(["EXPLAIN", "SUMMARIZE"] as const).map((m) => (
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
              {m === "EXPLAIN" ? "Explain" : "Summarize"}
            </button>
          ))}
        </div>
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
            placeholder="Ask about this note…"
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

  // SME's New chat header action, now ported (the last honest-absent
  // circle button): their edit-square glyph, their order — New chat sits
  // before Collapse/Close and resets THIS note's transcript, bringing the
  // quick actions back (the empty state). Disabled while a turn is
  // in-flight — the hub's ask has no abort, and a reply landing in a just-
  // cleared thread would be worse than a brief grey-out.
  const newChat = () => {
    setThread([]);
    setError(null);
  };

  // SME keeps ONE header across their forms: icon + gradient title + the
  // circle buttons — New chat, then the form toggle, then Close (their
  // verbatim order)
  const panelHeader = (closeAffordance: React.ReactNode) => (
    <div className="flex items-center gap-1 border-b px-3 py-2.5">
      <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 truncate pl-1 text-sm font-semibold">{panelTitle}</p>
      <button
        type="button"
        onClick={newChat}
        aria-label="New chat"
        title="New chat"
        disabled={busy}
        className={claHeaderCircleBtn}
      >
        <SquarePen className="size-4" aria-hidden />
      </button>
      {formToggleButton}
      {closeAffordance}
    </div>
  );

  const closeButton = (
    <button
      type="button"
      onClick={() => setOpen(false)}
      aria-label="Close chat"
      title="Close chat"
      className={claHeaderCircleBtn}
    >
      <X className="size-4" aria-hidden />
    </button>
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

      {/* the overlay entry — one CLA button on every note page, hidden while
          the panel is open (SME hides their chat button when the widget is
          open) */}
      {!open && (
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
      )}

      {/* ── the popup shell (SME's default form, HUB-CLA-POPUP) ──
          fixed bottom-right, 410×640 (min 400, max 100dvh−navbar−2rem),
          rounded-3xl, shadow, NO backdrop — the page stays interactive.
          Portaled to body: an ancestor transform anywhere in the note page
          would otherwise become the containing block for position:fixed
          (probe-caught: bottom measured 36px instead of 16px). */}
      {usePopup &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-label="Contextual Learning Assistant"
            aria-describedby="cla-note-anchor"
            tabIndex={-1}
            className="fixed bottom-4 right-4 z-50 flex h-[640px] min-h-[400px] max-h-[calc(100dvh-5.5rem)] w-[410px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl border bg-background shadow-lg outline-none"
          >
            {panelHeader(closeButton)}
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
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-label="Contextual Learning Assistant"
            aria-describedby="cla-note-anchor"
            tabIndex={-1}
            className="fixed bottom-0 right-0 top-14 z-30 flex w-[400px] flex-col border-l bg-background outline-none"
          >
            {panelHeader(closeButton)}
            {panelBody}
          </div>,
          document.body,
        )}

      {/* ── the mobile shell — the Sheet's fullscreen wash below lg (SME's
          mobile behaviour); the expand toggle is absent (SME hides it below
          1400px) ── */}
      <Sheet open={open && !usePopup && !docked} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
          aria-describedby="cla-note-anchor"
        >
          <SheetHeader className="flex-row items-center gap-0 border-b px-4 py-3 text-left">
            <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1 pl-2 leading-tight">
              <SheetTitle className="block text-sm font-semibold">{panelTitle}</SheetTitle>
              <SheetDescription className="sr-only">
                Answers are grounded in this note only.
              </SheetDescription>
            </div>
            {/* pr-9 clears the Sheet's built-in close affordance; the New
                chat circle rides here too — same reset on every shell */}
            <div className="flex shrink-0 items-center gap-1 pr-9">
              <button
                type="button"
                onClick={newChat}
                aria-label="New chat"
                title="New chat"
                disabled={busy}
                className={claHeaderCircleBtn}
              >
                <SquarePen className="size-4" aria-hidden />
              </button>
              {formToggleButton}
            </div>
          </SheetHeader>
          {panelBody}
        </SheetContent>
      </Sheet>
    </>
  );
}
