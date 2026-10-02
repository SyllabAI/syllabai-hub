/**
 * flashcard-sync-eligibility — the ONE registry-derived predicate that
 * decides which courses' flashcard ratings sync to the core account trail
 * (T-C66, the T-C57 next_safe_action known as the "44-pack bridge-gate
 * widening").
 *
 * ── Why a predicate and not the pilot slug ───────────────────────────────
 * Before T-C66 both flashcard gates hard-coded
 * `course === PILOT_COURSE_SLUG` (the write side in lib/flashcard-bridge,
 * the read side in lib/flashcard-unified's useCoreReviewSchedule, and the
 * deck player's tranche-4.4 honesty chip). The widening replaces the slug
 * equality with THIS module everywhere, so the three consumers cannot
 * drift: widen the manifest and all three widen together — "widen BOTH or
 * neither" is structural, not a doc comment.
 *
 * ── The eligibility rule (all four must hold; derived from content/) ─────
 *   1. REGISTERED — the course is in content/courses.json;
 *   2. DECK-BEARING — its committed bundle has a non-empty flashcards.json;
 *   3. CORE-KNOWN CURRICULUM — courses.json carries a `curriculumCode` for
 *      it (the V53/ADR-030 bridge to core's curriculum registry — the same
 *      precedent the tutor gate uses). Without it core's knowledge graph
 *      cannot resolve the course's anchors and every rating would 404;
 *   4. CORE-SAFE ANCHORS — every TOPIC/SUBTOPIC-family code in the course
 *      bundle matches core's ingest charset (^[A-Za-z0-9-]+$, the
 *      FlashcardRatingRequest pattern) AND is course-prefixed
 *      (`boardCode + "-"`, boardCode = the curriculumCode with any trailing
 *      -<4-digit-year> stripped). Course-prefixed anchors cannot be
 *      ambiguous across courses; bare numeric codes ("1.1", "3.5" —
 *      shared by ial-biology-18, ial-chemistry-17, igcse-physics-19 and
 *      others) and charset-unsafe codes ("IGCSE_ACCOUNTING:S4.173",
 *      "ial-physics-T4.4:SUB_") are exactly what this condition keeps out:
 *      the first risks cross-course misattribution (whoever's node claimed
 *      the bare code first would silently absorb the other course's
 *      ratings), the second is a guaranteed 400 at core.
 *
 * Today (49-course registry) exactly one course satisfies all four: the
 * 4CH1 pilot — so behavior is byte-identical to the pre-T-C66 slug gate.
 * The widening is the MECHANISM: when an ingestion lane commissions the
 * next curriculum (curriculumCode lands in courses.json with core-safe
 * anchors), scripts/verify_flashcard_sync_courses.ts FAILS THE BUILD until
 * this manifest is regenerated — the flip is then one committed line, zero
 * code changes.
 *
 * ── Provenance note (recorded honestly) ──────────────────────────────────
 * The originating ledger phrase said "all 44 deck-bearing packs"; the
 * count was a ledger miscount (registry-derived truth: 49 registered /
 * 37 deck-bearing / 1 core-anchor-eligible at the 49-course registry).
 * This widening is therefore PREDICATE-defined, not count-defined — the
 * set is whatever the registry derives, and the verifier pins it.
 *
 * GENERATED-ADJACENT: the array below is re-derived and pinned by
 * `bun scripts/verify_flashcard_sync_courses.ts` (wired into prebuild).
 * Do not hand-edit it without regenerating from content/ — the build
 * fails on drift.
 */
export const FLASHCARD_SYNC_COURSES: readonly string[] = ["igcse-chemistry-19"];

/** The one gate the write side, the read side and the honesty chip share. */
export function isFlashcardSyncCourse(course: string): boolean {
  return (FLASHCARD_SYNC_COURSES as readonly string[]).includes(course);
}
