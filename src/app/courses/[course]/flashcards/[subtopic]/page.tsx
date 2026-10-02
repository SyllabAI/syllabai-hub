import { notFound } from "next/navigation";
import { loadHubCourse } from "@/lib/courses";
import { CourseHeader } from "@/components/hub/course-header";
import { ResourcePanel } from "@/components/hub/resource-panel";
import { DeckPlayer, type DeckCard } from "./deck-player";
import { pilotFlashcardParams } from "@/lib/static-params";


/** Prerendered at build (ADR-021 perf pass, tranche 4.12) — see static-params.ts. */
export async function generateStaticParams() {
  return pilotFlashcardParams();
}
export default async function FlashcardDeckPage({
  params,
}: {
  params: Promise<{ course: string; subtopic: string }>;
}) {
  const { course: slug, subtopic: subtopicParam } = await params;
  // Next 16 hands dynamic segments through percent-encoded, and the corpus's
  // SME-native subtopic codes contain a colon ("ial-biology-T1:SUB_") — the
  // raw encoded value misses subtopicByCode and 404s every non-pilot deck.
  // Decode (tolerantly) before the lookup so both "T1:SUB_" and "T1%3ASUB_" hit.
  let subtopicCode = subtopicParam;
  try {
    subtopicCode = decodeURIComponent(subtopicParam);
  } catch {
    // malformed escape sequence — fall back to the raw segment
  }
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();

  const subtopic = hub.index.subtopicByCode.get(subtopicCode);
  if (!subtopic) notFound();
  const topic = hub.index.topicByCode.get(subtopic.topicCode);
  const cardIds = new Set(hub.cardsBySubtopic[subtopicCode] ?? []);
  const cards: DeckCard[] = hub.flashcards
    .filter((c) => cardIds.has(c.id))
    .map((c) => ({
      id: c.id,
      front: c.front,
      back: c.back,
      sourceNoteId: c.sourceNoteId,
      sourceTitle: c.sourceTitle,
      provenanceTier: c.provenanceTier,
    }));

  const { meta } = hub;

  return (
    <div className="flex w-full">
      <ResourcePanel variant="flashcards" />
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          {/* "(Chemistry)" was redundant with breadcrumb + sidebar and wrapped
              the h1 to two lines at 390px (UX audit P3-16) */}
          <CourseHeader
            meta={meta}
            title={`${subtopic.title}: Flashcards`}
            crumb={subtopic.title}
            description={
              topic
                ? `Deck ${topic.number}.${subtopic.label} — ${cards.length} card${cards.length === 1 ? "" : "s"} for “${subtopic.title}”.`
                : `${cards.length} cards for “${subtopic.title}”.`
            }
          />
          <div className="mt-6">
            <DeckPlayer course={meta.slug} subtopicCode={subtopicCode} cards={cards} />
          </div>
        </div>
      </div>
    </div>
  );
}
