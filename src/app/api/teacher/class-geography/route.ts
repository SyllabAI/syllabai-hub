import { NextResponse } from "next/server";

/**
 * GET /api/teacher/class-geography?slugs=a,b,c
 *
 * The class geography: per course, the canonical spec tree
 * (SUBJECT → TOPICS → SUBTOPICS) with per-subtopic corpus coverage counts
 * (notes / questions / flashcards). Composes getCourseBundle +
 * buildSpecTreeIndex + resourceCounts — the SAME spec-tree machinery the
 * revision-notes index uses, so the placement is canonical, never
 * re-derived.
 *
 * HUB-TEACHER-DASH wave 3 (operator trace 1a0f0e078fde5fb1): this is the
 * LOCAL class container's corpus-coverage surface — what teaching material
 * exists per subtopic. It is NOT learner mastery: cohort mastery lives in
 * the core class KG heatmap (+ the T-C37 drill chain, hub PR #4). Zero
 * contract delta: reads the committed content bundles only, no core calls.
 */
export const dynamic = "force-dynamic";

/**
 * The corpus behind this route is committed and immutable between deploys
 * (same policy as /api/course-stats, ADR-021 perf pass tranche 4.12).
 */
const CONTENT_CACHE = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" };

interface GeographySubtopic {
  code: string;
  label: string;
  title: string;
  specPoints: number;
  notes: number;
  questions: number;
  flashcards: number;
}

interface GeographyTopic {
  code: string;
  number: number;
  title: string;
  specPoints: number;
  subtopics: GeographySubtopic[];
}

interface CourseGeography {
  slug: string;
  hasBundle: boolean;
  subjectTitle: string | null;
  specPoints: number;
  topics: GeographyTopic[];
}

const MAX_SLUGS = 12;

const cache = new Map<string, CourseGeography>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("slugs") ?? "";
  const slugs = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9-]{1,80}$/.test(s))
    .slice(0, MAX_SLUGS);

  if (slugs.length === 0) {
    return NextResponse.json({ error: "no valid slugs requested" }, { status: 400 });
  }

  const [{ getCourseBundle }, { buildSpecTreeIndex, resourceCounts }] = await Promise.all([
    import("@/lib/courses"),
    import("@/lib/spec-tree"),
  ]);

  const out: CourseGeography[] = [];
  for (const slug of slugs) {
    const cached = cache.get(slug);
    if (cached) {
      out.push(cached);
      continue;
    }
    const bundle = await getCourseBundle(slug);
    let geo: CourseGeography;
    if (!bundle) {
      // honest-absent: registered-without-bundle or unknown slug
      geo = { slug, hasBundle: false, subjectTitle: null, specPoints: 0, topics: [] };
    } else {
      const index = buildSpecTreeIndex(bundle.curriculum);
      const counts = resourceCounts(bundle.notes, bundle.questionTopics, bundle.flashcards, index);
      geo = {
        slug,
        hasBundle: true,
        subjectTitle: index.tree.subjectTitle,
        specPoints: index.tree.topics.reduce((a, t) => a + t.specPointCount, 0),
        topics: index.tree.topics.map((t) => ({
          code: t.code,
          number: t.number,
          title: t.title,
          specPoints: t.specPointCount,
          subtopics: t.subtopics.map((s) => {
            const c = counts.get(s.code);
            return {
              code: s.code,
              label: s.label,
              title: s.title,
              specPoints: s.specPointCodes.length,
              notes: c?.notes ?? 0,
              questions: c?.questions ?? 0,
              flashcards: c?.flashcards ?? 0,
            };
          }),
        })),
      };
    }
    cache.set(slug, geo);
    out.push(geo);
  }

  return NextResponse.json({ courses: out }, { headers: CONTENT_CACHE });
}
