import { notFound } from "next/navigation";
import { loadHubCourse } from "@/lib/courses";
import { collectPastPapers, findPastPaper } from "@/lib/past-papers";
import { corpusRawUrl, findCorpusPaper } from "@/lib/pastpapers-corpus";
import { blueprintFor } from "@/lib/pastpapers-reconstruction";
import { paperRunManifestFor } from "@/lib/paper-run/manifests";
import { ExamRunner } from "@/components/pastpapers/exam-runner/exam-runner";
import { allCourseParams } from "@/lib/static-params";

/** Prerendered at build (same convention as the other Past Papers routes). */
export async function generateStaticParams() {
  return allCourseParams();
}

/**
 * Paper Run (Track A) — an interactive exam run over a corpus paper with a
 * confirmed PaperInteractivityManifest. Practice integrity: local capture,
 * honest labels; core evidence only via the existing attempt-bridge at
 * grading time. No manifest → 404 (the run is earned per paper, never faked).
 */
export default async function PaperRunPage({
  params,
}: {
  params: Promise<{ course: string; session: string; paperDir: string }>;
}) {
  const { course: slug, session, paperDir } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();

  const entry = findCorpusPaper(slug, session, paperDir);
  const corpusKey = `${session}:${paperDir}`;
  const manifest = paperRunManifestFor(corpusKey);
  if (!entry || !manifest) notFound();

  // the parsed-corpus reconstruction (4CH1 pilot) — the core join lane
  const reconPaper = manifest.paper.reconKey
    ? findPastPaper(collectPastPapers(hub.questionTopics), manifest.paper.reconKey)
    : null;

  // coverage vs the official blueprint (design §5.5): full when every
  // blueprint question carries a manifest entry
  const bp = blueprintFor(corpusKey);
  const coverageState: "full" | "partial" = (() => {
    if (!bp) return "partial";
    const held = new Set(manifest.questions.map((q) => Number(q.number)));
    return Object.keys(bp.marks).every((n) => held.has(Number(n))) ? "full" : "partial";
  })();

  return (
    <div className="px-4 py-4 sm:px-6 lg:px-8">
      <ExamRunner
        course={slug}
        corpusKey={corpusKey}
        manifest={manifest}
        qpUrl={entry.qpPath ? corpusRawUrl(entry.qpPath) : ""}
        msUrl={entry.msPath ? corpusRawUrl(entry.msPath) : ""}
        paperTitle={`${entry.ref} — ${sessionLabelOf(session)}`}
        backHref={`/courses/${slug}/past-papers`}
        recon={
          reconPaper
            ? {
                key: reconPaper.key,
                questions: reconPaper.questions,
                questionNumbers: reconPaper.questionNumbers,
              }
            : null
        }
        coverageState={coverageState}
      />
    </div>
  );
}

function sessionLabelOf(id: string): string {
  if (id === "specimen") return "Specimen";
  const m = id.match(/^(\d{4})-(\d{2})$/);
  if (!m) return id;
  const months = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[Number(m[2])] ?? m[2]} ${m[1]}`;
}
