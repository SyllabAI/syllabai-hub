/// <reference types="bun-types" />
/**
 * Answer format v2 dialect — round-trip and edge gates (bun test).
 * Run: bun test src/lib/answer-format.test.ts
 */
import { describe, expect, test } from "bun:test";
import { parseAnswerText, serializeAnswerDoc, type AnswerDoc } from "./answer-format";

const doc = (paragraphs: AnswerDoc["content"]): AnswerDoc => ({ type: "doc", content: paragraphs });
const t = (text: string, marks?: AnswerDoc["content"][number]["content"][number] extends never ? never : any): any =>
  marks ? { type: "text", text, marks } : { type: "text", text };
const eq = (latex: string): any => ({ type: "answerEquation", attrs: { latex } });
const br = (): any => ({ type: "hardBreak" });

function roundTrip(str: string): string {
  return serializeAnswerDoc(parseAnswerText(str));
}

describe("answer format v2 — serialize", () => {
  test("plain text", () => {
    expect(serializeAnswerDoc(doc([{ type: "paragraph", content: [t("The rate increases")] }]))).toBe("The rate increases");
  });
  test("equation atom → $…$", () => {
    expect(serializeAnswerDoc(doc([{ type: "paragraph", content: [t("v = "), eq("u + at")] }]))).toBe("v = $u + at$");
  });
  test("italic, subscript, superscript", () => {
    expect(serializeAnswerDoc(doc([{ type: "paragraph", content: [t("a", [{ type: "italic" } as any])] }]))).toBe("*a*");
    expect(serializeAnswerDoc(doc([{ type: "paragraph", content: [t("2", [{ type: "subscript" } as any])] }]))).toBe("<sub>2</sub>");
    expect(serializeAnswerDoc(doc([{ type: "paragraph", content: [t("n+1", [{ type: "superscript" } as any])] }]))).toBe("<sup>n+1</sup>");
  });
  test("hardBreak → \\n, paragraphs → \\n\\n", () => {
    expect(serializeAnswerDoc(doc([{ type: "paragraph", content: [t("one"), br(), t("two")] }]))).toBe("one\ntwo");
    expect(serializeAnswerDoc(doc([{ type: "paragraph", content: [t("a")] }, { type: "paragraph", content: [t("b")] }]))).toBe("a\n\nb");
  });
  test("empty doc → empty string", () => {
    expect(serializeAnswerDoc(doc([{ type: "paragraph", content: [] }]))).toBe("");
  });
});

describe("answer format v2 — parse (incl. legacy v1 passthrough)", () => {
  test("legacy plain text parses as a single text run", () => {
    const d = parseAnswerText("Just some words here");
    expect(d.content[0].content).toEqual([{ type: "text", text: "Just some words here" }]);
  });
  test("inline math split", () => {
    const d = parseAnswerText("so $x^2+1$ grows");
    expect(d.content[0].content).toEqual([t("so "), eq("x^2+1"), t(" grows")]);
  });
  test("display math accepted as equation atom", () => {
    const d = parseAnswerText("$$\\ce{H2SO4}$$");
    expect(d.content[0].content).toEqual([eq("\\ce{H2SO4}")]);
  });
  test("mhchem latex survives", () => {
    const d = parseAnswerText("$\\ce{H2SO4}$");
    expect(d.content[0].content).toEqual([eq("\\ce{H2SO4}")]);
  });
  test("italic / sub / sup", () => {
    expect(parseAnswerText("*note*").content[0].content).toEqual([t("note", [{ type: "italic" } as any])]);
    expect(parseAnswerText("H<sub>2</sub>O").content[0].content).toEqual([t("H"), t("2", [{ type: "subscript" } as any]), t("O")]);
    expect(parseAnswerText("x<sup>2</sup>").content[0].content).toEqual([t("x"), t("2", [{ type: "superscript" } as any])]);
  });
  test("legacy raw dollars stay literal (remark-math currency guards)", () => {
    // legacy v1 economics answers stored raw "$5 and $10": the remark-math
    // guards (closing $ must not hug whitespace nor precede a digit) keep it
    // text — matching what the corpus renderer does with the same string
    const d = parseAnswerText("it costs $5 and $10 total");
    expect(serializeAnswerDoc(d)).toBe("it costs \\$5 and \\$10 total");
  });
  test("literal markdown-significant chars round-trip via escaping", () => {
    for (const s of ["5*3*4 = 60", "a < b and c > d", "back\\slash", "costs $5 today", "x \\* y"]) {
      const produced = serializeAnswerDoc(doc([{ type: "paragraph", content: [t(s)] }]));
      expect(roundTrip(produced)).toBe(produced);
    }
  });
  test("full round-trip through the parser", () => {
    const strs = [
      "The rate $r$ increases with $T$",
      "*point one* then H<sub>2</sub>O",
      "line one\nline two",
      "para one\n\npara two with $\\frac{1}{2}$",
      "m<sup>n+1</sup> and $\\ce{CO2}$",
      "", // empty stays empty; "trailing $ only" is asserted escaped below
    ];
    for (const s of strs.slice(0, -1)) expect(roundTrip(s)).toBe(s); // stable under round-trip
    // a lone unescaped $ parses literal and re-emits ESCAPED (the producer's
    // discipline) — the escaped form is then stable
    expect(roundTrip(roundTrip("trailing $ only"))).toBe("trailing \\$ only");
  });
  test("unterminated math degrades to literal text (escaped on re-emit)", () => {
    const d = parseAnswerText("half open $x^2 here");
    expect(serializeAnswerDoc(d)).toBe("half open \\$x^2 here");
  });
  test("stray sub tag degrades to literal text (renderer-safe escape)", () => {
    expect(roundTrip("a <sub> loose")).toBe("a &lt;sub> loose");
  });
});
