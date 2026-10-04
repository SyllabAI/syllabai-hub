"use client";

/**
 * MessageItem — one conversation row (user or assistant).
 *
 * Assistant rows follow the corpus reading experience: the same Markdown
 * renderer the notes/solutions use (KaTeX math, callouts, tables), numbered
 * citation chips — real in-app deep links where a surface exists (mock-mode
 * urls, core-mode document citations into the F-022 source reader and KG
 * citations into the course graph via the citation bridge), honest read-only
 * badges otherwise, matching the CLA islands — and a quiet action rail (copy,
 * regenerate, feedback). User rows are primary bubbles with an inline
 * edit-resend affordance. Refusals / aborts / transport errors keep their
 * distinct, honest states.
 *
 * Look (HUB-TUTOR-CLA-LOOK, the itutor.study chat-home reference): assistant
 * turns render as gradient-avatar + name rows on the canvas — no bubble box —
 * with citation pills; user turns are muted gray bubbles with date-aware
 * stamps. Presentation only — every state above is untouched.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { normalizeMathDelimiters } from "@/lib/mathNormalize";
import { cn } from "@/lib/utils";
import { CitationPaperLink } from "@/components/citations/citation-paper-link";
import type { Turn } from "./threads";
import {
  Check,
  Copy,
  FileText,
  GraduationCap,
  Pencil,
  RefreshCw,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";

/** The itutor.study reference's message stamp — "9:41 PM" today, otherwise
 *  "Sep 27 · 9:41 PM" (HUB-TUTOR-CLA-LOOK). */
function formatChatTime(at: number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? time
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

const actionBtn =
  "inline-flex min-h-8 items-center gap-1 rounded px-2 py-1.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1.5" aria-hidden>
      {[0, 1, 2].map((d) => (
        <span
          key={d}
          className="size-1.5 animate-bounce motion-reduce:animate-none rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${d * 140 - 420}ms` }}
        />
      ))}
    </span>
  );
}

export function MessageItem({
  message,
  streaming,
  busy,
  canRegenerate,
  copied,
  onCopy,
  onRegenerate,
  onEditResend,
  onFeedback,
}: {
  message: Turn;
  /** this row is the turn currently receiving tokens */
  streaming: boolean;
  busy: boolean;
  canRegenerate: boolean;
  copied: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  onEditResend: (text: string) => void;
  onFeedback: (v: "up" | "down") => void;
}) {
  const isUser = message.role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const waiting = streaming && !message.content && !message.error;

  if (isUser) {
    return (
      <div className="group flex justify-end">
        <div className="flex max-w-[85%] flex-col items-end gap-1">
          {editing ? (
            <div className="w-full min-w-64 space-y-2 rounded-lg border border-primary/40 bg-background p-2.5">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(6, draft.split("\n").length + 1)}
                aria-label="Edit message"
                className="min-h-16 border-0 p-1 text-sm shadow-none focus-visible:ring-0"
              />
              <div className="flex justify-end gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setEditing(false);
                    setDraft(message.content);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 px-2.5 text-xs"
                  disabled={!draft.trim()}
                  onClick={() => {
                    setEditing(false);
                    onEditResend(draft.trim());
                  }}
                >
                  <RefreshCw className="size-3" aria-hidden /> Save &amp; resend
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* the reference's muted gray user bubble (HUB-TUTOR-CLA-LOOK) */}
              <div className="rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm">
                <p className="whitespace-pre-wrap leading-relaxed">{message.content || "…"}</p>
              </div>
              {/* the reference's date-aware stamp — always visible (rides its
                  own row; the copy/edit affordances stay hover-gated) */}
              <div className="flex items-center gap-0.5 pr-0.5">
                <span className="mr-1 text-[10px] tabular-nums text-muted-foreground/70">
                  {formatChatTime(message.at)}
                </span>
                <div className="flex items-center gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100">
                  <button type="button" onClick={onCopy} className={actionBtn} aria-label="Copy message">
                    {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
                  </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(message.content);
                    setEditing(true);
                  }}
                  className={actionBtn}
                  aria-label="Edit and resend"
                  disabled={busy}
                >
                  <Pencil className="size-3" aria-hidden /> Edit
                </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-2.5">
      {/* the reference's gradient identity avatar (HUB-TUTOR-CLA-LOOK) */}
      <div
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
        aria-hidden
      >
        <GraduationCap className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">SyllabAI Tutor</span>
          <span className="text-[10px] tabular-nums text-muted-foreground/70">
            {formatChatTime(message.at)}
          </span>
          {message.refused && (
            <Badge variant="outline" className="h-4 w-fit border-warn/30 px-1.5 text-[9.5px] text-warn">
              grounded refusal
            </Badge>
          )}
          {message.stopped && (
            <Badge variant="outline" className="h-4 w-fit px-1.5 text-[9.5px] text-muted-foreground">
              stopped
            </Badge>
          )}
        </div>

        {/* the answer renders on the canvas — the bubble box is retired
            (the itutor.study reference, HUB-TUTOR-CLA-LOOK) */}
        <div className="space-y-2 text-sm">
          {message.error ? (
            <div className="space-y-2">
              {message.content && <Markdown className="text-sm [&_p]:text-sm">{normalizeMathDelimiters(message.content)}</Markdown>}
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs">
                <TriangleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />
                <span className="min-w-0 flex-1 text-destructive">
                  {message.content
                    ? "The stream was interrupted mid-answer."
                    : "Couldn’t finish this answer — the stream failed."}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 shrink-0 gap-1.5 px-2 text-xs"
                  onClick={onRegenerate}
                  disabled={busy}
                >
                  <RotateCcw className="size-3" aria-hidden /> Retry
                </Button>
              </div>
            </div>
          ) : (
            <>
              {message.content ? (
                <Markdown className="text-sm [&_p]:text-sm">{normalizeMathDelimiters(message.content)}</Markdown>
              ) : waiting ? (
                <TypingDots />
              ) : null}
              {streaming && message.content && (
                <span className="inline-block h-3.5 w-[2px] animate-pulse rounded-full bg-primary align-middle" aria-hidden />
              )}
              {message.content && !streaming && (
                <div className="flex items-center gap-0.5 pt-0.5">
                  <button type="button" onClick={onCopy} className={actionBtn} aria-label="Copy answer">
                    {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  {canRegenerate && (
                    <button
                      type="button"
                      onClick={onRegenerate}
                      className={actionBtn}
                      aria-label="Regenerate answer"
                      disabled={busy}
                    >
                      <RotateCcw className="size-3" aria-hidden /> Regenerate
                    </button>
                  )}
                  <div
                    className={cn(
                      "ml-auto flex items-center gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100",
                      message.feedback && "opacity-100",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onFeedback("up")}
                      className={cn(actionBtn, message.feedback === "up" && "text-success hover:text-success")}
                      aria-label="Good answer"
                      aria-pressed={message.feedback === "up"}
                    >
                      <ThumbsUp className={cn("size-3", message.feedback === "up" && "fill-current")} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => onFeedback("down")}
                      className={cn(actionBtn, message.feedback === "down" && "text-destructive hover:text-destructive")}
                      aria-label="Needs improvement"
                      aria-pressed={message.feedback === "down"}
                    >
                      <ThumbsDown className={cn("size-3", message.feedback === "down" && "fill-current")} aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {message.citations && message.citations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {message.citations.map((c) => {
                // a citation without an in-app surface renders as the CLA
                // islands' read-only badge — never a focusable dead link
                const chip = (
                  <>
                    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      {c.index}
                    </span>
                    <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="max-w-52 truncate font-medium">{c.label}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      · {c.kind.slice(0, 4)}
                    </span>
                  </>
                );
                const chipClass =
                  "flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs";
                return c.url ? (
                  <CitationPaperLink
                    key={c.index}
                    href={c.url}
                    className={`${chipClass} transition-colors hover:border-primary/40`}
                    title={c.label}
                  >
                    {chip}
                  </CitationPaperLink>
                ) : (
                  <span key={c.index} className={chipClass} title={c.label}>
                    {chip}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
