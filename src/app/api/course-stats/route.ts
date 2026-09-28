import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * GET /api/course-stats?slugs=a,b,c
 *
 * Lightweight per-course resource counts for the dashboard subject cards.
 * Reads the committed content bundles directly (defensive, no Zod) and
 * caches results in-process — the bundles are immutable between deploys.
 */
export const dynamic = "force-dynamic";

/**
 * The corpus behind this route is committed and immutable between deploys,
 * so the CDN may cache responses (ADR-021 perf pass, tranche 4.12). Not
 * `immutable` — URLs are not deploy-versioned.
 */
const CONTENT_CACHE = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" };

interface CourseStat {
  slug: string;
  hasBundle: boolean;
  treeKind: string | null;
  topics: number;
  notes: number;
  questionSets: number;
  questions: number;
  flashcards: number;
}

const cache = new Map<string, CourseStat>();

function count(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function questionsInSet(set: unknown): number {
  if (!set || typeof set !== "object") return 0;
  const q = (set as { questions?: unknown }).questions;
  return Array.isArray(q) ? q.length : 0;
}

function statFor(slug: string): CourseStat {
  const cached = cache.get(slug);
  if (cached) return cached;

  const base = join(process.cwd(), "content", slug);
  const stat: CourseStat = {
    slug,
    hasBundle: existsSync(join(base, "manifest.json")),
    treeKind: null,
    topics: 0,
    notes: 0,
    questionSets: 0,
    questions: 0,
    flashcards: 0,
  };

  const safeRead = (file: string): unknown => {
    try {
      return JSON.parse(readFileSync(join(base, file), "utf-8"));
    } catch {
      return null;
    }
  };

  const manifest = safeRead("manifest.json") as { counts?: Record<string, unknown>; treeKind?: string } | null;
  if (manifest?.treeKind) stat.treeKind = manifest.treeKind;

  const curriculum = safeRead("curriculum.json") as { nodes?: Array<{ family?: string }> } | null;
  if (curriculum?.nodes) {
    stat.topics = curriculum.nodes.filter((n) => n?.family === "TOPIC").length;
  }

  const notes = safeRead("notes.json");
  stat.notes = count(notes) || count((notes as { notes?: unknown[] } | null)?.notes);

  const questions = safeRead("questions.json");
  const asArray = Array.isArray(questions) ? questions : (questions as { sets?: unknown[] } | null)?.sets;
  stat.questionSets = count(asArray);
  if (Array.isArray(asArray)) {
    stat.questions = asArray.reduce((a: number, s) => a + questionsInSet(s), 0);
  }

  const flashcards = safeRead("flashcards.json");
  stat.flashcards =
    count(flashcards) || count((flashcards as { flashcards?: unknown[] } | null)?.flashcards);

  cache.set(slug, stat);
  return stat;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slugs = (searchParams.get("slugs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9-]+$/.test(s))
    .slice(0, 45);

  const stats: Record<string, CourseStat> = {};
  for (const slug of slugs) stats[slug] = statFor(slug);

  // Corpus counts are committed + immutable between deploys (ADR-021 perf
  // pass, tranche 4.12): CDN-cacheable with bounded staleness, SWR keeps
  // serving through revalidation onto the next deploy's lambda.
  return NextResponse.json({ stats }, { headers: CONTENT_CACHE });
}
