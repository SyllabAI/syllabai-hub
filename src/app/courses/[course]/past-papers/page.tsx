import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, FileText, Puzzle, ScrollText } from "lucide-react";
import { loadHubCourse } from "@/lib/courses";
import { collectPastPapers, paperEstTime, type PastPaper } from "@/lib/past-papers";
import {
  corpusPapersForCourse,
  corpusSpecsForCourse,
  corpusIndex,
  doubleAwardScopeNote,
  groupBySession,
  prettyBytes,
  sessionLabel,
  type CorpusPaperEntry,
} from "@/lib/pastpapers-corpus";
import {
  matchReconstructions,
  computeCoverage,
  coverageChipLabel,
  coverageTitle,
  blueprintFor,
  type ReconstructionCoverage,
} from "@/lib/pastpapers-reconstruction";
import { CourseHeader } from "@/components/hub/course-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InteractiveChip } from "@/components/pastpapers/interactive-chip";
import { MockResultsStrip } from "@/components/pastpapers/mock-results-strip";

export const dynamic = "force-dynamic";

/** PDFs stream from raw.githubusercontent.com — warm the connection early. */
function PreconnectCorpus() {
  return (
    <>
      <link rel="preconnect" href="https://raw.githubusercontent.com" crossOrigin="anonymous" />
      <link rel="dns-prefetch" href="https://raw.githubusercontent.com" />
    </>
  );
}

/**
 * Past Papers — the student archive (SME-style), built on the
 * syllabai-pastpapers corpus.
 *
 *   Mode 1 · Papers   — every corpus paper grouped by session (SME layout):
 *                       QP / MS / Split into the mobile-first pdf.js viewer,
 *                       plus timed Mock runs graded against the MS.
 *   Mode 2 · Interactive — where the parsed question corpus attests a paper
 *                       (sourcePaper provenance) the row links into the real
 *                       Exam-Questions player; everything else shows an
 *                       honest "not parsed yet" roadmap chip.
 *
 * Honesty: corpus PDFs are AI-IDENTIFIED (operator ratification pending);
 * the index is derived from the canonical corpus layout. Papers exist here
 * ONLY because the archive holds them.
 */
export default async function PastPapersPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();

  const { meta } = hub;
  const base = `/courses/${meta.slug}`;

  // Mode 1 — the PDF archive
  const papers = corpusPapersForCourse(slug);
  const sessions = groupBySession(papers);
  const specMap = corpusSpecsForCourse(slug);

  // Mode 2 — interactive reconstructions from the parsed question corpus.
  // The corpus attests papers in FIVE different metadata shapes (verified by
  // walking questions.json across courses); matchReconstruction normalises
  // each into (session ids, unit, variant) to match corpus rows.
  const reconstructions = collectPastPapers(hub.questionTopics);
  const { matchKeys, matchedReconKeys, reconForCorpus } = matchReconstructions(
    papers,
    reconstructions,
  );
  // coverage per matched row — official per-question totals (extracted from
  // the corpus QP PDFs at build time) vs what the parsed corpus holds.
  const coverages = new Map<string, ReconstructionCoverage | null>();
  for (const [corpusKey, recon] of reconForCorpus) {
    coverages.set(corpusKey, computeCoverage(recon, blueprintFor(corpusKey)));
  }
  const interactiveCount = matchKeys.size;
  // reconstructions with NO corpus PDF counterpart keep their own archive list
  const unmatchedReconstructions = reconstructions.filter((r) => !matchedReconKeys.has(r.key));
  // of those, the ones whose provenance provably pins a paper OUTSIDE the
  // qualification's assessed set (2-series surfacing decision) get a chip +
  // note instead of an unexplained absence
  const scopeNotes = new Map<string, { label: string; note: string }>();
  for (const r of unmatchedReconstructions) {
    const note = doubleAwardScopeNote(slug, r.date, r.number);
    if (note) scopeNotes.set(r.key, note);
  }

  const specNote =
    specMap == null
      ? "This course has no specification mapped into the archive yet."
      : undefined;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PreconnectCorpus />
      <CourseHeader
        meta={meta}
        title={`Edexcel ${meta.level} ${meta.label} Past Papers`}
        crumb="Past Papers"
        description="Official past papers grouped by session — view the question paper and mark scheme side by side, solve in your notebook, run a timed mock, or play a paper interactively where its questions are already parsed."
      >
        {papers.length > 0 && (
          <Badge variant="secondary" className="font-medium">
            {papers.length} papers · {sessions.length} session{sessions.length === 1 ? "" : "s"}
            {interactiveCount > 0 ? ` · ${interactiveCount} interactive` : ""}
          </Badge>
        )}
      </CourseHeader>

      {papers.length === 0 ? (
        <div className="mt-6 space-y-4">
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-start gap-3 p-6">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ScrollText className="size-4 text-primary" aria-hidden />
                No past papers mapped for this course yet.
              </p>
              <p className="text-sm text-muted-foreground">
                {specNote ??
                  "The syllabai-pastpapers archive doesn't hold this specification yet. You can still practise by topic, or try the assembled practice papers."}
              </p>
              <div className="flex flex-wrap gap-2 text-sm font-semibold text-primary">
                <Link href={`${base}/exam-questions`} className="hover:underline">
                  Browse topic questions →
                </Link>
                <Link href={`${base}/practice-papers`} className="hover:underline">
                  Practice Papers →
                </Link>
              </div>
            </CardContent>
          </Card>
          {unmatchedReconstructions.length > 0 && (
            <ReconstructionArchive base={base} papers={unmatchedReconstructions} notes={scopeNotes} />
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {/* provenance / modes banner */}
          <div className="rounded-xl border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground print:hidden">
            <p>
              <span className="font-semibold text-foreground">Two ways to use a paper:</span> open
              the <span className="font-medium text-foreground">Question Paper</span> and{" "}
              <span className="font-medium text-foreground">Mark Scheme</span> PDFs (side-by-side
              split on desktop, an A/B toggle on mobile) and self-mark, or run a{" "}
              <span className="font-medium text-foreground">Mock</span> — fullscreen QP with the
              official timer, then grade against the MS.
            </p>
            <p className="mt-1">
              Official Pearson Edexcel documents streamed from the{" "}
              <span className="font-mono text-[11px]">syllabai-pastpapers</span> archive
              (AI-IDENTIFIED provenance, operator ratification pending · index generated{" "}
              {corpusIndex.meta.generatedAt.slice(0, 10)}).
            </p>
          </div>

          <MockResultsStrip course={meta.slug} />

          {/* SME-style session sections */}
          {sessions.map(([sessionId, group]) => (
            <section key={sessionId} aria-label={sessionLabel(sessionId)} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {sessionLabel(sessionId)}
              </h2>
              <ul className="overflow-hidden rounded-xl border">
                {group.map((p) => (
                  <li
                    key={p.dir}
                    className="border-b last:border-b-0 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
                      <div className="min-w-0 flex-1 basis-52">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-sm font-semibold">{p.ref}</span>
                          <span className="text-xs text-muted-foreground">{p.title}</span>
                          {p.specBadge && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              {p.specBadge}
                            </Badge>
                          )}
                          {p.variantChip && (
                            <Badge variant="outline" className="text-[10px]">
                              {p.variantChip}
                            </Badge>
                          )}
                          {matchKeys.has(`${p.sessionId}:${p.dir}`) && (
                            <Badge
                              variant="outline"
                              className="gap-1 border-primary/40 text-[10px] text-primary"
                            >
                              <Puzzle className="size-3" aria-hidden />
                              playable
                            </Badge>
                          )}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {p.specTitle}
                          {p.durationMin != null
                            ? ` · ${Math.floor(p.durationMin / 60)}h${p.durationMin % 60 ? ` ${p.durationMin % 60}m` : ""} official`
                            : ""}
                          {p.qpBytes ? ` · QP ${prettyBytes(p.qpBytes)}` : ""}
                          {p.msBytes ? ` · MS ${prettyBytes(p.msBytes)}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.qpBytes ? (
                          <Button asChild size="sm" variant="secondary" className="h-7 text-xs">
                            <Link href={`${base}/past-papers/view/${p.sessionId}/${p.dir}?doc=qp`}>
                              <FileText className="size-3.5" aria-hidden />
                              Question Paper
                            </Link>
                          </Button>
                        ) : (
                          <span
                            className="inline-flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground/50"
                            title="No question paper held for this paper"
                          >
                            Question Paper
                          </span>
                        )}
                        {p.msBytes ? (
                          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                            <Link href={`${base}/past-papers/view/${p.sessionId}/${p.dir}?doc=ms`}>
                              Mark Scheme
                            </Link>
                          </Button>
                        ) : (
                          <span
                            className="inline-flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground/50"
                            title="No mark scheme held for this paper"
                          >
                            Mark Scheme
                          </span>
                        )}
                        {p.qpBytes && p.msBytes && (
                          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                            <Link
                              href={`${base}/past-papers/view/${p.sessionId}/${p.dir}?doc=split`}
                              aria-label={`${p.ref} — split view (question paper and mark scheme)`}
                            >
                              Split
                            </Link>
                          </Button>
                        )}
                        {p.qpBytes && (
                          <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
                            <Link
                              href={`${base}/past-papers/view/${p.sessionId}/${p.dir}?mode=mock`}
                              aria-label={`${p.ref} — start timed mock`}
                            >
                              Mock
                            </Link>
                          </Button>
                        )}
                        <InteractiveChip
                          href={matchKeys.has(`${p.sessionId}:${p.dir}`) ? `${base}/past-papers/${matchKeys.get(`${p.sessionId}:${p.dir}`)}` : null}
                          paperRef={p.ref}
                          interactiveCount={interactiveCount}
                          coverageLabel={coverageChipLabel(coverages.get(`${p.sessionId}:${p.dir}`) ?? null)}
                          coverageTitle={coverages.get(`${p.sessionId}:${p.dir}`)
                            ? coverageTitle(coverages.get(`${p.sessionId}:${p.dir}`)!)
                            : null}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {/* reconstructions with no PDF counterpart keep their honest archive */}
          {unmatchedReconstructions.length > 0 && (
            <ReconstructionArchive base={base} papers={unmatchedReconstructions} notes={scopeNotes} />
          )}
        </div>
      )}
    </div>
  );
}

/** Archive of interactive reconstructions that have no PDF counterpart. */
function ReconstructionArchive({
  base,
  papers,
  notes,
}: {
  base: string;
  papers: PastPaper[];
  notes: Map<string, { label: string; note: string }>;
}) {
  return (
    <section aria-label="Interactive reconstructions" className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Interactive reconstructions
      </h2>
      <p className="text-xs text-muted-foreground">
        Papers the question corpus has parsed (partial reconstructions — the questions we hold, in
        paper order). These predate the PDF archive and stay playable here.
      </p>
      <ul className="overflow-hidden rounded-xl border">
        {papers.map((p, i) => {
          const scope = notes.get(p.key);
          return (
            <li key={p.key} className={i > 0 ? "border-t" : undefined}>
              <Link
                href={`${base}/past-papers/${p.key}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-sm font-semibold">{p.number}</span>
                    {scope && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-muted-foreground"
                        title={scope.note}
                      >
                        {scope.label}
                      </Badge>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {p.date} · {p.questions.length} question{p.questions.length === 1 ? "" : "s"} ·{" "}
                    {p.totalMarks} marks · {paperEstTime(p.totalMarks)}
                  </span>
                  {scope && (
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/80">
                      {scope.note}
                    </span>
                  )}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
