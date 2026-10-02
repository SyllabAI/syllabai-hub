/**
 * Math delimiter normalization for MODEL-GENERATED markdown (s142, evolved
 * from the s138 rules that lived in ChatMarkdown).
 *
 * The prompt pins $…$ / $$…$$ for math, but GLM drifts — and every drift
 * shape that reached production rendered raw LaTeX in front of learners:
 *
 *   \ceO2 using the formula                                (dropped braces)
 *   \%\,$\ce{O2}$= \frac{V_{…}}{V_{…}}\times100            ($ closed early —
 *                                                          formula body leaks)
 *   M_r = \frac{24}{0.4} = 60                             (no delimiters at all)
 *
 * Rules, in order:
 *  1. \(…\)            → $…$     (unambiguous, never occurs in prose)
 *  2. \[…\]            → $$…$$   (only when the body looks like LaTeX, so the
 *                                 escaped literal \[1\] stays a literal)
 *  3. bare \ce{…}/\pu{…} → $\ce{…}$ (outside math, never double-wrapped)
 *  4. \ceO2            → $\ce{O2}$  (dropped braces, chemistry-ish token only)
 *  5. $5 today and $10 → \$…\$   (a price pair is prose, not math — otherwise
 *                                 remark-math italicizes the sentence between
 *                                 the two dollars)
 *  6. leaked formula bodies wrap as ONE math run: per line, a maximal run of
 *     math-ish tokens containing a LaTeX command is wrapped in $…$. Existing
 *     $…$ spans inside the run merge in; code fences, inline code, display
 *     math, list/heading markers and citation [n] markers are barriers; runs
 *     with unbalanced braces are left alone (no worse than raw).
 *
 * T-C47 residual hardening (post-merge audit, operator trace
 * 1a0fb4b888cb507d "And are there more issues like this?") — 4 more real
 * shapes, 2 of which render hard KaTeX red:
 *  R1  multi-line $$…$$ blocks (PROPER delimiters, no drift) — the
 *      line-based rule 6 shredded their inner lines into nested $…$
 *      (KaTeX "Can't use function '$'"); rule 6 now never wraps a line
 *      inside — or on the boundary of — a display block (same defect
 *      class the rule-2 line-collapse fixed for \[…\] bodies)
 *  R2  bare \ce{…}/\pu{…} with NESTED braces (the ion shapes
 *      \ce{SO4^{2-}}, \ce{Fe^{3+}}) — the old [^}]* cut at the first
 *      brace and wrapped an unbalanced body ("Unexpected end of input
 *      in a macro argument") + a stray } literal; the matcher now takes
 *      one brace level and deeper nests are left alone (no worse than raw)
 *  R3  multi-line \(…\) bodies — collapsed onto one line like rule 2,
 *      so the body stays ONE math span instead of fragmenting (raw
 *      \frac fragments used to leak into the prose)
 *  R4  emphasis-wrapped partial runs (**\frac{V}{24} = 0.5 mol**) — the
 *      opening ** used to be swallowed INTO the math (asterisk noise,
 *      emphasis lost); one-sided markers now move outside the $…$ like
 *      the whole-run case already did
 *
 * Applied by ChatMarkdown (Tutor + every CLA surface) and QuestionMarkdown
 * (corpus + Smart Mark explanations + question help) — curated corpus
 * content sails through untouched (it never carries these shapes).
 */

const LATEXISH = /[\\^_{}]/; // \frac, x^2, H_2, {…} — an escaped literal never has these

/** LaTeX commands that mark a token as belonging to a math run. The
 *  single-char (non-letter) names are \% \, \; \: \! — escape + spacing. */
const MATH_COMMANDS = new Set([
  "frac", "dfrac", "tfrac", "sqrt", "times", "div", "cdot", "pm", "mp",
  "le", "leq", "ge", "geq", "ne", "neq", "approx", "equiv", "propto",
  "to", "rightarrow", "leftarrow", "leftrightarrow", "rightleftharpoons",
  "left", "right", "begin", "end", "text", "textrm", "textit", "textbf",
  "mathrm", "mathbf", "mathit", "mathsf", "mathcal", "mathbb", "hat",
  "bar", "vec", "overline", "underline", "overset", "underset", "binom",
  "substack", "quad", "qquad", "infty", "partial", "nabla", "degree",
  "circ", "perp", "parallel", "angle", "triangle", "ce", "pu",
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma",
  "tau", "upsilon", "phi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi",
  "Psi", "Omega",
]);

const COMMAND_TOKEN = /\\(%|,|;|:|!|[a-zA-Z]+)/g;

/** does the text carry a backslash command we treat as math? */
export function hasMathCommand(text: string): boolean {
  COMMAND_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMMAND_TOKEN.exec(text)) !== null) {
    const name = m[1];
    if (name.length === 1 && !/[a-zA-Z]/.test(name)) return true; // \% \, \; \: \!
    if (MATH_COMMANDS.has(name)) return true;
  }
  return false;
}

/** a space-separated token that may belong to a math run */
function isMathishToken(token: string): boolean {
  if (token === "") return false;
  if (hasMathCommand(token)) return true;
  if (/[{}^_]/.test(token)) return true; // LaTeX structure: V_{…}, x^2
  if (/^[A-Za-z]$/.test(token)) return true; // single-letter variables
  if (/^[A-Za-z]+\d+[A-Za-z0-9]*$/.test(token)) return true; // O2, CO2, H2SO4
  if (/^[\d.,()%×÷±=+\-<>≤≥→°′″⋅]+$/.test(token)) return true; // numbers & operators
  return false;
}

/** markdown line-prefix markers a math run must never swallow: the token
 *  must BE the marker exactly (a list bullet, a `1.`, a heading/hash run)
 *  — `**M_r` is a bold-wrapped variable, not a marker — and only at the very
 *  start of the line (a mid-line `-` is a minus sign). */
const MARKER_TOKEN = /^(?:[-*+>|]|#{1,6}|\d+[.)]|\*\*|__|```|~~~)$/;

type TokenKind = "text" | "inline" | "display" | "code";
type Token = { text: string; start: number; end: number; kind: TokenKind };
type Chunk = Token & { mathish: boolean; command: boolean; marker: boolean };

/** split a line into inline code / display math / inline math spans; the
 *  remaining text stays as raw spans (chunked later) */
const TOKEN_RE = /(`+[^`\n]*`+)|(\$\$[^$\n]+\$\$)|(\$[^$\n]+?\$)/g;

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) {
      tokens.push({ text: line.slice(last, m.index), start: last, end: m.index, kind: "text" });
    }
    const kind: TokenKind =
      m[1] !== undefined ? "code" : m[2] !== undefined ? "display" : "inline";
    tokens.push({ text: m[0], start: m.index, end: TOKEN_RE.lastIndex, kind });
    last = TOKEN_RE.lastIndex;
  }
  if (last < line.length) {
    tokens.push({ text: line.slice(last), start: last, end: line.length, kind: "text" });
  }
  return tokens;
}

function chunksOf(line: string, tokens: Token[]): Chunk[] {
  const chunks: Chunk[] = [];
  let first = true; // markers only count at the very start of the line
  for (const t of tokens) {
    if (t.kind === "text") {
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(t.text)) !== null) {
        const text = m[0];
        chunks.push({
          text,
          start: t.start + m.index,
          end: t.start + re.lastIndex,
          kind: "text",
          mathish: isMathishToken(text),
          command: hasMathCommand(text),
          marker: first && MARKER_TOKEN.test(text),
        });
        first = false;
      }
    } else {
      // inline math joins runs (its $-wrappers unwrap on merge); display
      // math and code are barriers a run never crosses
      chunks.push({
        ...t,
        mathish: t.kind === "inline",
        command: false,
        marker: false,
      });
    }
  }
  return chunks;
}

function bracesBalanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** wrap the leaked formula runs of ONE line (see header rule 6) */
function wrapLineRuns(line: string): string {
  if (!line.includes("\\")) return line; // fast path: no backslash, no LaTeX
  const chunks = chunksOf(line, tokenizeLine(line));
  const runs: Array<[number, number]> = [];
  let i = 0;
  while (i < chunks.length) {
    if (chunks[i].kind === "text" && chunks[i].command) {
      let from = i;
      while (from > 0 && !chunks[from - 1].marker && chunks[from - 1].mathish) from--;
      let to = i;
      while (to + 1 < chunks.length && !chunks[to + 1].marker && chunks[to + 1].mathish) to++;
      runs.push([from, to]);
      i = to + 1;
    } else {
      i++;
    }
  }
  if (runs.length === 0) return line;

  let out = line;
  for (let r = runs.length - 1; r >= 0; r--) {
    const [from, to] = runs[r];
    const parts: string[] = [];
    for (let k = from; k <= to; k++) {
      const c = chunks[k];
      parts.push(c.kind === "inline" ? c.text.replace(/^\$/, "").replace(/\$$/, "") : c.text);
    }
    let runText = parts.join(" ").trim();
    // stray delimiter dollars at the edges (rescues an unclosed $$…)
    runText = runText.replace(/^\$+/, "").replace(/\$+$/, "").trim();
    // bold/italic wrapping the whole run stays OUTSIDE the math so markdown
    // still renders it (the markers move out, the formula goes in)
    let wrapOpen = "";
    let wrapClose = "";
    const boldAll = runText.match(/^\*\*([\s\S]+)\*\*$/);
    const italAll = boldAll ? null : runText.match(/^\*([\s\S]+)\*$/);
    if (boldAll) {
      wrapOpen = "**";
      wrapClose = "**";
      runText = boldAll[1].trim();
    } else if (italAll) {
      wrapOpen = "*";
      wrapClose = "*";
      runText = italAll[1].trim();
    } else if (runText.startsWith("**")) {
      // one-sided emphasis (R4, T-C47): **\frac{V}{24} = 0.5 mol** — the
      // run starts inside the bold but ends before the closing marker
      // (a non-mathish word sat between); move the opening marker out
      // so it never lands inside the math as literal asterisks
      wrapOpen = "**";
      runText = runText.slice(2).trim();
    } else if (runText.startsWith("*")) {
      wrapOpen = "*";
      runText = runText.slice(1).trim();
    }
    if (!wrapClose) {
      if (runText.endsWith("**") && wrapOpen !== "**") {
        wrapClose = "**";
        runText = runText.slice(0, -2).trim();
      } else if (runText.endsWith("*") && wrapOpen !== "*") {
        wrapClose = "*";
        runText = runText.slice(0, -1).trim();
      }
    }
    // sentence punctuation belongs to the prose around the math
    const lead = runText.match(/^[.,;:]+/)?.[0] ?? "";
    const tail = runText.match(/[.,;:]+$/)?.[0] ?? "";
    runText = runText.slice(lead.length, runText.length - tail.length).trim();
    if (runText === "" || !hasMathCommand(runText)) continue;
    if (!bracesBalanced(runText)) continue;
    // a bare % is a comment character in TeX — escape it for math mode
    runText = runText.replace(/(?<!\\)%/g, "\\%");
    out =
      out.slice(0, chunks[from].start) +
      lead + wrapOpen + "$" + runText + "$" + wrapClose + tail +
      out.slice(chunks[to].end);
  }
  return out;
}

/** rule 6 entry: wrap leaked runs per line, skipping fenced code blocks AND
 *  display-block lines (R1, T-C47 — a proper multi-line $$…$$ block used to
 *  have its inner lines shredded into nested $…$). Display state toggles per
 *  odd \$\$ occurrence, mirroring remark-math's own delimiter pairing; a
 *  line inside a block, or opening/closing one, is never re-wrapped. Lines
 *  with PAIRED \$\$ spans outside any block still wrap normally (the spans
 *  themselves are barriers in wrapLineRuns). */
function wrapDanglingMath(answer: string): string {
  let inFence = false;
  let inDisplay = false;
  return answer
    .split("\n")
    .map((line) => {
      if (/^\s{0,3}(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const count = (line.match(/\$\$/g) ?? []).length;
      const wasInside = inDisplay;
      if (count % 2 === 1) inDisplay = !inDisplay;
      return wasInside || count % 2 === 1 ? line : wrapLineRuns(line);
    })
    .join("\n");
}

/** rules 3+4 of the header list: wrap bare \ce{…}/\pu{…} and braceless
 *  \ceO2/\puK in $…$. Applied ONLY to text between $$…$$ display spans —
 *  inside a display block the extra $…$ corrupts the TeX (the real-world
 *  shape \boxed{\ce{…}} renders "\boxed{$\ce{…}$}" and KaTeX dies on the
 *  inner dollars; caught by the T-C44 verify gate). */
function bareCe(text: string): string {
  return text
    // 3. bare \ce{…}/\pu{…} → $\ce{…}$  (outside math delimiters; the
    //    lookbehind/lookahead keep an already-delimited $\ce{…}$ untouched).
    //    The body matcher takes ONE nesting level (R2, T-C47 — the ion
    //    shapes \ce{SO4^{2-}} / \ce{Fe^{3+}} used to be cut at the first
    //    brace and wrapped unbalanced); deeper nests simply don't match
    //    and stay raw (no worse than raw)
    .replace(
      /(?<![$\\])\\(ce|pu)\{((?:[^{}]|\{[^{}]*\})*)\}(?!\$)/g,
      (_m, cmd: string, tex: string) => `$\\${cmd}{${tex}}$`,
    )
    // 4. braceless \ceO2 / \puK → $\ce{O2}$ — only chemistry-ish tokens
    //    (contains a digit, or ≤3 chars: O2, CO2, HCl, H2O…) so a longer
    //    control word like \center is never mangled
    .replace(
      /(?<![$\\])\\(ce|pu)([A-Z][A-Za-z0-9]{0,7})(?![A-Za-z0-9{])/g,
      (m, cmd: string, tok: string) =>
        /\d/.test(tok) || tok.length <= 3 ? `$\\${cmd}{${tok}}$` : m,
    );
}

export function normalizeMathDelimiters(answer: string): string {
  const delimited = answer
    // 1. \( … \) → $ … $  (inline; \( never occurs in prose). The body is
    //    collapsed onto ONE line (R3, T-C47 — same TeX-whitespace reasoning
    //    as rule 2: a multi-line \(…\) used to fragment into per-line
    //    wrapped spans and leak raw \frac into the prose)
    .replace(
      /\\\(([\s\S]+?)\\\)/g,
      (_m, tex: string) => `$${tex.replace(/\n[ \t]*/g, " ").trim()}$`,
    )
    // 2. \[ … \] → $$ … $$  (display; only when the body looks like LaTeX,
    //    so the escaped literal \[1\] stays a literal). The body is
    //    collapsed onto ONE line (newlines → spaces — TeX treats them as
    //    whitespace): a multi-line $$…$$ block would let the line-based
    //    rule 6 below re-wrap its inner lines into nested $…$ runs, which
    //    KaTeX rejects ("Can't use function '$' in math mode"). T-C44.
    .replace(/\\\[([\s\S]+?)\\\]/g, (m, tex: string) =>
      LATEXISH.test(tex) ? `$$${tex.replace(/\n[ \t]*/g, " ").trim()}$$` : m,
    );

  // rules 3+4 run only BETWEEN display spans (see bareCe header)
  const DISPLAY_SPAN = /\$\$[\s\S]+?\$\$/g;
  let spread = "";
  let last = 0;
  let span: RegExpExecArray | null;
  DISPLAY_SPAN.lastIndex = 0;
  while ((span = DISPLAY_SPAN.exec(delimited)) !== null) {
    spread += bareCe(delimited.slice(last, span.index)) + span[0];
    last = DISPLAY_SPAN.lastIndex;
  }
  spread += bareCe(delimited.slice(last));

  return wrapDanglingMath(
    spread
      // 5. a $…$ pair whose body reads as prose (a number AND a plain word,
      //    no LaTeX structure) is a price, not math — escape both dollars so
      //    remark-math cannot italicize the sentence between them
      .replace(/\$([^$\n]+)\$/g, (m, body: string) => {
        if (/[\\{}^_]/.test(body)) return m;
        if (!/\d/.test(body) || !/\b[a-z]{3,}\b/.test(body)) return m;
        return `\\$${body}\\$`;
      }),
  );
}
