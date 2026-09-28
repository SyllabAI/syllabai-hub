"use client";

/**
 * ThreadSidebar — conversation history rail.
 *
 * The standard chatbot sidebar: a primary "New chat" action, search across
 * titles and message bodies, date-grouped history with per-thread overflow
 * menus (rename inline / delete with undo toast), an identity chip at the
 * rail's foot, and a collapse toggle. On <lg screens it renders inside the
 * parent's Sheet instead of inline.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useIdentity } from "@/lib/identity";
import { cn } from "@/lib/utils";
import type { Thread } from "./threads";
import {
  clearAllThreads,
  deleteThread,
  groupThreads,
  insertThread,
  renameThread,
  relativeTime,
  setActiveThread,
} from "./threads";
import {
  Atom,
  Check,
  LogIn,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

export function ThreadSidebar({
  threads,
  activeId,
  onNewChat,
  onNavigate, // called after a mobile-Sheet selection
}: {
  threads: Thread[];
  activeId: string | null;
  onNewChat: () => void;
  onNavigate?: () => void;
}) {
  const { toast } = useToast();
  const identity = useIdentity();
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? threads.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              t.messages.some((m) => m.content.toLowerCase().includes(q)),
          )
        : threads,
    [threads, q],
  );
  const groups = useMemo(() => groupThreads(filtered), [filtered]);

  const remove = (t: Thread) => {
    deleteThread(t.id);
    toast({
      title: "Conversation deleted",
      description: t.title,
      action: (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            insertThread(t, t.id);
            toast({ title: "Restored", description: t.title });
          }}
        >
          Undo
        </Button>
      ),
    });
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* brand + close (mobile) handled by parent header */}
      <div className="space-y-2.5 p-3">
        <Button onClick={onNewChat} className="w-full justify-start gap-2">
          <Plus className="size-4" aria-hidden /> New chat
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="h-8 border-sidebar-border bg-sidebar-accent/60 pl-8 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <nav aria-label="Conversation history" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {threads.length === 0
              ? "No conversations yet — ask your first question."
              : "Nothing matches that search."}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-2">
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                {g.label}
              </p>
              <ul className="space-y-px">
                {g.threads.map((t) => {
                  const active = t.id === activeId;
                  const last = t.messages[t.messages.length - 1];
                  return (
                    <li key={t.id}>
                      {renamingId === t.id ? (
                        <div className="flex items-center gap-1 rounded-md border border-primary/40 bg-background p-1">
                          <Input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                renameThread(t.id, renameDraft);
                                setRenamingId(null);
                              }
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            aria-label="Conversation title"
                            className="h-7 border-0 text-xs shadow-none focus-visible:ring-0"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 shrink-0"
                            aria-label="Save title"
                            onClick={() => {
                              renameThread(t.id, renameDraft);
                              setRenamingId(null);
                            }}
                          >
                            <Check className="size-3.5" aria-hidden />
                          </Button>
                        </div>
                      ) : (
                        <div
                          className={cn(
                            "group/item relative flex items-center rounded-md transition-colors",
                            active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setActiveThread(t.id);
                              onNavigate?.();
                            }}
                            aria-current={active ? "true" : undefined}
                            className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span
                              className={cn(
                                "w-full truncate text-[13px] leading-tight",
                                active && "font-semibold",
                              )}
                            >
                              {t.title}
                            </span>
                            <span className="flex w-full items-center gap-1.5 text-[10.5px] text-muted-foreground">
                              <MessageSquare className="size-3 shrink-0" aria-hidden />
                              <span className="truncate">
                                {last
                                  ? `${last.role === "user" ? "You: " : ""}${last.content.slice(0, 60) || "…"}`
                                  : "Empty conversation"}
                              </span>
                              <span className="ml-auto shrink-0 tabular-nums">
                                {relativeTime(t.updatedAt)}
                              </span>
                            </span>
                          </button>
                          <DropdownSlot
                            onRename={() => {
                              setRenameDraft(t.title);
                              setRenamingId(t.id);
                            }}
                            onDelete={() => remove(t)}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>

      <Separator className="bg-sidebar-border" />

      {/* identity + data hygiene */}
      <div className="space-y-1.5 p-3">
        {identity ? (
          <div className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
              {identity.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{identity.name}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{identity.email}</span>
            </span>
            <Badge variant="outline" className="shrink-0 text-[9px] capitalize">
              {identity.role}
            </Badge>
          </div>
        ) : (
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="flex size-7 items-center justify-center rounded-full border">
              <LogIn className="size-3.5" aria-hidden />
            </span>
            Sign in to keep your progress
          </Link>
        )}
        {threads.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-destructive"
            onClick={() => {
              clearAllThreads();
              toast({ title: "All conversations cleared" });
            }}
          >
            <Trash2 className="size-3" aria-hidden /> Clear all conversations
          </Button>
        )}
      </div>
    </div>
  );
}

/** Per-row overflow menu (kept as a slot to stay inside the list semantics). */
function DropdownSlot({
  onRename,
  onDelete,
}: {
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative pr-1.5">
      <button
        type="button"
        aria-label="Conversation options"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className={cn(
          "flex size-8 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-background hover:text-foreground",
          open ? "opacity-100" : "opacity-100 lg:opacity-0 lg:group-hover/item:opacity-100 lg:focus-visible:opacity-100",
        )}
      >
        <MoreHorizontal className="size-3.5" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-1.5 top-7 z-20 w-36 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            <Pencil className="size-3" aria-hidden /> Rename
          </button>
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-destructive outline-none hover:bg-destructive/10"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 className="size-3" aria-hidden /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

/** Small brand mark used at the top of the mobile sheet variant. */
export function SidebarBrand() {
  return (
    <span className="flex items-center gap-2 px-3 pt-3 text-sm font-semibold">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Atom className="size-4" aria-hidden />
      </span>
      SyllabAI Tutor
    </span>
  );
}
