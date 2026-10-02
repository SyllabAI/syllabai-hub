"use client";

/**
 * Tutor — the definitive chat surface.
 *
 * A full-height chatbot workspace: conversation rail (search, history
 * groups, rename/delete, identity), chat header (grounding + live provider
 * badges, about popover, export, clear), the grounded message stream
 * (markdown + KaTeX, numbered citations, copy / edit-resend / regenerate /
 * feedback, honest refusal-abort-error states) and the composer deck
 * (auto-grow, char budget, dictation, send/stop).
 *
 * Grounding contract is unchanged: the browser only talks to /api/ai/chat
 * on this origin; the server retrieves over the bundled corpus, enforces
 * the evidence-sufficiency gate and streams citations + answer. Conversation
 * text never mutates canonical data (brief §6/§27) — threads persist in
 * localStorage only.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { api, getToken } from "@/lib/api";
import { useIdentity } from "@/lib/identity";
import type { TutorSessionSummary, TutorSessionTurnView } from "@/lib/types";
import { Composer, QUESTION_CAP } from "./composer";
import { MessageItem } from "./message-item";
import { SidebarBrand, ThreadSidebar } from "./thread-sidebar";
import type { Thread, Turn } from "./threads";
import {
  appendMessages,
  bindSession,
  createThread,
  downloadThread,
  ensureActiveThread,
  getThreads,
  historyFor,
  patchLastMessage,
  setActiveThread,
  unbindSession,
  updateThread,
  useThreadsSnapshot,
} from "./threads";
import {
  ArrowDown,
  Atom,
  BookOpen,
  Calculator,
  Database,
  Download,
  Eraser,
  GraduationCap,
  HelpCircle,
  ListChecks,
  PanelLeft,
  Plus,
  Sparkles,
  Target,
} from "lucide-react";

const STARTERS: { icon: typeof BookOpen; label: string; prompt: string }[] = [
  {
    icon: BookOpen,
    label: "Explain a concept",
    prompt: "Explain the three states of matter and what 4CH1-1.1 requires",
  },
  {
    icon: Calculator,
    label: "Work a calculation",
    prompt: "How do you calculate moles from mass and RFM?",
  },
  {
    icon: ListChecks,
    label: "Look up a spec point",
    prompt: "What does 4CH1-1.25 say about ionic bonding?",
  },
  {
    icon: Target,
    label: "Exam technique",
    prompt: "Give me a mark-scheme style answer for a separation techniques question",
  },
];

/** "near the bottom" tolerance (px) for auto-follow + jump-button visibility. */
const NEAR_BOTTOM_PX = 96;
const SIDEBAR_KEY = "syllabai.tutor.sidebar";

/**
 * Map a stored §22 transcript turn back to the thread's Turn shape (web s140
 * hydration parity). Restored assistant turns keep the honest provider and
 * refusal flags; citations are NOT reconstructed — the stored prose is the
 * learner-visible answer (the citation archive of record is core's research
 * telemetry), and a locally-bound thread is preferred over re-hydration for
 * exactly that reason.
 */
function restoredTurn(turn: TutorSessionTurnView): Turn {
  return {
    role: turn.role === "assistant" ? "assistant" : "user",
    content: turn.content,
    at: Date.parse(turn.at) || Date.now(),
    provider: turn.provider ?? undefined,
    refused: turn.refused || undefined,
  };
}

/**
 * Sidebar preference, hydration-safe: server snapshot is "open", client
 * snapshot reads the stored pref; same-tab toggles go through an override so
 * no effect ever needs to sync state.
 */
const subscribeSidebarPref = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};
const getSidebarPref = () => {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
};

/**
 * V53 (ADR-030) course gate: the tutor is honestly unavailable here. A
 * course whose registry row carries no `curriculumCode` has NO serving
 * corpus on core, and an unknown slug never did — gating is the feature,
 * never a silent cross-corpus fallback (a chemistry answer inside a
 * physics chat is worse than an honest "not yet").
 */
export function TutorCourseGate({
  label,
  reason,
}: {
  label: string;
  reason: "unknown" | "unmapped";
}) {
  const unknown = reason === "unknown";
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <span
          className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-hidden
        >
          <GraduationCap className="size-5" />
        </span>
        <h1 className="mt-3 text-base font-semibold">
          {unknown ? "Course not found" : `Tutor not yet available for ${label}`}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {unknown
            ? `No course is registered under "${label}" — check the link or pick the course from its hub.`
            : `The ${label} tutor is not connected to a validated serving corpus yet. SyllabAI never answers across courses, so there is nothing to chat with here — the gate is honest, not a fallback to another course's material.`}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/">Back to the hub</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/tutor">Open the pilot tutor</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TutorChat({
  courseSlug = null,
  courseLabel = null,
  courseRef = null,
}: {
  /** V53 (ADR-030): the course this tutor instance is scoped to, resolved
   *  by the server page from the registry. null = the legacy course-less
   *  entry (pilot behavior byte-identical). */
  courseSlug?: string | null;
  courseLabel?: string | null;
  courseRef?: string | null;
} = {}) {
  const { threads, activeId } = useThreadsSnapshot();
  const activeThread = threads.find((t) => t.id === activeId) ?? null;
  const messages = activeThread?.messages ?? [];
  const identity = useIdentity();

  const [input, setInput] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [meta, setMeta] = useState<{ provider?: string; model?: string | null }>({});
  const sidebarPref = useSyncExternalStore(subscribeSidebarPref, getSidebarPref, () => true);
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const sidebarOpen = sidebarOverride ?? sidebarPref;
  const [mobileNav, setMobileNav] = useState(false);

  // §22 server conversations (web s143 parity): the synced pane's data. null
  // = still loading; a failed load shows an honest inline error, never a
  // blank pane — the chat itself keeps working either way.
  const [conversations, setConversations] = useState<TutorSessionSummary[] | null>(null);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TutorSessionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const hydratedServerRef = useRef(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortsRef = useRef<Map<string, AbortController>>(new Map());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** V53: threads created inside this tutor instance carry the course. */
  const courseContext =
    courseSlug && courseLabel ? { slug: courseSlug, label: courseLabel } : null;

  // anchored entry points: /tutor?q=…&spec=4CH1-1.1 ("Ask about this" and
  // "Question help" across the Learning Hub). The spec code is appended to
  // the REQUEST for retrieval anchoring only — the user's words are
  // displayed verbatim, and nothing here writes to canonical data.
  const params = useSearchParams();
  const anchoredSpec = params.get("spec");
  const anchorSuffix = anchoredSpec ? ` (specification point ${anchoredSpec})` : "";
  const maxLen = Math.max(0, QUESTION_CAP - anchorSuffix.length);
  const bootQuestion = params.get("q");
  const bootedRef = useRef(false);

  const toggleSidebar = () => {
    const next = !sidebarOpen;
    setSidebarOverride(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? "open" : "closed");
    } catch {
      /* private mode — session-only */
    }
  };

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
  };

  // ── §22 server conversations (web s143 parity) ─────────────────────
  // One small summary GET on mount, refreshed after every completed ask (a
  // new chat appears, the active one re-titles and re-dates) and after a
  // delete. The pane degrades honestly — a failed load never blocks the chat.
  const refreshConversations = useCallback(async () => {
    if (!getToken()) return;
    try {
      const list = await api.tutorSessionList();
      setConversations(list);
      setConversationsError(null);
    } catch (err) {
      setConversationsError(err instanceof Error ? err.message : "unavailable");
    }
  }, []);

  // ── the grounded turn ───────────────────────────────────────────────
  const ask = useCallback(
    async (threadId: string, question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      const history = historyFor(getThreads().find((t) => t.id === threadId)?.messages ?? []);
      const controller = new AbortController();
      abortsRef.current.set(threadId, controller);
      setStreamingId(threadId);
      appendMessages(threadId, [
        { role: "user", content: trimmed, at: Date.now() },
        { role: "assistant", content: "", at: Date.now() },
      ]);
      setInput("");
      setAtBottom(true);
      requestAnimationFrame(() => scrollToBottom(false));

      const patchTurn = (patch: Partial<Turn>) =>
        patchLastMessage(threadId, (m) => ({ ...m, ...patch }));

      // §22 (web s140 parity): lazily create the server session on the first
      // ask of a signed-in chat. A failed create degrades to an unpersisted
      // ask — the answer matters more than its archival.
      let sessionId: string | null = getThreads().find((t) => t.id === threadId)?.sessionId ?? null;
      if (!sessionId && getToken()) {
        try {
          const created = await api.tutorSessionCreate();
          bindSession(threadId, created.sessionId);
          sessionId = created.sessionId;
        } catch {
          sessionId = null;
        }
      }

      try {
        const token = getToken();
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            question: `${trimmed}${anchorSuffix}`.slice(0, QUESTION_CAP),
            history,
            ...(sessionId ? { sessionId } : {}),
            // V53: the course scope rides EVERY ask — core resolves it
            // fail-closed and refuses cross-course asks deterministically
            ...(courseRef ? { courseRef } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.body || !res.ok) {
          // core's §22 integrity probe 404s a foreign/deleted session BEFORE
          // the stream opens — drop the stale binding so the next ask lazily
          // creates a fresh session (web s140's foreign-id drop, hub terms)
          if (res.status === 404 && sessionId) {
            unbindSession(threadId);
            patchTurn({
              error: true,
              content:
                "This conversation's server copy has ended — your next reply starts a fresh synced chat.",
            });
            return;
          }
          throw new Error(`stream failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";
        // the hub's terminal handshake — a stream that ends without it was cut
        let sawDone = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const evt of events) {
            // spec-compliant field read: ONE optional leading space after the
            // colon — core's SseEmitter writes `event:citations` (no space),
            // the hub's legacy fallback writes `event: citations`
            const field = (name: string): string | undefined => {
              const line = evt.split("\n").find((l) => l.startsWith(`${name}:`));
              if (line === undefined) return undefined;
              const v = line.slice(name.length + 1);
              return v.startsWith(" ") ? v.slice(1) : v;
            };
            const event = field("event");
            const dataLine = field("data");
            if (!event || !dataLine) continue;
            // the hub's SSE data shapes, typed where the loop reads them
            let data: {
              citations?: import("@/lib/contracts").TutorCitation[];
              provider?: string;
              model?: string | null;
              refused?: boolean;
              text?: string;
              message?: string;
            };
            try {
              data = JSON.parse(dataLine);
            } catch {
              continue; // malformed frame — skip it, don't kill the turn
            }
            if (event === "citations") {
              patchTurn({ citations: data.citations });
            } else if (event === "meta") {
              setMeta({ provider: data.provider, model: data.model });
              patchTurn({ provider: data.provider, refused: data.refused });
            } else if (event === "delta") {
              answer += data.text as string;
              patchTurn({ content: answer });
              // follow the stream only while the reader is pinned to the bottom
              const el = scrollRef.current;
              if (el && el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX + 48) {
                el.scrollTop = el.scrollHeight;
              }
            } else if (event === "error") {
              throw new Error((data.message as string) || "provider error");
            } else if (event === "done") {
              sawDone = true;
            }
          }
        }
        // honesty handshake: the hub ends every stream with done or an error
        // event — a silent close (serverless wall, network cut) must not
        // render as a complete answer
        if (!sawDone) patchTurn({ error: true });
      } catch (e) {
        // fetch abort surfaces as AbortError across runtimes — check the name
        const aborted = e instanceof Error && e.name === "AbortError";
        const thread = getThreads().find((t) => t.id === threadId);
        if (!thread) return; // deleted mid-stream — nothing to settle
        if (aborted) {
          patchTurn({
            stopped: true,
            content:
              thread.messages[thread.messages.length - 1]?.content ||
              "Generation stopped before any output.",
          });
        } else {
          patchTurn({ error: true });
        }
      } finally {
        abortsRef.current.delete(threadId);
        setStreamingId((cur) => (cur === threadId ? null : cur));
        // s143 parity: every completed attempt may have changed the server
        // list (a brand-new chat, a re-dated active one — even a failed ask
        // can leave an honestly-empty row the learner can see and delete)
        if (getToken()) void refreshConversations();
      }
    },
    [anchorSuffix, courseRef, scrollToBottom, refreshConversations],
  );

  // boot an anchored question from the Learning Hub deep links
  useEffect(() => {
    if (bootQuestion && !bootedRef.current) {
      bootedRef.current = true;
      const thread = ensureActiveThread(courseContext);
      void ask(thread.id, bootQuestion);
    }
    // one-shot deep-link boot: `ask` is deliberately absent — the guard ref
    // makes this fire once per bootQuestion, and re-subscribing to ask's
    // identity would re-arm the boot on every render (demo-verified behavior)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootQuestion]);

  // s143: the synced pane's list loads on mount — and, s140 adapted to the
  // hub: a SIGNED-IN browser with an empty local store (fresh device, cleared
  // storage, private mode) restores the most recent server conversation, so
  // the chat picks up where the account left off. Local transcripts already
  // survive refresh via localStorage; the server is the store of record.
  // Skipped when a deep-link boot is armed (it creates its own thread).
  useEffect(() => {
    void refreshConversations();
    if (hydratedServerRef.current) return;
    hydratedServerRef.current = true;
    if (bootQuestion || !getToken()) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await api.tutorSessionList();
        if (cancelled || list.length === 0) return;
        const existing = getThreads();
        if (existing.length > 0) return; // local history present — nothing to recover
        const session = await api.tutorSessionGet(list[0].sessionId);
        if (cancelled || session.turns.length === 0) return;
        const thread = createThread(list[0].title?.trim() || "Restored conversation");
        bindSession(thread.id, session.sessionId);
        updateThread(thread.id, (t) => ({ ...t, messages: session.turns.map(restoredTurn) }));
        setActiveThread(thread.id);
      } catch {
        // unknown/expired/foreign — a fresh chat, never an error wall
      }
    })();
    return () => {
      cancelled = true;
    };
    // once-per-mount bootstrap — deliberately unreactive to transcript changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** s143: resume a synced conversation — the transcript comes from the
   *  server (every completed ask was persisted), so switching away and back
   *  loses nothing. A thread already bound to this session is reused as-is
   *  (its local copy may carry citations the stored turns do not). */
  const openServerConversation = async (summary: TutorSessionSummary) => {
    if (streamingId !== null || summary.sessionId === activeThread?.sessionId) return;
    setOpeningId(summary.sessionId);
    try {
      const bound = getThreads().find((t) => t.sessionId === summary.sessionId);
      if (bound) {
        setActiveThread(bound.id);
        return;
      }
      const session = await api.tutorSessionGet(summary.sessionId);
      const thread = createThread(summary.title?.trim() || "Restored conversation");
      bindSession(thread.id, session.sessionId);
      updateThread(thread.id, (t) => ({ ...t, messages: session.turns.map(restoredTurn) }));
      setActiveThread(thread.id);
    } catch {
      // deleted on another device / foreign id — drop it from the pane
      // honestly; the transcript stays whatever it currently is
      setConversations((prev) =>
        prev ? prev.filter((c) => c.sessionId !== summary.sessionId) : prev,
      );
    } finally {
      setOpeningId(null);
    }
  };

  /** s143: delete a synced conversation — §20 data minimization, the
   *  learner's own transcript, their call (confirm-gated: a server delete
   *  has no undo). Deleting the ACTIVE chat's session unbinds the thread —
   *  its local copy stays as an honest local-only transcript. */
  const confirmDeleteServer = async () => {
    const target = deleteTarget;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      await api.tutorSessionDelete(target.sessionId);
      setConversations((prev) =>
        prev ? prev.filter((c) => c.sessionId !== target.sessionId) : prev,
      );
      const bound = getThreads().find((t) => t.sessionId === target.sessionId);
      if (bound) unbindSession(bound.id);
      setDeleteTarget(null);
    } catch (err) {
      // keep the pane honest: the delete failed, the chat is still there
      setConversationsError(err instanceof Error ? err.message : "Could not delete — try again.");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const busyHere = streamingId !== null && streamingId === activeId;

  const send = (override?: string) => {
    const q = (override ?? input).trim();
    if (!q) return;
    const thread = activeThread ?? createThread("New chat", courseContext);
    void ask(thread.id, q);
  };

  /** Drop everything from the assistant turn onward and re-ask its question. */
  const regenerateAt = (assistantIdx: number) => {
    if (!activeThread || busyHere) return;
    const question = activeThread.messages[assistantIdx - 1]?.content;
    if (!question?.trim()) return;
    const threadId = activeThread.id;
    updateThread(threadId, (t) => ({ ...t, messages: t.messages.slice(0, Math.max(0, assistantIdx - 1)) }));
    void ask(threadId, question);
  };

  /** Replace a user turn's text and re-ask from that point. */
  const editResend = (userIdx: number, text: string) => {
    if (!activeThread || busyHere) return;
    const threadId = activeThread.id;
    updateThread(threadId, (t) => ({
      ...t,
      messages: [...t.messages.slice(0, userIdx), { role: "user", content: text, at: Date.now() }],
      title: userIdx === 0 ? (text.length > 52 ? `${text.slice(0, 52)}…` : text) : t.title,
    }));
    void ask(threadId, text);
  };

  const copyAt = async (i: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(i);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedIdx(null), 1600);
    } catch {
      // clipboard unavailable (permissions / insecure context) — stay silent
    }
  };

  const setFeedback = (idx: number, v: "up" | "down") => {
    if (!activeThread) return;
    updateThread(activeThread.id, (t) => {
      const messages = [...t.messages];
      const cur = messages[idx];
      messages[idx] = { ...cur, feedback: cur.feedback === v ? null : v };
      return { ...t, messages };
    });
  };

  const clearConversation = () => {
    abortsRef.current.get(activeId ?? "")?.abort();
    if (activeThread) {
      updateThread(activeThread.id, (t) => ({ ...t, messages: [], title: "New chat" }));
    }
    setMeta({});
  };

  const newChat = () => {
    const t = createThread("New chat", courseContext);
    setActiveThread(t.id);
    setMobileNav(false);
  };

  const iconBtn =
    "inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] overflow-hidden">
      {/* desktop rail */}
      <aside
        className={
          sidebarOpen ? "hidden w-72 shrink-0 border-r lg:block" : "hidden"
        }
      >
        <ThreadSidebar
          threads={threads}
          activeId={activeId}
          onNewChat={newChat}
          conversations={conversations}
          conversationsError={conversationsError}
          activeSessionId={activeThread?.sessionId ?? null}
          activeCourseSlug={courseSlug}
          activeCourseLabel={courseLabel}
          activeCourseRef={courseRef}
          openingId={openingId}
          onOpenConversation={openServerConversation}
          onDeleteConversation={setDeleteTarget}
        />
      </aside>

      {/* mobile rail */}
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="w-80 gap-0 p-0">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <SidebarBrand />
          <div className="min-h-0 flex-1">
            <ThreadSidebar
              threads={threads}
              activeId={activeId}
              onNewChat={newChat}
              onNavigate={() => setMobileNav(false)}
              conversations={conversations}
              conversationsError={conversationsError}
              activeSessionId={activeThread?.sessionId ?? null}
              activeCourseSlug={courseSlug}
              activeCourseLabel={courseLabel}
              activeCourseRef={courseRef}
              openingId={openingId}
              onOpenConversation={(s) => {
                void openServerConversation(s);
              }}
              onDeleteConversation={setDeleteTarget}
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* chat header */}
        <header className="flex h-12 shrink-0 items-center gap-1.5 border-b px-2.5 sm:px-4">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? "Hide conversations" : "Show conversations"}
            className={cn(iconBtn, "hidden lg:inline-flex")}
          >
            <PanelLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setMobileNav(true)}
            aria-label="Open conversations"
            className={cn(iconBtn, "lg:hidden")}
          >
            <PanelLeft className="size-4" aria-hidden />
          </button>

          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
            aria-hidden
          >
            <GraduationCap className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {activeThread?.title ?? "New chat"}
            </p>
            <p className="truncate text-[10.5px] text-muted-foreground">
              SyllabAI tutor · answers only from validated course content
            </p>
          </div>

          <Badge
            variant="outline"
            className="hidden gap-1 font-mono text-[10px] md:inline-flex"
            title={meta.model ?? undefined}
          >
            <Sparkles className="size-3 text-primary" aria-hidden />
            {meta.provider ?? "auto"}
          </Badge>
          <Badge variant="outline" className="hidden gap-1 text-[10px] font-normal sm:inline-flex">
            <Database className="size-3" aria-hidden />
            {courseLabel ? `${courseLabel} corpus` : "4CH1 corpus"}
          </Badge>

          {/* the reference's New chat action (itutor.study header, verbatim
              anatomy): bordered pill, Plus glyph, label on sm+ and icon-only
              below — it starts a FRESH thread (server-session binding and
              all), unlike the eraser which empties the current one */}
          <button
            type="button"
            onClick={newChat}
            title="Start a new chat"
            aria-label="New chat"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:w-auto sm:px-3"
          >
            <Plus className="size-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">New chat</span>
          </button>

          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={iconBtn} aria-label="About this tutor">
                <HelpCircle className="size-4" aria-hidden />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 text-xs">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Atom className="size-4 text-primary" aria-hidden /> SyllabAI Tutor
              </p>
              <ul className="mt-2 space-y-2 leading-relaxed text-muted-foreground">
                <li>
                  <strong className="text-foreground">Grounded answers.</strong> Every reply is
                  retrieved from the corpus and carries numbered citations that deep-link to the
                  notes, spec points and worked solutions behind it.
                </li>
                <li>
                  <strong className="text-foreground">Honest refusals.</strong> When the evidence is
                  thin it says so instead of guessing — accuracy before confidence.
                </li>
                <li>
                  <strong className="text-foreground">Coverage.</strong> Pearson Edexcel
                  International GCSE Chemistry (4CH1).{" "}
                  {identity
                    ? "Conversations sync to your SyllabAI account — resume them on any device."
                    : "Conversations stay in this browser."}
                </li>
              </ul>
            </PopoverContent>
          </Popover>

          <button
            type="button"
            className={iconBtn}
            aria-label="Export conversation"
            disabled={!activeThread || messages.length === 0}
            onClick={() => activeThread && downloadThread(activeThread)}
          >
            <Download className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={iconBtn}
            aria-label="Clear conversation"
            disabled={!activeThread || messages.length === 0}
            onClick={clearConversation}
          >
            <Eraser className="size-4" aria-hidden />
          </button>
        </header>

        {/* stream */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            role="log"
            aria-live="polite"
            aria-label="Tutor conversation"
            className="h-full overflow-y-auto"
          >
            {messages.length === 0 ? (
              <Welcome
                firstName={
                  identity ? identity.name.trim().split(/\s+/)[0] || null : null
                }
                onPick={(p) => send(p)}
              />
            ) : (
              <div className="mx-auto w-full max-w-3xl space-y-5 px-3 py-5 sm:px-4">
                {messages.map((m, i) => (
                  <MessageItem
                    key={i}
                    message={m}
                    streaming={streamingId === activeId && i === messages.length - 1}
                    busy={busyHere}
                    canRegenerate={i === messages.length - 1 && !busyHere}
                    copied={copiedIdx === i}
                    onCopy={() => copyAt(i, m.content)}
                    onRegenerate={() => regenerateAt(i)}
                    onEditResend={(text) => editResend(i, text)}
                    onFeedback={(v) => setFeedback(i, v)}
                  />
                ))}
              </div>
            )}
          </div>

          {!atBottom && messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setAtBottom(true);
                scrollToBottom(true);
              }}
              className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background px-3 py-1 text-[11px] text-muted-foreground shadow-sm transition-colors hover:text-foreground"
            >
              <ArrowDown className="size-3" aria-hidden /> Jump to latest
            </button>
          )}
        </div>

        {/* composer deck */}
        <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent">
          <div className="mx-auto w-full max-w-3xl space-y-2 px-3 pt-2 sm:px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {anchoredSpec && (
              <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs">
                <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  Anchored to specification point{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{anchoredSpec}</code>
                  — retrieval and citations prefer this anchor.
                </span>
              </div>
            )}
            <Composer
              value={input}
              onChange={setInput}
              busy={busyHere}
              maxLen={maxLen}
              placeholder={
                messages.length === 0
                  ? "Ask about states of matter, bonding, moles, exam technique…"
                  : "Reply to SyllabAI Tutor…"
              }
              // () => send(): the composer's Send button calls onSend with the
              // CLICK EVENT as its argument — passing send directly would make
              // that event the `override` question and crash on .trim() (a
              // real-click-only bug; Enter-to-send masked it in verification).
              onSend={() => send()}
              onStop={() => abortsRef.current.get(activeId ?? "")?.abort()}
            />
            <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
              Answers cite the {courseLabel ? `${courseLabel} corpus` : "4CH1 corpus"} and can make
              mistakes — check citations before an exam. By asking you agree to the{" "}
              <Link href="/" className="underline underline-offset-2 hover:text-foreground">
                study-use terms
              </Link>
              .
            </p>
          </div>
        </div>
      </div>

      {/* s143: server-delete confirm — a §22 delete has no undo (unlike the
          local-thread toast-undo, which only ever touched this browser) */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title?.trim() || "Empty conversation"}” will be removed from your
              SyllabAI account on every device. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteServer();
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The itutor.study reference's time-of-day greeting (HUB-TUTOR-CLA-LOOK). */
function greetingFor(at: Date): string {
  const h = at.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Welcome({
  firstName,
  onPick,
}: {
  firstName: string | null;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-8">
      {/* the reference's greeting hero: gradient avatar, greet by name,
          honest grounding promise (HUB-TUTOR-CLA-LOOK) */}
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          className="flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm"
          aria-hidden
        >
          <GraduationCap className="size-6" />
        </span>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {greetingFor(new Date())}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            Your grounded study companion for Pearson Edexcel IGCSE Chemistry.
            Every answer cites the spec points and notes it draws on — and tells
            you honestly when the evidence runs thin.
          </p>
        </div>
      </div>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {STARTERS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.prompt)}
            title={s.prompt}
            className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3.5 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <s.icon className="size-3.5" aria-hidden />
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        Paste a question, a spec code like{" "}
        <code className="rounded bg-muted px-1 py-px font-mono">4CH1-1.38</code>, or tap a starter
        above.
      </p>
    </div>
  );
}
