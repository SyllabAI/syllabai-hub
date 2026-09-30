"use client";

import { useSyncExternalStore } from "react";

/**
 * Tutor conversation store — multi-thread chat persistence (localStorage).
 *
 * Same store pattern as identity.ts / theme-store.ts: module-level state +
 * useSyncExternalStore, custom event for same-tab reactivity, storage event
 * for cross-tab. Threads are the full client-side model of a conversation;
 * the server stays stateless (each turn POSTs its own history to
 * /api/ai/chat, brief §11).
 */

export interface Turn {
  role: "user" | "assistant";
  content: string;
  at: number;
  citations?: import("@/lib/contracts").TutorCitation[];
  provider?: string;
  refused?: boolean;
  /** transport/stream failure — retryable, distinct from a gate refusal */
  error?: boolean;
  /** generation aborted mid-answer; partial answer (if any) is kept */
  stopped?: boolean;
  /** learner feedback on an assistant turn (local to this surface) */
  feedback?: "up" | "down" | null;
}

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Turn[];
  /** §22 server session this thread appends to (web s140 parity) — lazily
   *  bound on the first ask of a signed-in chat; null = local-only thread
   *  (signed-out history, or a create that failed and degraded honestly). */
  sessionId?: string | null;
  /** V53 (ADR-030): the course this chat belongs to, from the hub registry
   *  (the /tutor?course=<slug> the thread was started under). null/absent =
   *  a course-less chat (the legacy entry, or a restored conversation whose
   *  served course is shown from the SERVER's courseRef chip instead). */
  courseSlug?: string | null;
  courseLabel?: string | null;
}

const KEY = "syllabai.tutor.threads.v1";
const ACTIVE_KEY = "syllabai.tutor.activeThread.v1";
const EVENT = "syllabai:tutor-threads-changed";

/** storage guards — keep localStorage bounded */
const MAX_THREADS = 40;
const MAX_MESSAGES_PER_THREAD = 200;

interface StoredState {
  threads: Thread[];
  activeId: string | null;
}

let state: StoredState = load();
const listeners = new Set<() => void>();

function load(): StoredState {
  if (typeof window === "undefined") return { threads: [], activeId: null };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { threads: [], activeId: null };
    const parsed = JSON.parse(raw) as StoredState;
    if (!Array.isArray(parsed.threads)) return { threads: [], activeId: null };
    const threads = parsed.threads
      .filter((t) => t && typeof t.id === "string" && Array.isArray(t.messages))
      .slice(0, MAX_THREADS);
    return {
      threads,
      activeId:
        parsed.activeId && threads.some((t) => t.id === parsed.activeId)
          ? parsed.activeId
          : (threads[0]?.id ?? null),
    };
  } catch {
    return { threads: [], activeId: null };
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
    window.localStorage.setItem(ACTIVE_KEY, state.activeId ?? "");
  } catch {
    // quota exceeded / private mode — the session still works in memory
  }
}

/** Trailing-edge throttle: streaming deltas commit often; disk writes wait. */
function emit() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist();
  }, 400);
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === ACTIVE_KEY) {
      state = load();
      for (const l of listeners) l();
    }
  });
}

function notifySnapshot() {
  return { threads: state.threads, activeId: state.activeId };
}

let snap = notifySnapshot();

function commit(next: Partial<StoredState>) {
  state = { ...state, ...next };
  snap = notifySnapshot();
  emit();
}

/** Stable server snapshot — a fresh object per call would loop (React req). */
const EMPTY_SNAPSHOT: StoredState = { threads: [], activeId: null };

export function useThreadsSnapshot(): StoredState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snap,
    () => EMPTY_SNAPSHOT,
  );
}

export function subscribeThreads(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getThreads(): Thread[] {
  return state.threads;
}

export function getActiveThread(): Thread | null {
  return state.threads.find((t) => t.id === state.activeId) ?? null;
}

export function setActiveThread(id: string | null) {
  commit({ activeId: id });
}

export function newThreadId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Title case: first user message, trimmed to a readable label. */
export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "New chat";
  return t.length > 52 ? `${t.slice(0, 52).trimEnd()}…` : t;
}

/** V53 course context for new threads: the /tutor?course=<slug> the chat
 *  was started under (label = the registry's display label). */
export interface ThreadCourseContext {
  slug: string;
  label: string;
}

export function createThread(title = "New chat", course?: ThreadCourseContext | null): Thread {
  const now = Date.now();
  const thread: Thread = {
    id: newThreadId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    ...(course ? { courseSlug: course.slug, courseLabel: course.label } : {}),
  };
  commit({ threads: [thread, ...state.threads].slice(0, MAX_THREADS), activeId: thread.id });
  return thread;
}

/** Ensure there is an active thread (created on first ask, not on page load).
 *  V53: a thread created inside a course-scoped tutor carries that course. */
export function ensureActiveThread(course?: ThreadCourseContext | null): Thread {
  return getActiveThread() ?? createThread("New chat", course);
}

/** Immutably patch one thread; bumps updatedAt and re-orders to the top. */
export function updateThread(id: string, patch: (t: Thread) => Thread) {
  const idx = state.threads.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const updated = patch(state.threads[idx]);
  updated.updatedAt = Date.now();
  const threads = [...state.threads];
  threads.splice(idx, 1);
  commit({ threads: [updated, ...threads] });
}

export function appendMessages(threadId: string, msgs: Turn[]) {
  updateThread(threadId, (t) => ({
    ...t,
    messages: [...t.messages, ...msgs].slice(-MAX_MESSAGES_PER_THREAD),
    title:
      t.messages.length === 0 && msgs[0]?.role === "user" ? titleFrom(msgs[0].content) : t.title,
  }));
}

/** Patch the newest message of a thread (streaming writes land here). */
export function patchLastMessage(threadId: string, patch: (m: Turn) => Turn) {
  updateThread(threadId, (t) => {
    if (t.messages.length === 0) return t;
    const messages = [...t.messages];
    messages[messages.length - 1] = patch(messages[messages.length - 1]);
    return { ...t, messages };
  });
}

export function renameThread(id: string, title: string) {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
  updateThread(id, (t) => ({ ...t, title: clean || t.title }));
}

export function deleteThread(id: string) {
  const threads = state.threads.filter((t) => t.id !== id);
  commit({
    threads,
    activeId: state.activeId === id ? (threads[0]?.id ?? null) : state.activeId,
  });
}

export function clearAllThreads() {
  commit({ threads: [], activeId: null });
}

/** Snapshot a thread before deletion (undo support). */
export function insertThread(thread: Thread, activeId: string | null) {
  const threads = [thread, ...state.threads.filter((t) => t.id !== thread.id)].slice(0, MAX_THREADS);
  commit({ threads, activeId });
}

/** Map stored turns to the wire history format (client-side cap).
 *
 *  The caps mirror core's validation EXACTLY (web s139 parity): 12 turns
 *  (`ConversationTurn.MAX_HISTORY_TURNS`) of 2000 chars each
 *  (`MAX_TURN_CHARS`, the same bound the server's sanitizer enforces —
 *  truncating client-side lets the request pass @Size validation as-is;
 *  the hub's pre-session cap of 16 × 4000 would 400 any long chat). */
export function historyFor(turns: Turn[], cap = 12) {
  return turns
    .filter((m) => m.content.trim().length > 0 && !m.error)
    .slice(-cap)
    .map((m) => ({ role: m.role, content: truncateTurn(m.content) }));
}

/** Core's per-turn validation bound (ConversationTurn.MAX_TURN_CHARS). */
const MAX_TURN_CHARS = 2000;

function truncateTurn(content: string): string {
  return content.length <= MAX_TURN_CHARS
    ? content
    : content.slice(0, MAX_TURN_CHARS - 1) + "…";
}

// ── §22 server-session binding (web s140 parity) ─────────────────────

/** Bind a thread to its §22 server session (first completed create). */
export function bindSession(threadId: string, sessionId: string) {
  updateThread(threadId, (t) => ({ ...t, sessionId }));
}

/** Drop a thread's §22 binding — a foreign/deleted session id 404'd
 *  server-side, so the next ask lazily creates a fresh one (web s140). */
export function unbindSession(threadId: string) {
  updateThread(threadId, (t) => ({ ...t, sessionId: null }));
}

// ── grouping + export helpers ────────────────────────────────────────

export interface ThreadGroup {
  label: string;
  threads: Thread[];
}

export function groupThreads(threads: Thread[]): ThreadGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;
  const startOfMonth = startOfToday - 29 * 86_400_000;
  const buckets: Record<string, Thread[]> = {};
  const order = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
  for (const t of threads) {
    const at = t.updatedAt;
    const label =
      at >= startOfToday
        ? "Today"
        : at >= startOfYesterday
          ? "Yesterday"
          : at >= startOfWeek
            ? "Previous 7 days"
            : at >= startOfMonth
              ? "Previous 30 days"
              : "Older";
    (buckets[label] ??= []).push(t);
  }
  return order
    .filter((l) => buckets[l]?.length)
    .map((l) => ({ label: l, threads: buckets[l] }));
}

export function relativeTime(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const EXPORT_MARKDOWN = "# {title}\n\n_Exported from SyllabAI Tutor · {date}_\n\n";

export function threadToMarkdown(thread: Thread): string {
  const body = thread.messages
    .map((m) => {
      const who = m.role === "user" ? "**You**" : "**SyllabAI Tutor**";
      const at = new Date(m.at).toLocaleString();
      return `### ${who} · ${at}\n\n${m.content}\n`;
    })
    .join("\n---\n\n");
  return (
    EXPORT_MARKDOWN.replace("{title}", thread.title).replace(
      "{date}",
      new Date().toLocaleString(),
    ) + body
  );
}

export function downloadThread(thread: Thread) {
  const blob = new Blob([threadToMarkdown(thread)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `syllabai-tutor-${thread.id}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
