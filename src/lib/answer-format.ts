/**
 * Answer format v2 — the serialization dialect of the learner answer
 * (HUB-ANSWER-BOX wave 4, operator trace 1a0ea6d4ca777a75 "Go on with
 * updating the answer format").
 *
 * The contract: `answerText` stays ONE UTF-8 string (storage unchanged, the
 * 4000-char R7 cap unchanged, both mark lanes read it verbatim), but its
 * declared interpretation upgrades from "plain text" to the dialect the
 * hub's corpus renderer (src/components/markdown.tsx) already interprets:
 *
 *   CommonMark (GFM) text + inline LaTeX math in $…$ / display in $$…$$
 *   + limited inline HTML (<sub>/<sup>/<br/>) under the rehype-sanitize
 *   allow-list (+ mhchem \ce{} inside math).
 *
 * Strictly backward compatible: every v1 answer (plain text) is a valid v2
 * answer — the parser treats unmarked spans as plain text, so old drafts
 * load unchanged and old submissions keep marking the same way.
 *
 * This module is the machine boundary for the hub editor:
 *   - `serializeAnswerDoc` turns the TipTap doc JSON into the dialect;
 *   - `parseAnswerText` turns the dialect (a saved draft, or transcription
 *     output) back into TipTap doc JSON.
 *
 * Escaping discipline (the producer's obligation, so plain text round-trips):
 *   text runs escape  & → &amp;   < → &lt;   \ → \\   $ → \$   * → \*
 *   math runs are passed through verbatim between $ delimiters (a literal
 *   $ inside math is serialized as \$ and the scanner skips escaped `$`).
 * The parser decodes exactly this set — nothing else.
 *
 * What the editor does NOT emit (and the parser therefore does not accept
 * beyond treating it as literal text): headings, lists, bold, blockquotes.
 * The dialect declares them (the corpus renderer supports them) — the
 * answer editor is just not their producer.
 */

export type AnswerMark = { type: "italic" } | { type: "subscript" } | { type: "superscript" };

export type AnswerInlineNode =
  | { type: "text"; text: string; marks?: AnswerMark[] }
  | { type: "answerEquation"; attrs: { latex: string } }
  | { type: "hardBreak" };

export type AnswerDoc = {
  type: "doc";
  content: { type: "paragraph"; content: AnswerInlineNode[] }[];
};

/** Text-run escaping (see module doc). Order matters: & first. */
function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$")
    .replace(/\*/g, "\\*");
}

/** Decode what escapeText produced (and nothing else). */
function unescapeText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\\([\\$*])/g, "$1");
}

/** Serialize one inline node to the dialect. */
function serializeInline(node: AnswerInlineNode): string {
  if (node.type === "answerEquation") {
    const latex = node.attrs.latex.trim();
    return latex ? `$${latex}$` : "";
  }
  if (node.type === "hardBreak") return "\n";
  const text = escapeText(node.text);
  if (!node.marks || node.marks.length === 0) return text;
  // one mark per run (the editor never stacks them; Subscript and
  // Superscript exclude each other in the schema)
  const mark = node.marks[0];
  if (mark.type === "italic") {
    // CommonMark: an italic marker must not hug whitespace — carry any
    // leading/trailing space of the run OUTSIDE the asterisks so the
    // string round-trips through the parser byte-faithfully
    const lead = text.match(/^\s*/)?.[0] ?? "";
    const trail = text.match(/\s*$/)?.[0] ?? "";
    const inner = text.slice(lead.length, text.length - trail.length);
    return `${lead}*${inner}*${trail}`;
  }
  if (mark.type === "subscript") return `<sub>${text}</sub>`;
  return `<sup>${text}</sup>`;
}

/**
 * TipTap doc JSON → dialect string. Paragraphs join with "\n\n" (CommonMark
 * hard paragraph break); an empty document serializes to "".
 */
export function serializeAnswerDoc(doc: AnswerDoc): string {
  if (!doc?.content) return "";
  const paragraphs = doc.content
    .filter((n): n is { type: "paragraph"; content: AnswerInlineNode[] } => n.type === "paragraph")
    .map((p) => (p.content ?? []).map(serializeInline).join(""));
  return paragraphs.join("\n\n");
}

/** Is this doc empty of any visible content? (drives the is-empty UI) */
export function isAnswerDocEmpty(doc: AnswerDoc): boolean {
  return serializeAnswerDoc(doc).trim().length === 0;
}

// ── parser ──────────────────────────────────────────────────────────────────

type Token =
  | { kind: "text"; text: string }
  | { kind: "italic"; inner: Token[] }
  | { kind: "sub"; inner: Token[] }
  | { kind: "sup"; inner: Token[] }
  | { kind: "math"; latex: string }
  | { kind: "break" };

/**
 * Index of the next unescaped `ch` in `s` at/after `from`, or -1.
 * A backslash escapes the character that follows it (and only that).
 */
function findUnescaped(s: string, ch: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\") {
      i++; // skip the escaped char
      continue;
    }
    if (s[i] === ch) return i;
  }
  return -1;
}

/** Parse the inner span of an italic/sub/sup marker (text + math only). */
function parseInnerSpan(s: string): Token[] {
  return parseInline(s, false).tokens;
}

/** Parse one paragraph's inline content into tokens. */
function parseInline(s: string, allowBreaks: boolean): { tokens: Token[] } {
  const tokens: Token[] = [];
  let text = "";
  const flush = () => {
    if (text) {
      tokens.push({ kind: "text", text });
      text = "";
    }
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && /[$\\*]/.test(s[i + 1])) {
      text += ch + s[i + 1]; // keep escaped pair — unescaped later
      i += 2;
      continue;
    }
    if (ch === "$" && s[i + 1] === "$") {
      // display math — accepted by the dialect (corpus renderer renders it);
      // the editor holds it as an equation atom.
      const close = findDisplayClose(s, i + 2);
      if (close === -1) {
        text += ch;
        i++;
        continue;
      }
      flush();
      tokens.push({ kind: "math", latex: s.slice(i + 2, close).trim() });
      i = close + 2;
      continue;
    }
    if (ch === "$") {
      // remark-math-compatible guards (the corpus renderer's behavior, so
      // the editor's parser and the answer renderer agree): the opening $
      // must not be followed by whitespace, the closing $ must not be
      // preceded by whitespace nor followed by a digit/letter (currency
      // protection — "it costs $5 and $10" stays literal, incl. legacy v1).
      const close = findUnescaped(s, "$", i + 1);
      const openOk = !/\s/.test(s[i + 1] ?? " ");
      const closeOk =
        close !== -1 &&
        close > i + 1 &&
        !/\s/.test(s[close - 1]) &&
        !/[\dA-Za-z]/.test(s[close + 1] ?? "");
      if (close === -1 || !openOk || !closeOk) {
        text += ch; // literal dollar (the producer escapes it on re-emit)
        i++;
        continue;
      }
      flush();
      tokens.push({ kind: "math", latex: s.slice(i + 1, close).trim() });
      i = close + 1;
      continue;
    }
    if (ch === "*" && s[i + 1] !== "*" && s[i + 1] !== " " && s[i + 1] !== "") {
      const close = findUnescaped(s, "*", i + 1);
      if (close === -1) {
        text += ch;
        i++;
        continue;
      }
      flush();
      tokens.push({ kind: "italic", inner: parseInnerSpan(s.slice(i + 1, close)) });
      i = close + 1;
      continue;
    }
    if (s.startsWith("<sub>", i)) {
      const close = s.indexOf("</sub>", i + 5);
      if (close === -1) {
        text += ch;
        i++;
        continue;
      }
      flush();
      tokens.push({ kind: "sub", inner: parseInnerSpan(s.slice(i + 5, close)) });
      i = close + 6;
      continue;
    }
    if (s.startsWith("<sup>", i)) {
      const close = s.indexOf("</sup>", i + 5);
      if (close === -1) {
        text += ch;
        i++;
        continue;
      }
      flush();
      tokens.push({ kind: "sup", inner: parseInnerSpan(s.slice(i + 5, close)) });
      i = close + 6;
      continue;
    }
    if (ch === "\n") {
      flush();
      // "\n\n" never reaches here (paragraph split first); a single newline
      // inside a paragraph is the hardBreak the serializer emits
      tokens.push({ kind: allowBreaks ? "break" : "text", text: allowBreaks ? "" : "\n" });
      i++;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return { tokens };
}

/** Find the closing `$$` for display math starting after `from`. */
function findDisplayClose(s: string, from: number): number {
  for (let i = from; i < s.length - 1; i++) {
    if (s[i] === "$" && s[i + 1] === "$") return i;
    if (s[i] === "\\") i++; // skip escaped char
  }
  return -1;
}

function tokensToNodes(tokens: Token[], marks: AnswerMark[]): AnswerInlineNode[] {
  const nodes: AnswerInlineNode[] = [];
  for (const t of tokens) {
    if (t.kind === "text") {
      const decoded = unescapeText(t.text);
      if (decoded) nodes.push(marks.length ? { type: "text", text: decoded, marks } : { type: "text", text: decoded });
    } else if (t.kind === "break") {
      nodes.push({ type: "hardBreak" });
    } else if (t.kind === "math") {
      if (t.latex) nodes.push({ type: "answerEquation", attrs: { latex: t.latex } });
    } else {
      const inner: AnswerMark[] =
        t.kind === "italic" ? [...marks, { type: "italic" }] : t.kind === "sub" ? [...marks, { type: "subscript" }] : [...marks, { type: "superscript" }];
      nodes.push(...tokensToNodes(t.inner, inner));
    }
  }
  return nodes;
}

/**
 * Dialect string → TipTap doc JSON. Legacy v1 drafts (plain text) parse as
 * plain text runs — nothing to migrate. Malformed markers (unterminated
 * $…$, stray <sub>) degrade to literal text rather than raising.
 */
export function parseAnswerText(text: string): AnswerDoc {
  if (!text) return { type: "doc", content: [{ type: "paragraph", content: [] }] };
  const paragraphs = text.split(/\n{2,}/);
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: tokensToNodes(parseInline(p, true).tokens, []),
    })),
  };
}
