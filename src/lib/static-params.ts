/**
 * Static-param enumeration for the course hub (ADR-021 perf pass, tranche
 * 4.12). The corpus is committed and immutable between deploys, so course
 * pages are prerenderable. Scope discipline:
 *
 *   - INDEX pages (course-level segment only): EVERY registered course —
 *     cheap (≤49 paths each) and these are the landing pages.
 *   - DETAIL pages (note/topic/flashcard/practice-paper ids): THE PILOT
 *     course only at build — the one course with real learners (4CH1).
 *     The other 48 courses render on demand and (no dynamic APIs in the
 *     tree) enter the full-route cache on first hit; prerendering all
 *     ~15K detail paths was measured out of scope for this tranche (the
 *     per-course spec-tree derivation runs per page render — a full-corpus
 *     prerender is a follow-up with build-time numbers, not a guess).
 *
 * Every helper re-reads the registry/bundle at build time — no hardcoded
 * slugs; if the pilot changes in courses.json these follow.
 */
import "server-only";
import { getCourseBundle, listCourses } from "@/lib/courses";

export interface StaticParam {
  course: string;
  [key: string]: string | undefined;
}

/** Every registered course that has a committed bundle (index pages). */
export async function allCourseParams(): Promise<StaticParam[]> {
  const courses = await listCourses();
  return courses.filter((c) => c.hasBundle).map((c) => ({ course: c.slug }));
}

async function pilotSlug(): Promise<string | null> {
  const courses = await listCourses();
  const pilot = courses.find((c) => c.status === "pilot" && c.hasBundle) ?? courses.find((c) => c.hasBundle);
  return pilot?.slug ?? null;
}

/** The pilot course only (course-level index pages that stay narrow). */
export async function pilotCourseParams(): Promise<StaticParam[]> {
  const slug = await pilotSlug();
  return slug ? [{ course: slug }] : [];
}

/** The pilot's revision notes (note detail pages). */
export async function pilotNoteParams(): Promise<StaticParam[]> {
  const slug = await pilotSlug();
  if (!slug) return [];
  const bundle = await getCourseBundle(slug);
  return (bundle?.notes ?? []).map((n) => ({ course: slug, noteId: n.noteId }));
}

/** The pilot's exam-question topic sets (question player pages). */
export async function pilotTopicSetParams(): Promise<StaticParam[]> {
  const slug = await pilotSlug();
  if (!slug) return [];
  const bundle = await getCourseBundle(slug);
  return (bundle?.questionTopics ?? []).map((t) => ({ course: slug, topicSlug: t.slug }));
}

/** The pilot's flashcard deck pages (one per sub-topic code that has cards). */
export async function pilotFlashcardParams(): Promise<StaticParam[]> {
  const slug = await pilotSlug();
  if (!slug) return [];
  const bundle = await getCourseBundle(slug);
  if (!bundle?.curriculum) return [];
  // deck URLs are spec-tree subtopic codes (flashcards index links
  // d.subtopic.code); enumerate exactly the codes the corpus anchors resolve
  // cards to — the same join the hub serves decks by
  const specTree = await import("@/lib/spec-tree");
  const index = specTree.buildSpecTreeIndex(bundle.curriculum);
  const codes = new Set<string>();
  for (const c of bundle.flashcards) {
    const s = specTree.subtopicOfFlashcard(c, bundle.notes, index);
    if (s) codes.add(s);
  }
  return [...codes].map((s) => ({ course: slug, subtopic: s }));
}

/** The pilot's practice papers (deterministic derivations of the corpus). */
export async function pilotPracticePaperParams(): Promise<StaticParam[]> {
  const slug = await pilotSlug();
  if (!slug) return [];
  const bundle = await getCourseBundle(slug);
  if (!bundle) return [];
  const { buildPracticePapers } = await import("@/lib/practice-papers");
  const papers = buildPracticePapers(slug, bundle.questionTopics);
  return papers.map((p) => ({ course: slug, paperId: p.id }));
}
