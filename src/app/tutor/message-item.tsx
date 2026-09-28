"use client";

/**
 * MessageItem — one conversation row (user or assistant).
 *
 * Assistant rows follow the corpus reading experience: the same Markdown
 * renderer the notes/solutions use (KaTeX math, callouts, tables), numbered
 * citation chips with in-app deep links, and a quiet action rail (copy,
 * regenerate, feedback). User rows are primary bubbles with an inline
 * edit-resend affordance. Refusals / aborts / transport errors keep their
 * distinct, honest states.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import type { Turn } from "./threads";
import { clockTime } from "./threads";
import {
  Check,
  Copy,
  Pencil,
  RefreshCw,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";

const actionBtn =
  "inline-flex min-h-8 items-center gap-1 rounded px-2 py-1.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1.5" aria-hidden>
      {[0, 1, 2].map((d) => (
        <span
          key={d}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
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
              <div className="rounded-lg rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                <p className="whitespace-pre-wrap leading-relaxed">{message.content || "…"}</p>
              </div>
              <div className="flex items-center gap-0.5 pr-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100">
                <span className="mr-1 text-[10px] tabular-nums text-muted-foreground/70">
                  {clockTime(message.at)}
                </span>
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
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-2.5">
      <div
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20"
        aria-hidden
      >
        <Sparkles className="size-3.5 text-primary" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">SyllabAI Tutor</span>
          <span className="text-[10px] tabular-nums text-muted-foreground/70">
            {clockTime(message.at)}
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

        <div className="space-y-2 rounded-lg rounded-bl-sm bg-muted/60 px-3.5 py-2.5 text-sm">
          {message.error ? (
            <div className="space-y-2">
              {message.content && <Markdown className="text-sm [&_p]:text-sm">{message.content}</Markdown>}
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
                <Markdown className="text-sm [&_p]:text-sm">{message.content}</Markdown>
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
            <div className="flex flex-wrap gap-1.5 border-t pt-2">
              {message.citations.map((c) => (
                <a
                  key={c.index}
                  href={c.url ?? "#"}
                  className="inline-flex max-w-full items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  title={c.label}
                >
                  <span className="font-mono text-[10.5px]">[{c.index}]</span>
                  <span className="max-w-52 truncate">{c.label}</span>
                  <span className="font-mono text-[10.5px]">{c.kind.slice(0, 4)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
