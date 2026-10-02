import { notFound } from "next/navigation";
import { loadHubCourse } from "@/lib/courses";
import {
  corpusIndex,
  findCorpusPaper,
  sessionLabel as sessionLabelOf,
} from "@/lib/pastpapers-corpus";
import { PaperViewerClient } from "@/components/pastpapers/paper-viewer-client";

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
 * One corpus paper — PDF viewer (view / split) and mock-exam runner.
 *
 * ?doc=qp|ms|split picks the initial document (view mode);
 * ?mode=mock starts the mock-exam flow (fullscreen QP + official timer).
 * The paper's identity is resolved strictly from the committed corpus index —
 * no paper exists here that the syllabai-pastpapers repo doesn't hold.
 *
 * Layout discipline (user-reported: the PDF viewport was drowning in chrome —
 * 232px of breadcrumb/h1/toolbar above the panes plus the 256px sidebar):
 * this route renders NO breadcrumb row, NO h1 hero, and NO max-width cap.
 * Identity, exam code and the AI-IDENTIFIED provenance badge live in the
 * viewer's single compact toolbar row; navigation = course sidebar
 * (auto-collapsed to the rail on this route) + the back link. Every spared
 * pixel goes to the PDF panes, which fill the remaining viewport exactly.
 */
export default async function CorpusPaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ course: string; session: string; paperDir: string }>;
  searchParams: Promise<{ doc?: string; mode?: string; page?: string }>;
}) {
  const { course: slug, session, paperDir } = await params;
  const { doc, mode, page } = await searchParams;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();

  const paper = findCorpusPaper(slug, session, paperDir);
  if (!paper) notFound();

  const { meta } = hub;
  const docParam = doc === "ms" || doc === "split" ? doc : "qp";
  const mockMode = mode === "mock";
  // F-022 tranche 2: a citation drill-in lands on the cited page — a missing
  // or malformed param just reads page 1 (the default), never throws
  const parsedPage = Number.parseInt(page ?? "", 10);
  const initialPage = Number.isInteger(parsedPage) && parsedPage > 1 ? parsedPage : undefined;

  return (
    // No bottom padding: the viewer fills to the fold exactly — any bottom
    // padding becomes a pointless page scroll (footer is omitted here too).
    <div className="px-3 pt-3 sm:px-5 lg:px-6 lg:pt-3">
      <PreconnectCorpus />
      {/* NOTE: no ResourcePanel here either — a paper is a linear document;
          the spec-topic tree stole 288px and is exam-questions navigation. */}
      <PaperViewerClient
        course={meta.slug}
        paper={paper}
        sessionLabelStr={sessionLabelOf(session)}
        initialDoc={docParam}
        mode={mockMode ? "mock" : "view"}
        metaGeneratedAt={corpusIndex.meta.generatedAt}
        examCode={meta.code}
        initialPage={initialPage}
        initialPageDoc={docParam === "ms" ? "ms" : "qp"}
      />
    </div>
  );
}
