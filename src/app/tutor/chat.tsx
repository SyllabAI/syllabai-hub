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
import { getToken } from "@/lib/api";
import { Composer, QUESTION_CAP } from "./composer";
import { MessageItem } from "./message-item";
import { SidebarBrand, ThreadSidebar } from "./thread-sidebar";
import type { Turn } from "./threads";
import {
  appendMessages,
  createThread,
  downloadThread,
  ensureActiveThread,
  getThreads,
  historyFor,
  patchLastMessage,
  setActiveThread,
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
  HelpCircle,
  ListChecks,
  PanelLeft,
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

export function TutorChat() {
  const { threads, activeId } = useThreadsSnapshot();
  const activeThread = threads.find((t) => t.id === activeId) ?? null;
  const messages = activeThread?.messages ?? [];

  const [input, setInput] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [meta, setMeta] = useState<{ provider?: string; model?: string | null }>({});
  const sidebarPref = useSyncExternalStore(subscribeSidebarPref, getSidebarPref, () => true);
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const sidebarOpen = sidebarOverride ?? sidebarPref;
  const [mobileNav, setMobileNav] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortsRef = useRef<Map<string, AbortController>>(new Map());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          }),
          signal: controller.signal,
        });
        if (!res.body || !res.ok) throw new Error(`stream failed (${res.status})`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";

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
            const data = JSON.parse(dataLine);
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
            }
          }
        }
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
      }
    },
    [anchorSuffix, scrollToBottom],
  );

  // boot an anchored question from the Learning Hub deep links
  useEffect(() => {
    if (bootQuestion && !bootedRef.current) {
      bootedRef.current = true;
      const thread = ensureActiveThread();
      void ask(thread.id, bootQuestion);
    }
    // one-shot deep-link boot: `ask` is deliberately absent — the guard ref
    // makes this fire once per bootQuestion, and re-subscribing to ask's
    // identity would re-arm the boot on every render (demo-verified behavior)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootQuestion]);

  const busyHere = streamingId !== null && streamingId === activeId;

  const send = (override?: string) => {
    const q = (override ?? input).trim();
    if (!q) return;
    const thread = activeThread ?? createThread();
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
      updateThread(activeThread.id, (t) => ({ ...t, messages: [], title: "New conversation" }));
    }
    setMeta({});
  };

  const newChat = () => {
    const t = createThread();
    setActiveThread(t.id);
    setMobileNav(false);
  };

  const iconBtn =
    "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

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

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {activeThread?.title ?? "New conversation"}
            </p>
            <p className="truncate text-[10.5px] text-muted-foreground">
              Grounded in Pearson Edexcel IGCSE Chemistry (4CH1)
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
            4CH1 corpus
          </Badge>

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
                  International GCSE Chemistry (4CH1). Conversations stay in this browser.
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
              <Welcome onPick={(p) => send(p)} />
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
              Answers cite the 4CH1 corpus and can make mistakes — check citations before an exam.
              By asking you agree to the{" "}
              <Link href="/" className="underline underline-offset-2 hover:text-foreground">
                study-use terms
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-8">
      <div className="flex flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
          <Sparkles className="size-6 text-primary" aria-hidden />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">SyllabAI Tutor</h1>
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          Your grounded study companion for Pearson Edexcel IGCSE Chemistry. Every answer cites the
          spec points and notes it draws on — and tells you honestly when the evidence runs thin.
        </p>
      </div>
      <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
        {STARTERS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.prompt)}
            className="group rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <s.icon className="size-4 text-primary" aria-hidden />
              {s.label}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              “{s.prompt}”
            </span>
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
