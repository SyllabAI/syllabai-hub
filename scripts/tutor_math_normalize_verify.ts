/**
 * T-C44 runtime verification — the tutor math rendering pipeline against the
 * SHIPPED composition: src/components/markdown.tsx (the corpus renderer, which
 * carries rehypeKatexMhchem on hub) + src/lib/mathNormalize.ts (ported from
 * syllabai-web s142), composed exactly as src/app/tutor/message-item.tsx and
 * the CLA/assistant surfaces now render model content.
 * Run: bun scripts/tutor_math_normalize_verify.ts
 *
 * The trigger (live operator report, 2026-10-02, trace 1a0fb115064e11f5): a
 * tutor reply for 2020 January GCSE Chemistry Paper 1 Q10 rendered
 *
 *   \[ \boxed{\ce{4NH3 + 5O2 -> 4NO + 6H2O}} \]
 *   \[ \ce{CuO + 2HNO3 -> Cu(NO3)2 + H2O} \]
 *   ... (M\(_r\)=187.5 g mol\(^{-1}\)) ...
 *   \[ n_{\text{theor}} = \frac{0.200\ \text{mol HNO3}}{2   (stream cut here)
 *
 * as RAW LaTeX — the hub tutor surfaces render model output through the
 * corpus Markdown pipeline, whose normalizeCorpusMath has NO \[…\] rule, NO
 * bare-\ce rule, and a parses() gate on plain katex (no mhchem), so whole
 * display blocks stayed literal.
 *
 * Checks (renderToStaticMarkup of the shipped composition):
 *  1. the reported boxed mhchem display block renders as math, not raw
 *  2. the CuO+HNO3 display block renders as math
 *  3. \(\ce{…}\) / M\(_r\) / ^{-1} inline shapes render without raw delimiters
 *  4. the truncated unterminated \[ tail never leaks \frac / \text
 *  5. pure prose is never wrapped
 *  6. well-formed $…$ survives (exactly one katex, no red)
 *  7. display $$…$$ renders (mhchem registration intact)
 *  8. currency dollars never become math
 *  9. fenced code blocks are never rewritten
 * 10. corpus-style $…$ with glued macros still repairs through the
 *     normalizeCorpusMath stage downstream (no double-processing damage)
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components/markdown";
import { normalizeMathDelimiters } from "../src/lib/mathNormalize";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

/** static markup of the shipped composition — exactly what message-item.tsx
 *  renders for an assistant turn */
function render(answer: string): string {
  return renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop -- verify-script shorthand
    React.createElement(Markdown, {
      children: normalizeMathDelimiters(answer),
    }),
  );
}

/** the text a learner actually SEES: tags stripped, and KaTeX's MathML
 *  annotations (which legitimately contain the TeX source) removed first */
function visibleText(html: string): string {
  return html
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** KaTeX error styling: the red errorColor branch — throwOnError:false
 *  renders bad macros red instead of throwing */
const hasRedError = (html: string) => html.includes("#cc0000") || html.includes("mathcolor");
const hasKatex = (html: string) => html.includes('class="katex"');
const rawLeak = (html: string, ...cmds: string[]) =>
  cmds.filter((c) => visibleText(html).includes(c));

// ── 1. the reported Stage-1 boxed display block ─────────────────────────
const stage1 = render(
  "Write the balanced chemical equation for this stage.\n\n\\[\n\\boxed{\\ce{4NH3 + 5O2 -> 4NO + 6H2O}}\n\\]",
);
check("reported \\[…\\] boxed display renders as math", hasKatex(stage1), stage1.slice(0, 220));
check("reported display: no raw LaTeX leaks",
  rawLeak(stage1, "\\boxed", "\\ce", "\\[").length === 0,
  "leaked: " + rawLeak(stage1, "\\boxed", "\\ce", "\\[").join(" "));
check("reported display: no red KaTeX error", !hasRedError(stage1));

// ── 2. the reported CuO + HNO3 display block ────────────────────────────
const stage2 = render("\\[\n\\ce{CuO + 2HNO3 -> Cu(NO3)2 + H2O}\n\\]");
check("CuO+HNO3 display block renders as math", hasKatex(stage2), stage2.slice(0, 220));
check("CuO+HNO3 display: no raw LaTeX leaks",
  rawLeak(stage2, "\\ce", "\\[").length === 0,
  "leaked: " + rawLeak(stage2, "\\ce", "\\[").join(" "));
check("CuO+HNO3 display: no red KaTeX error", !hasRedError(stage2));

// ── 3. the reported inline shapes ───────────────────────────────────────
const inline = render(
  "If 0.200 mol of \\(\\ce{HNO3}\\) reacts with excess \\(\\ce{CuO}\\) and 15.3 g of \\(\\ce{Cu(NO3)2}\\) (M\\(_r\\)=187.5 g mol\\(^{-1}\\)) are obtained.",
);
check("inline \\(\\ce{…}\\) shapes render as math", hasKatex(inline), visibleText(inline).slice(0, 200));
check("inline shapes: no raw delimiters or commands leak",
  rawLeak(inline, "\\(", "\\)", "\\ce", "^{-1}").length === 0,
  "leaked: " + rawLeak(inline, "\\(", "\\)", "\\ce", "^{-1}").join(" "));
check("inline shapes: no red KaTeX error", !hasRedError(inline));

// ── 4. the truncated unterminated \[ tail (the paste cut mid-stream) ────
const truncated = render("\\[\nn_{\\text{theor}} = \\frac{0.200\\ \\text{mol HNO3}}{2}");
check("truncated \\[ tail: the formula still renders as math", hasKatex(truncated), truncated.slice(0, 220));
check("truncated \\[ tail: no raw \\frac/\\text leaks",
  rawLeak(truncated, "\\frac", "\\text").length === 0,
  "leaked: " + rawLeak(truncated, "\\frac", "\\text").join(" "));

// ── 5. pure prose untouched ─────────────────────────────────────────────
const prose = render("The percentage yield compares the actual yield with the theoretical yield.");
check("pure prose never becomes math",
  !hasKatex(prose) && visibleText(prose).includes("compares the actual yield"));

// ── 6. well-formed inline math untouched ────────────────────────────────
const wellFormed = render("Use $x^2$ in the formula");
check("well-formed $…$ survives (1 katex, no red)",
  (wellFormed.match(/class="katex"/g) ?? []).length === 1 && !hasRedError(wellFormed));

// ── 7. mhchem registration through the full composition ─────────────────
const equation = render("$$\\ce{2Mg + O2 -> 2MgO}$$");
check("display mhchem equation renders without red", hasKatex(equation) && !hasRedError(equation));

// ── 8. currency ─────────────────────────────────────────────────────────
const money = render("It costs $5 today and $10 tomorrow.");
check("currency dollars never become math",
  !hasKatex(money) && visibleText(money).includes("$5") && visibleText(money).includes("$10"),
  visibleText(money));

// ── 9. code fences untouched ────────────────────────────────────────────
const fenced = render("Example:\n```\nM_r = \\frac{24}{0.4}\n```");
check("fenced code never rewritten",
  fenced.includes("<pre") && fenced.includes("\\frac") && !hasKatex(fenced));

// ── 10. corpus glued-macro repair still works downstream ────────────────
const corpus = render("$A\\capB$ joins the sets");
check("corpus glued-macro content still repairs (no double-processing damage)",
  hasKatex(corpus) && !hasRedError(corpus) && !visibleText(corpus).includes("\\cap"),
  visibleText(corpus).slice(0, 120));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
