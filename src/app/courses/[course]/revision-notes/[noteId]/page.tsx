import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CircleHelp, ExternalLink, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { loadHubCourse } from "@/lib/courses";
import { sanitizeNoteBody } from "@/lib/note-body-fix";
import { Markdown } from "@/components/markdown";
import { Breadcrumbs } from "@/components/hub/chrome";
import { ResourcePanel } from "@/components/hub/resource-panel";
import { NoteCla } from "@/components/cla/note-cla";
import { NoteFootnote } from "./note-footnote";

export const dynamic = "force-dynamic";

/**
 * Note reader — SME page anatomy (research §5.3 + flow crawl fig. flow-04):
 * breadcrumb trail, two-tone title, exam-code pill, slim trust meta row
 * (exam board · updated · source) in place of the authorship block, guided-
 * study banner, standardised body, and the build-on-this-topic cross-links +
 * prev/next footer. The resource topic panel (SME's second column) mounts
 * left with the active note highlighted.
 */
export default async function NoteReaderPage({
  params,
}: {
  params: Promise<{ course: string; noteId: string }>;
}) {
  const { course: slug, noteId } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();
  const note = hub.notes.find((n) => n.noteId === noteId);
  if (!note) notFound();

  const { meta } = hub;
  const subtopicCode = hub.noteSubtopic[note.noteId] ?? null;
  const subtopic = subtopicCode ? hub.index.subtopicByCode.get(subtopicCode) : null;
  const topic = subtopic ? hub.index.topicByCode.get(subtopic.topicCode) : null;
  const base = `/courses/${meta.slug}`;

  const index = hub.notes.findIndex((n) => n.noteId === note.noteId);
  const prev = hub.notes[index - 1];
  const next = hub.notes[index + 1];

  // the corpus bodies often repeat the page title as a leading H1 (+ H2) —
  // drop those duplicates so the reader sees one title, like SME (one H1 +
  // content headings). sanitizeNoteBody also removes raw spec-point anchor
  // ids (spcpt_…) from the visible body — id-only chips go entirely, "id ·
  // text" chips keep their readable text — and collapses the duplicated
  // section headings the importer left around anchor chips (Task 19 audit).
  const bodyMd = sanitizeNoteBody(note.bodyMd, note.title);

  return (
    <div className="flex w-full">
      <ResourcePanel variant="notes" />
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <article className="mx-auto max-w-3xl space-y-5">
          <Breadcrumbs
            items={[
              { label: meta.level, href: "/courses" },
              { label: meta.subject, href: base },
              { label: "Revision Notes", href: `${base}/revision-notes` },
              ...(topic ? [{ label: `${topic.number}. ${topic.title}` }] : []),
              { label: note.title },
            ]}
          />

          <header className="space-y-3">
            <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-[28px]">
              {note.title}{" "}
              <span className="text-muted-foreground">
                (Edexcel {meta.level} {meta.subject})
              </span>
            </h1>
            {/* trust meta — the SyllabAI analogue of SME's authorship block */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              <span>
                Exam board <span className="font-medium text-foreground">Pearson Edexcel</span> ·{" "}
                {meta.level}
              </span>
              <span aria-hidden>·</span>
              <span>
                Updated <span className="font-medium text-foreground">{note.updatedAt.slice(0, 10)}</span>
              </span>
              {note.sourceUrl && (
                <a
                  href={note.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
                >
                  Source <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>
          </header>

          {/* contextual help (CLA) — the note-anchored assistant. The guided-
              study banner (SME anatomy) and the floating CLA button both open
              the SAME overlay: asking about THIS note is the CLA's job now;
              the free Tutor stays in the nav for whole-corpus questions */}
          <NoteCla
            course={meta.slug}
            noteId={note.noteId}
            noteTitle={note.title}
            specPointCodes={note.specPointCodes}
            subtopicTitle={subtopic?.title ?? null}
            guidedStudy={note.guidedStudy}
          />

          <Markdown>{bodyMd}</Markdown>

          <NoteFootnote course={meta.slug} noteId={note.noteId} subtopic={subtopicCode} />

          {/* build on this topic (SME cross-links) */}
          <Card>
            <CardContent className="p-4">
              <p className="mb-2 text-sm font-semibold">Build on this topic</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Link
                  href={subtopicCode ? hub.hrefs.questions[subtopicCode] ?? `${base}/exam-questions` : `${base}/exam-questions`}
                  className="group flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors hover:border-primary/40"
                >
                  <FileQuestion className="size-4 text-primary" aria-hidden />
                  <span className="text-[13px] font-medium">
                    Exam Questions
                    {subtopic ? <span className="block text-xs font-normal text-muted-foreground">{subtopic.title}</span> : null}
                  </span>
                  <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
                <Link
                  href={subtopicCode ? hub.hrefs.flashcards[subtopicCode] ?? `${base}/flashcards` : `${base}/flashcards`}
                  className="group flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors hover:border-primary/40"
                >
                  <CircleHelp className="size-4 text-primary" aria-hidden />
                  <span className="text-[13px] font-medium">
                    Flashcards
                    {subtopic ? <span className="block text-xs font-normal text-muted-foreground">{subtopic.title}</span> : null}
                  </span>
                  <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Mobile UX audit (2026-09-28) P1: the two 24-char titles inside
              whitespace-nowrap shrink-0 buttons overflowed the 343px article
              column on phones — the "next note" button ran off-viewport and
              was untappable (probe: nav scrollWidth 402-426px vs 343px). Cap
              each button at 48% + truncate; flex-wrap catches pathological
              cases; the 48% cap is a no-op on desktop where both titles fit. */}
          <nav className="flex flex-wrap items-center justify-between gap-2 border-t pt-4" aria-label="Note pagination">
            {prev ? (
              <Button asChild size="sm" variant="outline" className="max-w-[48%]">
                <Link href={`${base}/revision-notes/${prev.noteId}`}>
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
                <Link href={`${base}/revision-notes/${next.noteId}`}>
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
      </div>
    </div>
  );
}
