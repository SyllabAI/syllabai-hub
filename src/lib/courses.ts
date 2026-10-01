/**
 * Course registry + per-course bundle loading (server-only).
 *
 * The Learning Hub is per-course by design (SaveMyExams model, research §4):
 * every route lives under /courses/[course]/… and reads this registry. The
 * demo ships exactly one full content bundle (the 4CH1 pilot, imported by
 * scripts/import_content.py); the other registered courses resolve to honest
 * "import pending" states instead of fabricated content.
 *
 * Provider discipline: the pilot bundle is served through the DemoDataProvider
 * seam (mock/neon/core-api) exactly like the pre-hub surfaces. Registered
 * courses without a local bundle never return invented data.
 */
import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { z } from "zod";
import {
  ConceptGraph,
  ContentManifest,
  Curriculum,
  ExamQuestionTopic,
  Flashcard,
  RevisionNote,
  SimLearnerState,
} from "@/lib/contracts";
import type {
  ConceptGraph as ConceptGraphT,
  ContentManifest as ContentManifestT,
  Curriculum as CurriculumT,
  ExamQuestionTopic as ExamQuestionTopicT,
  Flashcard as FlashcardT,
  RevisionNote as RevisionNoteT,
  SimLearnerState as SimLearnerStateT,
} from "@/lib/contracts";
import { getDataProvider } from "@/lib/data";

const CourseRegistry = z.object({
  schema: z.string(),
  note: z.string(),
  courses: z.array(
    z.object({
      slug: z.string(),
      level: z.string(),
      subject: z.string(),
      /** display label incl. course variant ("Maths — Pure 1", "Chemistry (Higher)") */
      label: z.string().optional(),
      code: z.string(),
      status: z.enum(["pilot", "full", "registered"]),
      /** V53 (ADR-030): the core `curriculum_versions.code` the tutor is
       *  scoped by for this course — EXPLICIT hub-maintained data, never
       *  derived (the Edexcel official code `4CH1` and the syllabus-era
       *  code `4CH1-2017` have no derivable rule between them). Absent =
       *  the tutor is not yet available for this course; the /tutor surface
       *  gates honestly instead of falling back to another course's corpus. */
      curriculumCode: z.string().optional(),
    }),
  ),
});

export interface CourseMeta {
  slug: string;
  level: string;
  subject: string;
  label: string;
  code: string;
  status: "pilot" | "full" | "registered";
  /** V53 (ADR-030): hub-maintained bridge to core's curriculum registry —
   *  absent = tutor honestly gated for this course (no cross-corpus fallback). */
  curriculumCode?: string;
  /** true when a validated content bundle is committed under content/<slug>/ */
  hasBundle: boolean;
}

export interface CourseBundle {
  meta: CourseMeta;
  manifest: ContentManifestT;
  curriculum: CurriculumT;
  conceptGraph: ConceptGraphT;
  notes: RevisionNoteT[];
  questionTopics: ExamQuestionTopicT[];
  flashcards: FlashcardT[];
  simLearner: SimLearnerStateT;
}

const CONTENT_DIR = path.join(process.cwd(), "content");

let registryCache: CourseMeta[] | null = null;

export async function listCourses(): Promise<CourseMeta[]> {
  if (registryCache) return registryCache;
  const raw = JSON.parse(await readFile(path.join(CONTENT_DIR, "courses.json"), "utf8"));
  const parsed = CourseRegistry.parse(raw);
  registryCache = parsed.courses.map((c) => ({
    ...c,
    label: c.label ?? c.subject,
    hasBundle: existsSync(path.join(CONTENT_DIR, c.slug, "manifest.json")),
  }));
  return registryCache;
}

export async function getCourseMeta(slug: string): Promise<CourseMeta | null> {
  const all = await listCourses();
  return all.find((c) => c.slug === slug) ?? null;
}

/** The one slug with a committed official-tree bundle (the 4CH1 pilot). */
export async function pilotCourseSlug(): Promise<string | null> {
  const all = await listCourses();
  return all.find((c) => c.status === "pilot" && c.hasBundle)?.slug ?? null;
}

/**
 * Load a course bundle. Pilot course → validates every file with the demo
 * contracts. Registered course without a bundle → null (caller renders the
 * honest "import pending" state). Never returns partially-invented content.
 */
const bundleCache = new Map<string, CourseBundle | null>();

export async function getCourseBundle(slug: string): Promise<CourseBundle | null> {
  if (bundleCache.has(slug)) return bundleCache.get(slug)!;
  const meta = await getCourseMeta(slug);
  if (!meta || !meta.hasBundle) {
    bundleCache.set(slug, null);
    return null;
  }

  const dir = path.join(CONTENT_DIR, slug);
  const read = (f: string) => readFile(path.join(dir, f), "utf8").then(JSON.parse);

  const [manifest, curriculum, conceptGraph, notes, questions, flashcards, learner] =
    await Promise.all([
      read("manifest.json"),
      read("curriculum.json"),
      read("concept-graph.json"),
      read("notes.json"),
      read("questions.json"),
      read("flashcards.json"),
      read("learner-sim.json"),
    ]);

  const result = {
    meta,
    manifest: ContentManifest.parse(manifest) as ContentManifestT,
    curriculum: Curriculum.parse(curriculum) as CurriculumT,
    conceptGraph: ConceptGraph.parse(conceptGraph) as ConceptGraphT,
    notes: z.array(RevisionNote).parse(notes) as RevisionNoteT[],
    questionTopics: z.array(ExamQuestionTopic).parse(questions) as ExamQuestionTopicT[],
    flashcards: z.array(Flashcard).parse(flashcards) as FlashcardT[],
    simLearner: SimLearnerState.parse(learner) as SimLearnerStateT,
  };
  bundleCache.set(slug, result);
  return result;
}

export function coursePath(meta: CourseMeta, rest = ""): string {
  return `/courses/${meta.slug}${rest}`;
}

// ── hub-level aggregation (sidebar data + derived indexes) ─────────────

export interface HubCourse {
  meta: CourseMeta;
  /** true when the corpus came through the DemoDataProvider seam (ladder modes) */
  viaProvider: boolean;
  /** which navigation tree powers this hub: "official" (parsed Pearson spec) or "sme-native" (corpus tree) */
  treeKind: string;
  index: ReturnType<typeof import("@/lib/spec-tree").buildSpecTreeIndex>;
  counts: Record<string, { notes: number; questions: number; flashcards: number }>;
  hrefs: {
    notes: Record<string, string>;
    questions: Record<string, string>;
    flashcards: Record<string, string>;
  };
  noteSubtopic: Record<string, string | null>;
  /** sub-topic code → question-set slugs anchored there */
  setsBySubtopic: Record<string, string[]>;
  /** sub-topic code → the notes anchored there, corpus order (tree expander) */
  notesBySubtopic: Record<string, { noteId: string; title: string; guidedStudy: boolean }[]>;
  /** sub-topic code → the question sets anchored there, corpus order (tree expander) */
  setListsBySubtopic: Record<string, { slug: string; title: string; count: number }[]>;
  /** sub-topic code → flashcards */
  cardsBySubtopic: Record<string, string[]>;
  notes: RevisionNoteT[];
  questionTopics: ExamQuestionTopicT[];
  flashcards: FlashcardT[];
  stats: { notes: number; questions: number; questionSets: number; flashcards: number; specPoints: number };
}

/**
 * Everything a Learning Hub surface needs for one course, derived once:
 * the canonical spec tree, per-sub-topic resource counts, and canonical
 * hrefs (sidebar rows deep-link to the right resource). Resolves content
 * through the DemoDataProvider seam for the pilot (ladder: mock → neon →
 * core-api), and through committed bundles for any future course.
 *
 * Request-deduped with React cache(): the course layout AND each page both
 * call this per render — without the dedupe the page re-reads the whole
 * bundle after the layout already did, doubling TTFB and (critically)
 * delaying the page's notFound() until after the shell has flushed, which
 * turned unknown slugs into soft-404s (200 + not-found UI, s133).
 */
export const loadHubCourse = cache(
  async function loadHubCourse(slug: string): Promise<HubCourse | null> {
  const { buildSpecTreeIndex, resourceCounts, subtopicOfNote, subtopicOfQuestionSet, subtopicOfFlashcard } =
    await import("@/lib/spec-tree");

  const meta = await getCourseMeta(slug);
  if (!meta) return null;

  const bundle = await getCourseBundle(slug);
  const pilot = await pilotCourseSlug();
  let notes, questionTopics, flashcards, curriculum, viaProvider = false;

  if (bundle) {
    ({ notes, questionTopics, flashcards, curriculum } = bundle);
  } else if (slug === pilot) {
    // pilot without a committed bundle → provider seam (neon / core-api ladder);
    // the demo provider corpus rides the official 4CH1 tree
    const provider = getDataProvider();
    [notes, questionTopics, flashcards, curriculum] = await Promise.all([
      provider.revisionNotes(),
      provider.examQuestionTopics(),
      provider.flashcards(),
      provider.curriculum(),
    ]);
    viaProvider = true;
  } else {
    // registered course, no bundle yet — honest empty hub
    return {
      meta,
      viaProvider: false,
      treeKind: "sme-native",
      index: emptyIndex(slug, meta.subject),
      counts: {},
      hrefs: { notes: {}, questions: {}, flashcards: {} },
      noteSubtopic: {},
      setsBySubtopic: {},
      notesBySubtopic: {},
      setListsBySubtopic: {},
      cardsBySubtopic: {},
      notes: [],
      questionTopics: [],
      flashcards: [],
      stats: { notes: 0, questions: 0, questionSets: 0, flashcards: 0, specPoints: 0 },
    };
  }

  const index = buildSpecTreeIndex(curriculum);
  const countsMap = resourceCounts(notes, questionTopics, flashcards, index);
  const counts: HubCourse["counts"] = {};
  for (const [code, v] of countsMap) counts[code] = v;

  const base = `/courses/${slug}`;
  const hrefs: HubCourse["hrefs"] = { notes: {}, questions: {}, flashcards: {} };
  const setsBySubtopic: Record<string, string[]> = {};
  const notesBySubtopic: HubCourse["notesBySubtopic"] = {};
  const setListsBySubtopic: HubCourse["setListsBySubtopic"] = {};
  const cardsBySubtopic: Record<string, string[]> = {};
  const noteSubtopic: Record<string, string | null> = {};

  for (const t of questionTopics) {
    const s = subtopicOfQuestionSet(t, index);
    if (s) {
      // first-write wins: the row's default target is the first set in corpus
      // order (e.g. Multiple-Choice before Structured); the tree expander
      // lists every set anchored to the sub-topic
      hrefs.questions[s] ??= `${base}/exam-questions/${t.slug}`;
      (setsBySubtopic[s] ??= []).push(t.slug);
      (setListsBySubtopic[s] ??= []).push({
        slug: t.slug,
        title: t.setName ?? t.name,
        count: t.questions.length,
      });
    }
  }
  for (const n of notes) {
    const s = subtopicOfNote(n, index);
    noteSubtopic[n.noteId] = s;
    if (s) {
      // first-write wins (corpus order = curated section order); the tree
      // expander lists every note so none is unreachable from navigation
      hrefs.notes[s] ??= `${base}/revision-notes/${n.noteId}`;
      (notesBySubtopic[s] ??= []).push({ noteId: n.noteId, title: n.title, guidedStudy: n.guidedStudy });
      (cardsBySubtopic[s] ??= []);
    }
  }
  for (const f of flashcards) {
    const s = subtopicOfFlashcard(f, notes, index);
    if (s) {
      (cardsBySubtopic[s] ??= []).push(f.id);
      if (!hrefs.flashcards[s]) hrefs.flashcards[s] = `${base}/flashcards/${s}`;
    }
  }

  return {
    meta,
    viaProvider,
    treeKind: viaProvider ? "official" : ((bundle as NonNullable<typeof bundle>).manifest.treeKind ?? "sme-native"),
    index,
    counts,
    hrefs,
    noteSubtopic,
    setsBySubtopic,
    notesBySubtopic,
    setListsBySubtopic,
    cardsBySubtopic,
    notes,
    questionTopics,
    flashcards,
    stats: {
      notes: notes.length,
      questions: questionTopics.reduce((a, t) => a + t.questions.length, 0),
      questionSets: questionTopics.length,
      flashcards: flashcards.length,
      specPoints: index.tree.topics.reduce((a, t) => a + t.specPointCount, 0),
    },
  };
  },
);

function emptyIndex(code: string, subject: string) {
  // structural placeholder for courses without a parsed specification yet
  return {
    tree: { subjectCode: code, subjectTitle: subject, topics: [] },
    subtopicOfSpecPoint: new Map<string, string>(),
    topicOfSubtopic: new Map<string, string>(),
    subtopicByCode: new Map(),
    topicByCode: new Map(),
  };
}
