import type { Page } from "@playwright/test";

/**
 * Shared helpers for the deck-flow E2E (tranche 4.13).
 *
 * The rating trail is the browser-local overlay (lib/progress.ts, key
 * `syllabai-hub:progress:<course>`). Days-scale Ebbinghaus scheduling can't
 * be waited out in a seconds-scale test, so the specs TIME-TRAVEL: they rate
 * through the real UI first (real records, real card ids, real subtopics),
 * then rewrite the trail's timestamps into the past and reload — the
 * scheduler then sees exactly the trail a returning learner's browser holds.
 * Nothing is faked that the scheduler reads shape-wise: only `at` moves.
 */

export const PILOT = "igcse-chemistry-19";
export const DECK_SUBTOPIC = "4CH1-S1-e";
export const DECK_URL = `/courses/${PILOT}/flashcards/${DECK_SUBTOPIC}`;
export const DECKS_URL = `/courses/${PILOT}/flashcards`;

export const storageKey = `syllabai-hub:progress:${PILOT}`;

export interface SeededCard {
  cardId: string;
  rating: "know" | "still-learning";
  /** how far back the latest rating happened */
  ageDays: number;
}

/**
 * Rewrite the age of the latest rating on specific cards (in place, in the
 * page's localStorage). Cards not listed keep their fresh timestamps.
 * Returns the card ids it touched (verified non-empty by the caller).
 */
export async function ageCardRatings(page: Page, seeds: SeededCard[]): Promise<string[]> {
  return page.evaluate(
    ([key, seeds]) => {
      const DAY = 86_400_000;
      const raw = window.localStorage.getItem(key!);
      if (!raw) throw new Error(`no overlay at ${key} — rate through the UI first`);
      const progress = JSON.parse(raw);
      const touched: string[] = [];
      for (const seed of seeds!) {
        const rec = progress.flashcards[seed.cardId];
        if (!rec) throw new Error(`card ${seed.cardId} not rated yet`);
        const at = Date.now() - seed.ageDays * DAY;
        rec.at = at;
        // the trail is newest-last; age the tail entry (the latest rating)
        if (rec.trail && rec.trail.length > 0) rec.trail[rec.trail.length - 1].at = at;
        touched.push(seed.cardId);
      }
      window.localStorage.setItem(key!, JSON.stringify(progress));
      return touched;
    },
    [storageKey, seeds] as const,
  );
}

/** The card ids currently rated in this browser's overlay. */
export async function ratedCardIds(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key!);
    if (!raw) return [];
    return Object.keys(JSON.parse(raw).flashcards ?? {});
  }, [storageKey] as const);
}
