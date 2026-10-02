"use client";

/**
 * CitationPaperLink — the citation chip as an in-place popup (F-022).
 *
 * The exam-questions surface answers "show me the related notes" without a
 * navigation (QuestionHelpPanel); citation chips now do the same for the
 * real paper. Clicking a /sources chip opens THIS dialog, which runs the
 * same pipeline the /sources reader runs: core's citation header (the
 * learner's Bearer token rides the client fetch — an <a> navigation could
 * never carry it) → the paper-link matcher (server-side, the committed
 * corpus index) → the corpus PDF rendered by the SAME PdfPane the
 * past-papers viewer uses, deep-linked to the cited page. The tutor
 * conversation stays mounted behind the popup.
 *
 * The never-dead-end matrix (fail-closed everywhere):
 *  - complete paper identity + unique corpus match + that role's document
 *    held → the real PDF, plus a "Parsed text" toggle (the honesty view)
 *  - a cited revision note (fileName "sme-note-{noteId}.txt" per the corpus
 *    convention, course hint present) → the full note body joined out of the
 *    hub's committed bundle, markdown-rendered, with a "Parsed text" toggle
 *    and an "Open the full note" escape — any join miss falls to parsed text
 *  - everything else (no paper, incomplete identity, matcher no-match, the
 *    role's document missing, core errors) → the verbatim parsed text in
 *    the same dialog — exactly what the tutor's evidence was served from —
 *    plus "Full viewer" (when matched) and "Full reader" escape links
 *  - hrefs that are not /sources deep links (KG chips) render as plain
 *    links and never touch this machinery; modified/middle clicks keep
 *    the browser's own semantics (open-in-tab still works)
 */
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { BookOpen, ExternalLink, Loader2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { corpusRawUrl } from "@/lib/pastpapers-shared";
import { ApiError, api } from "@/lib/api";
import type { CitationDocumentView } from "@/lib/types";
import { KIND_LABELS } from "@/app/sources/[documentId]/source-reader";
import { Markdown } from "@/components/markdown";

// pdf.js is a ~400KB chunk — loaded ONLY when a popup first renders the
// pane, never on the tutor/notes/questions pages that host the chips
const PdfPane = dynamic(
  () => import("@/components/pastpapers/pdf-pane").then((m) => m.PdfPane),
  { ssr: false },
);

/** the wire shape of /api/sources/paper-link's `match` (lib/paper-link is
 *  server-only — the client gets the resolved fields, nothing else) */
interface PaperLinkMatchDto {
  href: string;
  pdfPath: string | null;
  ref: string;
  title: string | null;
}

interface ParsedSourcesHref {
  documentId: string;
  page: number;
  course: string | null;
}

function parseSourcesHref(href: string): ParsedSourcesHref | null {
  const [path, query = ""] = href.split("?");
  const m = /^\/sources\/([^/?#]+)$/.exec(path ?? "");
  if (!m?.[1]) return null;
  const q = new URLSearchParams(query);
  const n = Number.parseInt(q.get("page") ?? "", 10);
  return {
    documentId: decodeURIComponent(m[1]),
    page: Number.isInteger(n) && n >= 1 ? n : 1,
    course: q.get("course"),
  };
}

/**
 * The corpus files a revision note's content document as
 * "sme-note-{noteId}.txt" (core ClaService convention) and the citation view
 * serves that fileName as the document title — the id-anchored join key from
 * a cited content row back to the hub's committed note bundle (the hub owns
 * note identity, "rn_*", kept opaque core-side).
 */
const NOTE_FILE = /^sme-note-(.+)\.txt$/;

function noteIdOf(title: string): string | null {
  const m = NOTE_FILE.exec(title);
  return m?.[1] ?? null;
}

type DialogData =
  | {
      kind: "paper";
      doc: CitationDocumentView;
      viewerHref: string;
      pdfPath: string;
      ref: string;
      title: string | null;
      role: "QP" | "MS";
    }
  | {
      kind: "text";
      doc: CitationDocumentView;
      fullReaderHref: string;
      viewerHref: string | null;
    }
  | {
      kind: "note";
      doc: CitationDocumentView;
      noteTitle: string;
      bodyMd: string;
      noteHref: string;
      fullReaderHref: string;
    }
  | { kind: "unavailable"; message: string; fullReaderHref: string };

type DialogState =
  | { status: "loading" }
  | { status: "ready"; data: DialogData }
  | { status: "error"; message: string };

const ROLE_LABELS: Record<"QP" | "MS", string> = {
  QP: "Question paper",
  MS: "Mark scheme",
};

export function CitationPaperLink({
  href,
  className,
  title,
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const parsed = useMemo(() => parseSourcesHref(href), [href]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"pdf" | "text" | "note">("pdf");
  const [reloadKey, setReloadKey] = useState(0);

  // the keyed-result pattern (same as the /sources reader): the fetch result
  // carries the key it was loaded FOR — a stale key renders as loading, and
  // every state write happens in an async continuation, never synchronously
  // in the effect body (react-hooks/set-state-in-effect)
  const key = open && parsed ? `${href}#${reloadKey}` : "";
  const [loaded, setLoaded] = useState<{ key: string; state: DialogState }>({
    key: "",
    state: { status: "loading" },
  });
  const state: DialogState = loaded.key === key && key ? loaded.state : { status: "loading" };

  useEffect(() => {
    if (!key || !parsed) return;
    let alive = true;
    const { documentId, page, course } = parsed;
    const fullReaderHref = `/sources/${encodeURIComponent(documentId)}?${new URLSearchParams({ page: String(page), text: "1" }).toString()}`;
    api
      .citationDocument(documentId, page)
      .then(async (doc) => {
        if (!alive) return;
        const paper = doc.paper;
        // the parser honestly emits papers whose printed code/session the
        // OCR lost (null) — no match is possible, so no resolver call either
        if (!paper?.paperCode || !paper.sessionLabel) {
          // revision notes: a note citation's real artifact is the markdown
          // body, not a PDF and not the chunked page text. The id-anchored
          // fileName joins the cited row back to the hub bundle; any miss
          // (no course hint, bundle drift, fetch error) falls through to the
          // parsed text — the honesty view stays the floor.
          const noteId = noteIdOf(doc.title);
          if (noteId && course) {
            try {
              const r = await fetch(
                `/api/notes/${encodeURIComponent(course)}/${encodeURIComponent(noteId)}`,
              );
              if (r.ok) {
                const n = (await r.json()) as {
                  title?: string;
                  bodyMd?: string;
                  url?: string;
                };
                if (typeof n.bodyMd === "string" && n.bodyMd.trim().length > 0) {
                  if (!alive) return;
                  setLoaded({
                    key,
                    state: {
                      status: "ready",
                      data: {
                        kind: "note",
                        doc,
                        noteTitle: n.title?.trim() ? n.title : doc.title,
                        bodyMd: n.bodyMd,
                        noteHref: n.url ?? `/courses/${course}/revision-notes/${noteId}`,
                        fullReaderHref,
                      },
                    },
                  });
                  setMode("note");
                  return;
                }
              }
            } catch {
              /* bundle unreachable — parsed text remains the truth */
            }
          }
          if (!alive) return;
          setLoaded({
            key,
            state: {
              status: "ready",
              data: { kind: "text", doc, fullReaderHref, viewerHref: null },
            },
          });
          return;
        }
        const rq = new URLSearchParams({
          paperCode: paper.paperCode,
          sessionLabel: paper.sessionLabel,
          role: paper.role,
          page: String(page),
        });
        if (course) rq.set("course", course);
        let match: PaperLinkMatchDto | null = null;
        try {
          const r = await fetch(`/api/sources/paper-link?${rq.toString()}`);
          if (r.ok) {
            const d = (await r.json()) as { match?: PaperLinkMatchDto | null };
            match = d.match ?? null;
          }
        } catch {
          /* resolver unreachable — the parsed text remains the truth */
        }
        if (!alive) return;
        if (match?.pdfPath) {
          setLoaded({
            key,
            state: {
              status: "ready",
              data: {
                kind: "paper",
                doc,
                viewerHref: match.href,
                pdfPath: match.pdfPath,
                ref: match.ref,
                title: match.title,
                role: paper.role,
              },
            },
          });
        } else {
          setLoaded({
            key,
            state: {
              status: "ready",
              data: { kind: "text", doc, fullReaderHref, viewerHref: match?.href ?? null },
            },
          });
        }
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) {
          // unknown id, non-citable row, out-of-bounds page — core answers
          // all three with the same 404; the copy stays equally unopinionated
          setLoaded({
            key,
            state: {
              status: "ready",
              data: {
                kind: "unavailable",
                message: "This source or page isn't available — it may not be published yet.",
                fullReaderHref,
              },
            },
          });
        } else {
          setLoaded({
            key,
            state: {
              status: "error",
              message:
                e instanceof ApiError
                  ? e.message
                  : "Couldn't reach the backend — it may be waking up. Try again in a moment.",
            },
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [key, parsed]);

  const close = () => {
    setOpen(false);
    setMode("pdf");
    setLoaded({ key: "", state: { status: "loading" } });
  };

  const rawUrl =
    state.status === "ready" && state.data.kind === "paper"
      ? corpusRawUrl(state.data.pdfPath)
      : null;

  return (
    <>
      <a
        href={href}
        className={className}
        title={title}
        onClick={(e) => {
          if (!parsed) return; // KG chips navigate normally
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </a>

      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent
          aria-describedby={undefined}
          className="flex h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        >
          {state.status === "loading" && (
            <div
              className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3"
              role="status"
            >
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">Opening the real paper…</p>
            </div>
          )}

          {state.status === "error" && (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
              <TriangleAlert className="size-5 text-warn" aria-hidden />
              <p className="max-w-sm text-sm text-muted-foreground">{state.message}</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                  Try again
                </Button>
                {parsed && (
                  <Button asChild size="sm" variant="ghost">
                    <a href={`/sources/${encodeURIComponent(parsed.documentId)}?page=${parsed.page}&text=1`}>
                      <BookOpen className="size-3.5" aria-hidden />
                      Full reader
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}

          {state.status === "ready" && state.data.kind === "unavailable" && (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
              <TriangleAlert className="size-5 text-warn" aria-hidden />
              <p className="max-w-sm text-sm text-muted-foreground">{state.data.message}</p>
              <Button asChild size="sm" variant="ghost">
                <a href={state.data.fullReaderHref}>
                  <BookOpen className="size-3.5" aria-hidden />
                  Full reader
                </a>
              </Button>
            </div>
          )}

          {state.status === "ready" && state.data.kind === "text" && (
            <>
              <DialogHeader className="flex-row items-center gap-2 space-y-0 border-b px-4 py-3 pr-12 text-left">
                <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {KIND_LABELS[state.data.doc.kind] ?? "Source document"}
                  </Badge>
                  <span className="min-w-0 truncate">{state.data.doc.title}</span>
                </DialogTitle>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {state.data.viewerHref && (
                    <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                      <a href={state.data.viewerHref} title="Open the full past-paper viewer">
                        Full viewer
                      </a>
                    </Button>
                  )}
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                    <a href={state.data.fullReaderHref} title="Open the full source reader">
                      Full reader
                    </a>
                  </Button>
                </div>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  Page {parsed?.page ?? 1} of {state.data.doc.pageCount} · verbatim parsed text —
                  the same text the tutor&apos;s evidence was served from
                </p>
                <article className="whitespace-pre-wrap text-sm leading-relaxed">
                  {state.data.doc.text === ""
                    ? "This page has no extractable text."
                    : state.data.doc.text}
                </article>
              </div>
            </>
          )}

          {state.status === "ready" && state.data.kind === "note" && (
            <>
              <DialogHeader className="flex-row items-center gap-2 space-y-0 border-b px-4 py-3 pr-12 text-left">
                <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {KIND_LABELS[state.data.doc.kind] ?? "Source document"}
                  </Badge>
                  <span className="min-w-0 truncate">{state.data.noteTitle}</span>
                </DialogTitle>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setMode(mode === "note" ? "text" : "note")}
                  >
                    {mode === "note" ? "Parsed text" : "Back to note"}
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                    <a href={state.data.fullReaderHref} title="Open the full source reader">
                      Full reader
                    </a>
                  </Button>
                </div>
              </DialogHeader>
              {mode === "note" ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Cited at page {parsed?.page ?? 1} of {state.data.doc.pageCount} · the full
                    note — the source material the tutor&apos;s evidence was drawn from
                  </p>
                  <Markdown className="text-sm [&_p]:text-sm">{state.data.bodyMd}</Markdown>
                  <a
                    href={state.data.noteHref}
                    className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground underline hover:text-foreground"
                  >
                    Open the full note <ExternalLink className="size-3" aria-hidden />
                  </a>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Page {parsed?.page ?? 1} of {state.data.doc.pageCount} · verbatim parsed text —
                    the same text the tutor&apos;s evidence was served from
                  </p>
                  <article className="whitespace-pre-wrap text-sm leading-relaxed">
                    {state.data.doc.text === ""
                      ? "This page has no extractable text."
                      : state.data.doc.text}
                  </article>
                </div>
              )}
            </>
          )}

          {state.status === "ready" && state.data.kind === "paper" && (
            <>
              <DialogHeader className="flex-row items-center gap-2 space-y-0 border-b px-4 py-3 pr-12 text-left">
                <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {ROLE_LABELS[state.data.role]}
                  </Badge>
                  <span className="font-mono font-semibold">{state.data.ref}</span>
                  {state.data.title && (
                    <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
                      {state.data.title}
                    </span>
                  )}
                </DialogTitle>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setMode(mode === "pdf" ? "text" : "pdf")}
                  >
                    {mode === "pdf" ? "Parsed text" : "Back to PDF"}
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                    <a href={state.data.viewerHref} title="Open the full past-paper viewer">
                      Full viewer
                    </a>
                  </Button>
                </div>
              </DialogHeader>
              {mode === "pdf" && rawUrl ? (
                <PdfPane
                  url={rawUrl}
                  downloadUrl={rawUrl}
                  label={`${ROLE_LABELS[state.data.role]} — ${state.data.ref}`}
                  active
                  initialPage={parsed?.page}
                  className="min-h-0 flex-1 rounded-none border-0"
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Page {parsed?.page ?? 1} of {state.data.doc.pageCount} · verbatim parsed text —
                    the same text the tutor&apos;s evidence was served from
                  </p>
                  <article className="whitespace-pre-wrap text-sm leading-relaxed">
                    {state.data.doc.text === ""
                      ? "This page has no extractable text."
                      : state.data.doc.text}
                  </article>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
