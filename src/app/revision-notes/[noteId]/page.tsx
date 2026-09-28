import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDataProvider } from "@/lib/data";
import { Markdown } from "@/components/markdown";
import { SpecChip } from "@/components/provenance";

export const dynamic = "force-dynamic";

export default async function RevisionNotePage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const { noteId } = await params;
  const provider = getDataProvider();
  const notes = await provider.revisionNotes();
  const index = notes.findIndex((n) => n.noteId === noteId);
  if (index === -1) notFound();
  const note = notes[index];
  const prev = notes[index - 1];
  const next = notes[index + 1];

  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild size="sm" variant="ghost">
          <Link href="/revision-notes">
            <ArrowLeft className="size-4" aria-hidden /> All notes
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-1.5">
          {note.specPointCodes.map((c) => (
            <Link key={c} href={`/exam-questions?spec=${encodeURIComponent(c)}`}>
              <SpecChip code={c} />
            </Link>
          ))}
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{note.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono text-[10px]">
            {note.noteId}
          </Badge>
          <span>updated {note.updatedAt.slice(0, 10)}</span>
          {note.sourceUrl && (
            <a
              href={note.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              source <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </p>
      </header>

      <Markdown>{note.bodyMd}</Markdown>

      {/* Mobile UX audit (2026-09-28) P1: same overflow as the course note
          reader — nowrap shrink-0 buttons with 24-char titles clip the
          "next note" button off-viewport on phones. Same 48% cap + truncate. */}
      <nav className="flex flex-wrap items-center justify-between gap-2 border-t pt-4" aria-label="Note pagination">
        {prev ? (
          <Button asChild size="sm" variant="outline" className="max-w-[48%]">
            <Link href={`/revision-notes/${prev.noteId}`}>
              <ArrowLeft className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">
                {prev.title.slice(0, 24)}
                {prev.title.length > 24 ? "…" : ""}
              </span>
            </Link>
          </Button>
        ) : (
          <span />
        )}
        {next ? (
          <Button asChild size="sm" variant="outline" className="max-w-[48%]">
            <Link href={`/revision-notes/${next.noteId}`}>
              <span className="min-w-0 truncate">
                {next.title.slice(0, 24)}
                {next.title.length > 24 ? "…" : ""}
              </span>
              <ArrowRight className="size-4 shrink-0" aria-hidden />
            </Link>
          </Button>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}
