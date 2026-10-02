/**
 * Paper-identity vocabulary — the pure half of the F-022 tranche 2 matcher
 * (the corpus join lives in lib/paper-link.ts; this module is deliberately
 * import-free so scripts/paper_link_verify.ts can pin it in CI).
 *
 * The vocabulary below is the 2026-10-02 production AUDIT (evidence:
 * syllabai/bench/evidence drafts + syllabai-parser PaperIdentityResolutionTest
 * + core GlmOcrDraftMapper):
 *
 *   paperCode    — the parser emits the PRINTED reference verbatim, and every
 *                  observed production value is the "SPEC/CODE" form
 *                  ("4CH1/1C", "4CH1/1CR", "4CH0/1C"); honestly NULL when the
 *                  cover was lost ("no guessed code"). Corpus dirs are
 *                  "<SPEC>-<CODE>", so — normalized — the code IS the dir:
 *                  "4CH1/1C" → "4ch11c" === "4CH1-1C" → "4ch11c". The match
 *                  is therefore exact-equality on the normalized whole form;
 *                  a bare-code tolerance was deliberately NOT added (no
 *                  production evidence, and a tail match is exactly what
 *                  cross-spec false positives like 4SD0's own "1C" look like).
 *   sessionLabel — the PRINTED session verbatim, NOT normalized by the parser:
 *                  "January 2016", "June 2012", "November 2020" and — pinned
 *                  in the parser's own tests — "Summer 2019" (Edexcel's summer
 *                  series IS the corpus "-06" id). Honestly NULL when missing.
 *                  MS covers print PUBLICATION months, never sessions — the
 *                  core mapper takes the session from the QP side, so values
 *                  arriving here are genuine sessions.
 *
 * Everything fails closed: an unmappable or missing value yields false/null,
 * and the caller treats that as "no PDF link" — never a guess.
 */

const MONTH_WORDS: Record<string, string> = {
  january: "01",
  jan: "01",
  february: "02",
  feb: "02",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  may: "06",
  june: "06",
  jun: "06",
  /** Edexcel's summer series is the June sitting — the corpus ids it "-06" */
  summer: "06",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  /** late-year sittings print "October" or "November"; the corpus ids "-11" */
  october: "11",
  oct: "11",
  november: "11",
  nov: "11",
  winter: "11",
  autumn: "11",
  december: "12",
  dec: "12",
};

/** "June 2025" / "Summer 2013" / "2022-01" / "Specimen" → the corpus session id. */
export function sessionIdFromLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  if (!l) return null;
  if (l === "specimen") return "specimen";
  const shaped = /^((?:19|20)\d{2})-(\d{2})$/.exec(l);
  if (shaped) return shaped[0];
  const year = /\b((?:19|20)\d{2})\b/.exec(l)?.[1];
  if (!year) return null;
  const month = Object.keys(MONTH_WORDS).find((m) =>
    new RegExp(`\\b${m}\\b`).test(l),
  );
  return month ? `${year}-${MONTH_WORDS[month]}` : null;
}

/** lowercase alphanumerics — "4CH1/1C" → "4ch11c", "4CH1-1C" → "4ch11c" */
export function normIdentity(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The whole-form identity check: the printed "SPEC/CODE" reference against a
 * corpus dir "<SPEC>-<CODE>", equal once normalized. Refuses short fragments
 * (a stray single letter can never identify a paper) and — by being exact —
 * refuses cross-spec look-alikes ("4CH1/1C" never matches 4SD0's "1C" dir).
 */
export function wholeCodeMatchesDir(
  paperCode: string | null | undefined,
  dir: string,
): boolean {
  const code = normIdentity(paperCode ?? "");
  return code.length >= 2 && normIdentity(dir) === code;
}
