/**
 * paper_link_verify — pins the paper-identity vocabulary matcher against the
 * 2026-10-02 production AUDIT (F-022 tranche 2 follow-up):
 *
 *   - paperCode: the "SPEC/CODE" printed form ("4CH1/1C", "4CH1/1CR",
 *     "4CH0/1C") with honest nulls when the OCR lost the cover
 *   - sessionLabel: printed sessions verbatim — "January 2016", "June 2012",
 *     "November 2020", "Summer 2019" (parser's own pin), "Specimen"
 *
 * Run: bun scripts/paper_link_verify.ts  (CI step, exits non-zero on drift)
 */
import {
  normIdentity,
  sessionIdFromLabel,
  wholeCodeMatchesDir,
} from "../src/lib/paper-link-shared";

let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// ── session vocabulary (the audited production values) ─────────────────────
check("January 2016", sessionIdFromLabel("January 2016"), "2016-01");
check("June 2012", sessionIdFromLabel("June 2012"), "2012-06");
check("November 2020", sessionIdFromLabel("November 2020"), "2020-11");
check("Summer 2019 (parser pin)", sessionIdFromLabel("Summer 2019"), "2019-06");
check("Summer 2025 (doc-lane EVIDENCE)", sessionIdFromLabel("Summer 2025"), "2025-06");
check("Specimen", sessionIdFromLabel("Specimen"), "specimen");
check("already-shaped", sessionIdFromLabel("2022-06"), "2022-06");
check("abbreviated month", sessionIdFromLabel("Jan 2016"), "2016-01");
check("late-year Oct", sessionIdFromLabel("Oct 2021"), "2021-11");
check("null stays null", sessionIdFromLabel(null), null);
check("no year stays null", sessionIdFromLabel("June"), null);
check("no month stays null", sessionIdFromLabel("2026?"), null);

// ── code vocabulary: whole-form identity (the audited production form) ──
check("spec/code normalized", normIdentity("4CH1/1C"), "4ch11c");
check("dir normalized equal", normIdentity("4CH1-1C"), "4ch11c");

const dirCases: Array<[string, string | null, boolean]> = [
  ["4CH1-1C", "4CH1/1C", true], // the audited production match
  ["4CH1-1CR", "4CH1/1CR", true],
  ["WCH11-01", "WCH11/01", true],
  ["WCH11-01A", "WCH11/01A", true],
  ["4CH1-1CR", "4CH1/1C", false], // R-variant is a DIFFERENT paper
  ["WCH11-01A", "WCH11/01", false], // alternative-language paper
  ["4CH1-2C", "4CH1/1C", false],
  ["4SD0-1C", "4CH1/1C", false], // cross-spec: the tail collision the old
  // suffix match allowed — the audit is why the match is whole-form now
  ["4CH1-1C", "1C", false], // bare code: no production evidence, refused
  ["4CH1-1C", null, false], // lost cover: honestly refused
];
for (const [dir, code, want] of dirCases) {
  check(`dir ${dir} vs ${String(code)}`, wholeCodeMatchesDir(code, dir), want);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
