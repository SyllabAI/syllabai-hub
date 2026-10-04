"use client";

import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { normalizeCorpusMath, sanitizeMathTex } from "@/lib/math-fix";
import { normalizeCorpusEmphasis } from "@/lib/emphasis-fix";
import { rehypeKatexMhchem } from "@/lib/rehypeKatexMhchem";

/**
 * Markdown renderer for corpus content (SME notes, questions, solutions,
 * flashcards). The upstream corpus carries:
 *   - inline/display LaTeX in $…$ / $$…$$ (converted from Wiris MathML
 *     upstream) → rendered with KaTeX;
 *   - light inline HTML (<sub>/<sup> for chemical formulae, <br/>, tables)
 *     → rehype-raw (content is operator-imported) then SANITIZED — the
 *       allow-list pass (s144 import hardening) closes the stored-XSS
 *       surface the demo carried: corpus HTML may only produce the
 *       harmless-inline subset, never script/onegai/event handlers;
 *   - images hotlinked from the public syllabai-resources repo;
 *   - `> **Exam Hint**` / `> **Worked Example**` / `> **Case Study**` /
 *     `> **Top Tip**` blockquote callouts → SME-style tinted boxes.
 *
 * Web adaptation (2026-09-28 import): rehype-katex is replaced by the LOCAL
 * rehypeKatexMhchem (s142) — the upstream plugin can land on a different
 * katex module instance than `katex/contrib/mhchem` registers on, which
 * rendered every \ce{} as red error text. Both are imported side by side
 * here so renderer and macro registration share one instance everywhere.
 *
 * Plugin order matters: rehype-raw (parse embedded HTML) → rehype-sanitize
 * (allow-list the result) → math-value repair → KaTeX (generates its own
 * trusted HTML downstream of the sanitizer). remark-math's code classNames
 * (language-math / math-inline / math-display) survive the default schema.
 */

type HastNode = {
  type?: string;
  value?: string;
  tagName?: string;
  children?: HastNode[];
};

function hastText(node: HastNode | undefined | null): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

const CALLOUT_STYLES: { match: RegExp; label: string; className: string }[] = [
  {
    match: /exam hint/i,
    label: "Exam hint",
    className: "border-l-warn bg-warn/10",
  },
  {
    match: /worked example/i,
    label: "Worked example",
    className: "border-l-success bg-success/10",
  },
  {
    match: /case study/i,
    label: "Case study",
    className: "border-l-cat bg-cat/10",
  },
  {
    match: /top tip|top tips/i,
    label: "Top tip",
    className: "border-l-info bg-info/10",
  },
];

/** Corpus spec-point anchor rendered as a quiet provenance chip. */
const SPEC_ANCHOR_RE = /^\s*Spec point\b/i;

function blockquoteVariant(node: HastNode | undefined) {
  const text = hastText(node?.children?.[0]);
  if (SPEC_ANCHOR_RE.test(text)) {
    return { label: "Spec point", className: "border-l-primary/40 bg-muted/60" };
  }
  for (const v of CALLOUT_STYLES) {
    if (v.match.test(text)) return { label: v.label, className: v.className };
  }
  return null;
}

/** Minimal hast node shape used by the math-value fixer. */
type HastLike = {
  type?: string;
  properties?: { className?: unknown };
  value?: string;
  children?: HastLike[];
};

function isMathElement(n: HastLike): boolean {
  if (n.type !== "element") return false;
  const cls = n.properties?.className;
  const list = Array.isArray(cls) ? cls.map(String) : [];
  return list.some(
    (c) => c === "language-math" || c === "math-inline" || c === "math-display",
  );
}

/**
 * rehype plugin: repair the math source text right before KaTeX reads it.
 *
 * NOTE: repairing at the remark (mdast) level does NOT work — remark-math
 * pre-builds `node.data.hChildren` at parse time and remark-rehype renders
 * from that embedded copy, silently ignoring transformer mutations of
 * `node.value`. The hast text is the last stop before KaTeX, so it is
 * patched here: glued macros (`\capB` → `\cap B`), stray `$$` → `\quad`,
 * bare `%` and `____` runs.
 */
function rehypeFixMathValues() {
  const walk = (node: HastLike) => {
    if (isMathElement(node) && node.children) {
      const texts = node.children.filter(
        (c) => c.type === "text" && typeof c.value === "string",
      );
      if (texts.length) {
        const fixed = sanitizeMathTex(texts.map((t) => t.value as string).join("")).replace(
          /\$\$/g,
          "\\quad ",
        );
        texts.forEach((t, i) => {
          t.value = i === 0 ? fixed : "";
        });
      }
    }
    (node.children ?? []).forEach(walk);
  };
  return (tree: HastLike) => walk(tree);
}

/**
 * Sanitize schema — the default allow-list is exactly right for the corpus
 * (audited 2026-09-28: the bundles carry only <sub>/<sup>/<br>/<u>/<a>/<b>/<p>
 * inline HTML; sub/sup/tables/spans/emphasis are all permitted, and the
 * remark-math code classNames survive). Today's corpus carries no script or
 * event-handler content; the gate exists so a FUTURE corpus import can never
 * introduce stored XSS against learners.
 */
const CORPUS_SCHEMA = defaultSchema;

/** Markdown renderer for corpus content (SME notes, questions, solutions). */
export function Markdown({
  children,
  className,
  pClassName,
}: {
  children: string;
  className?: string;
  /** Extra classes merged into rendered paragraphs (flashcard fronts use
   *  this for text-lg font-medium instead of the prose default). */
  pClassName?: string;
}) {
  // SME-derived corpus needs broken-bold repair ("**W **and" → "**W** and")
  // + glued-macro repair + \(…\) delimiter support before remark sees it
  // (see the math-fix.ts / emphasis-fix.ts headers for the corpus research
  // findings).
  const src = normalizeCorpusMath(normalizeCorpusEmphasis(children));
  return (
    <div className={cn("prose-sm space-y-3 leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, CORPUS_SCHEMA],
          rehypeFixMathValues,
          [rehypeKatexMhchem, { errorColor: "#b91c1c", strict: "ignore" }],
        ]}
        components={{
          h1: ({ children }) => (
            <h2 className="mt-5 border-b pb-1 text-lg font-bold">{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-3 text-sm font-semibold">{children}</h4>
          ),
          h4: ({ children }) => (
            <h5 className="mt-2 text-[13px] font-semibold text-muted-foreground">{children}</h5>
          ),
          p: ({ children }) => (
            <p className={cn("text-[13.5px] leading-relaxed", pClassName)}>{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5 text-[13.5px]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5 text-[13.5px]">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          a: ({ children, href }) => {
            const h = typeof href === "string" ? href : "";
            // Operator 2026-09-29 (trace 1a0ec14f2f7e3581): "same treatment
            // for other outbound links" — EVERY external text-link gets the
            // HUB-NOTES-SOURCE treatment the savemyexams cross-references
            // already had: keep the label text, drop the off-site hop. This
            // also covers the Pearson past-paper refs and the news/gov/
            // Wikimedia attribution links in question content, and any URL
            // an AI answer emits. Internal (relative) hrefs stay links.
            // Images are a different renderer path (img:) and keep loading
            // from the resources mirror; the pastpapers PDF buttons are not
            // markdown (they point at the SyllabAI mirror) and stay live.
            if (/^https?:\/\//i.test(h)) {
              return <span>{children}</span>;
            }
            return (
              <a href={h} className="text-primary underline underline-offset-2">
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const s = typeof src === "string" ? src : "";
            if (s.startsWith("/content-assets/")) {
              return (
                <span className="block overflow-hidden rounded-md border">
                  <Image
                    src={s}
                    alt={alt ?? ""}
                    width={640}
                    height={400}
                    unoptimized
                    className="h-auto w-full max-w-md"
                  />
                </span>
              );
            }
            // corpus images are hotlinked from the public resources repo
            if (s.startsWith("https")) {
              // UX audit 2026-10-02 #21: bare <img> without dimensions — every
              // hotlinked note image reflowed the page while loading (CLS).
              // A fixed 16:9 box with object-contain reserves the layout: any
              // intrinsic ratio letterboxes inside, nothing shifts.
              return (
                <span className="mx-auto my-1 block aspect-video w-full max-w-[448px] overflow-hidden rounded-md border bg-muted/40 md:max-w-md">
                  <img
                    src={s}
                    alt={alt ?? ""}
                    loading="lazy"
                    className="size-full object-contain"
                  />
                </span>
              );
            }
            return <span className="text-sm italic text-muted-foreground">{alt}</span>;
          },
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b bg-muted/50 px-2.5 py-1.5 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border-b px-2.5 py-1.5 align-top">{children}</td>,
          blockquote: ({ node, children }) => {
            const variant = blockquoteVariant(node as HastNode);
            if (!variant) {
              return (
                <blockquote className="rounded-r-md border-l-2 border-primary/50 bg-primary/5 px-3 py-1.5 text-[13px]">
                  {children}
                </blockquote>
              );
            }
            return (
              <blockquote
                className={cn(
                  "rounded-r-md border-l-[3px] px-3 py-2 text-[13px]",
                  variant.className,
                )}
              >
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {variant.label}
                </span>
                {children}
              </blockquote>
            );
          },
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 text-[12px]">{children}</code>
          ),
        }}
      >
        {src}
      </ReactMarkdown>
    </div>
  );
}
