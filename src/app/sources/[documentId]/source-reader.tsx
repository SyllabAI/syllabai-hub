"use client";

/**
 * SourceReader — F-022. Renders one citation document from core's learner-
 * readable route: the header (title, kind, page count) plus the requested
 * page's VERBATIM text in reading order. The text renders exactly as the
 * corpus stores it (pre-wrap, no client-side re-flow) — the honesty of a
 * citation drill-in is the text as parsed, not a re-typeset version of it.
 *
 * Honest states: loading; the 404 whose copy must not distinguish unknown-id
 * from non-citable (core makes them byte-identical ON PURPOSE — no state
 * leak); session expiry (handled by the request helper's session event);
 * transport/core errors with a retry.
 */
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RequireAuth } from "@/components/auth/require-auth";
import { ApiError, api } from "@/lib/api";
import type { CitationDocumentView } from "@/lib/types";

const KIND_LABELS: Record<string, string> = {
  QUESTION_PAPER: "Question paper",
  MARK_SCHEME: "Mark scheme",
  SYLLABUS: "Specification",
  TEXTBOOK: "Textbook",
  EXTERNAL_NOTES: "Notes",
  EXTERNAL_QUESTIONS: "Questions",
  OTHER: "Source document",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Source document";
}

type ReaderState =
  | { status: "loading" }
  | { status: "ready"; doc: CitationDocumentView }
  | { status: "error"; message: string; retryable: boolean };

export function SourceReader() {
  return (
    <RequireAuth>
      <SourceReaderInner />
    </RequireAuth>
  );
}

function SourceReaderInner() {
  const params = useParams<{ documentId: string }>();
  const documentId = params.documentId;
  const searchParams = useSearchParams();
  const router = useRouter();

  // the ?page= param IS the reading position (single source of truth — back/
  // forward and refresh stay honest); a missing or malformed param reads
  // page 1, never throws
  const paramPage = Number.parseInt(searchParams.get("page") ?? "", 10);
  const page = Number.isInteger(paramPage) && paramPage >= 1 ? paramPage : 1;

  const [reloadKey, setReloadKey] = useState(0);

  // the fetch result carries the key it was loaded FOR — a stale key renders
  // as loading (no sync setState in the effect; every state write is async)
  const [loaded, setLoaded] = useState<{ key: string; state: ReaderState }>({
    key: "",
    state: { status: "loading" },
  });
  const key = `${documentId}#${page}#${reloadKey}`;
  const state: ReaderState = loaded.key === key ? loaded.state : { status: "loading" };

  useEffect(() => {
    let alive = true;
    api
      .citationDocument(documentId, page)
      .then((doc) => {
        if (alive) setLoaded({ key, state: { status: "ready", doc } });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) {
          // unknown id, non-citable row, out-of-bounds page — core answers
          // all three with the same 404; the copy stays equally unopinionated
          setLoaded({
            key,
            state: {
              status: "error",
              message: "This source or page isn't available — it may not be published yet.",
              retryable: false,
            },
          });
        } else if (e instanceof ApiError) {
          setLoaded({ key, state: { status: "error", message: e.message, retryable: true } });
        } else {
          setLoaded({
            key,
            state: {
              status: "error",
              message: "Couldn't reach the backend — it may be waking up. Try again in a moment.",
              retryable: true,
            },
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [key, documentId, page]);

  const goTo = (n: number) => {
    router.replace(`/sources/${encodeURIComponent(documentId)}?page=${n}`, { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      {state.status === "loading" && (
        <div className="flex min-h-[40vh] items-center justify-center" aria-hidden>
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {state.status === "error" && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <TriangleAlert className="size-5 text-warn" aria-hidden />
          <p className="max-w-sm text-sm text-muted-foreground">{state.message}</p>
          {state.retryable && (
            <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </Button>
          )}
        </div>
      )}

      {state.status === "ready" && (
        <>
          <div className="mb-6 space-y-1.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <FileText className="size-3.5 shrink-0" aria-hidden />
              Source · {kindLabel(state.doc.kind)}
            </p>
            <h1 className="text-lg font-semibold leading-snug">{state.doc.title}</h1>
            <p className="text-xs text-muted-foreground">
              {state.doc.pageCount} {state.doc.pageCount === 1 ? "page" : "pages"} · verbatim parsed text
            </p>
          </div>

          {state.doc.text === null ? (
            <p className="rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              Choose a page to read its text.
            </p>
          ) : (
            <>
              <nav
                className="mb-4 flex items-center justify-between gap-2"
                aria-label="Source pages"
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 px-2.5 text-xs"
                  disabled={page <= 1}
                  onClick={() => goTo(page - 1)}
                >
                  <ChevronLeft className="size-3.5" aria-hidden /> Prev
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  Page {page} of {state.doc.pageCount}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 px-2.5 text-xs"
                  disabled={page >= state.doc.pageCount}
                  onClick={() => goTo(page + 1)}
                >
                  Next <ChevronRight className="size-3.5" aria-hidden />
                </Button>
              </nav>

              <article
                className="whitespace-pre-wrap rounded-lg border bg-background p-4 text-sm leading-relaxed"
                aria-label={`Page ${page} text`}
              >
                {state.doc.text === ""
                  ? "This page has no extractable text."
                  : state.doc.text}
              </article>
            </>
          )}
        </>
      )}
    </div>
  );
}
