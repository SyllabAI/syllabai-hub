/**
 * verify_flashcard_sync_courses — the prebuild gate for the flashcard
 * core-sync eligibility manifest (T-C66). Re-derives the eligible course
 * set from content/ (the four conditions documented in
 * src/lib/flashcard-sync-eligibility.ts) and fails the build on ANY drift
 * from the committed manifest.
 *
 * Why fail-closed: the manifest gates which courses' ratings sync to the
 * learner's core account. A registry change that silently disagreed with
 * the manifest would either under-sync (a commissioned course stuck on
 * device-only) or over-sync (ratings 404ing against anchors core cannot
 * resolve, or — worse — a bare-code course attributing into another
 * course's node). The build stops instead; the message prints exactly
 * what the regenerated manifest must say.
 *
 * Run: bun scripts/verify_flashcard_sync_courses.ts   (prebuild-wired)
 * Exits non-zero on drift; prints the derived set on success.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CONTENT_DIR = path.join(process.cwd(), "content");
/** core's FlashcardRatingRequest anchor pattern (syllabai-core V47). */
const CORE_ANCHOR_PATTERN = /^[A-Za-z0-9-]+$/;

interface RegistryCourse {
  slug: string;
  status: string;
  curriculumCode?: string;
}

/** curriculumCode → the anchor board code ("4CH1-2017" → "4CH1"). */
function boardCodeOf(curriculumCode: string): string {
  return curriculumCode.replace(/-\d{4}$/, "");
}

/** Every TOPIC/SUBTOPIC-family code in the bundle (the anchor candidates
 *  the spec tree can ever place a deck under). */
function anchorCodes(curriculum: unknown): string[] {
  const codes: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(walk);
    } else if (n && typeof n === "object") {
      const node = n as Record<string, unknown>;
      if (
        typeof node.code === "string" &&
        (node.family === "TOPIC" || node.family === "SUBTOPIC")
      ) {
        codes.push(node.code);
      }
      Object.values(node).forEach(walk);
    }
  };
  walk(curriculum);
  return codes;
}

function deriveEligible(): { eligible: string[]; notes: string[] } {
  const registry: { courses: RegistryCourse[] } = JSON.parse(
    readFileSync(path.join(CONTENT_DIR, "courses.json"), "utf8"),
  );
  const eligible: string[] = [];
  const notes: string[] = [];
  for (const course of registry.courses) {
    const deckPath = path.join(CONTENT_DIR, course.slug, "flashcards.json");
    if (!existsSync(deckPath)) {
      notes.push(`  · ${course.slug}: no flashcards.json — not deck-bearing`);
      continue;
    }
    const cards = JSON.parse(readFileSync(deckPath, "utf8")) as unknown[];
    if (cards.length === 0) {
      notes.push(`  · ${course.slug}: empty deck — not deck-bearing`);
      continue;
    }
    if (!course.curriculumCode) {
      notes.push(
        `  · ${course.slug}: deck-bearing but no curriculumCode — core cannot anchor it yet`,
      );
      continue;
    }
    const codes = anchorCodes(
      JSON.parse(
        readFileSync(path.join(CONTENT_DIR, course.slug, "curriculum.json"), "utf8"),
      ),
    );
    if (codes.length === 0) {
      notes.push(
        `  · ${course.slug}: no TOPIC/SUBTOPIC anchors in the bundle — ratings could not resolve`,
      );
      continue;
    }
    const prefix = boardCodeOf(course.curriculumCode) + "-";
    const unsafe = codes.filter((c) => !CORE_ANCHOR_PATTERN.test(c) || !c.startsWith(prefix));
    if (unsafe.length > 0) {
      notes.push(
        `  · ${course.slug}: ${unsafe.length}/${codes.length} anchors not core-safe` +
          ` (charset or not ${prefix}*-prefixed), e.g. ${unsafe.slice(0, 3).join(", ")}`,
      );
      continue;
    }
    eligible.push(course.slug);
  }
  return { eligible, notes };
}

const committed: string[] = (
  await import("../src/lib/flashcard-sync-eligibility")
).FLASHCARD_SYNC_COURSES.slice();

const { eligible, notes } = deriveEligible();
const expected = [...eligible].sort();
const actual = [...committed].sort();

if (JSON.stringify(expected) !== JSON.stringify(actual)) {
  console.error(
    `FAIL  flashcard core-sync manifest drifted from the registry\n` +
      `  committed: [${actual.join(", ")}]\n` +
      `  derived:   [${expected.join(", ")}]\n` +
      `  Update FLASHCARD_SYNC_COURSES in src/lib/flashcard-sync-eligibility.ts` +
      ` to the derived set (and only after the course's curriculum is actually` +
      ` ingested in core — curriculumCode + core-safe anchors are the contract).`,
  );
  process.exit(1);
}

console.log(
  `ok    flashcard core-sync manifest matches the registry: [${expected.join(", ")}]`,
);
for (const n of notes) console.log(n);
