/**
 * rehype-katex with a hard mhchem guarantee (s142).
 *
 * WHY THIS EXISTS: the upstream rehype-katex imports `katex` itself, and
 * under several module loaders (bun's runtime CJS-interop in particular)
 * that import lands on a DIFFERENT katex module instance than the one app
 * code reaches — so the documented "import 'katex/contrib/mhchem' before
 * rehype-katex" pattern registered \ce/\pu on an instance nothing renders
 * through, and every \ce{} rendered as red error text (the 09-27 CLA
 * report). Importing BOTH katex and the mhchem side-effect in THIS module
 * makes the renderer and the macro registration share one instance by
 * construction — in webpack, turbopack and the bun runtime alike.
 *
 * Behaviour is a faithful port of rehype-katex@7.0.1 (remarkjs,
 * MIT): language-math / math-display / math-inline elements render through
 * katex.renderToString (throwOnError first, then the red-source retry),
 * ```math code blocks promote to display mode, KaTeX's HTML output is
 * parsed into hast in place.
 */
import katex from "katex";
import "katex/contrib/mhchem";
import { fromHtmlIsomorphic } from "hast-util-from-html-isomorphic";
import { toText } from "hast-util-to-text";
import { SKIP, visitParents } from "unist-util-visit-parents";
import type { Element, ElementContent, Root } from "hast";
import type { VFile } from "vfile";

type KatexRenderOptions = Parameters<typeof katex.renderToString>[1];
export type RehypeKatexMhchemOptions = Partial<
  Omit<NonNullable<KatexRenderOptions>, "displayMode" | "throwOnError">
>;

const EMPTY_CLASSES: ReadonlyArray<unknown> = [];

/** rehype plugin: render math elements with KaTeX + mhchem (see header) */
export function rehypeKatexMhchem(options?: RehypeKatexMhchemOptions | null) {
  const settings = options ?? {};

  return function transform(tree: Root, file: VFile) {
    visitParents(
      tree,
      "element",
      function (element: Element, parents: Array<Root | Element>) {
        const classes = Array.isArray(element.properties?.className)
          ? (element.properties.className as ReadonlyArray<unknown>)
          : EMPTY_CLASSES;
        // ```math fences carry language-math
        const languageMath = classes.includes("language-math");
        // remark-math flow math (block, $$…$$) carries math-display
        const mathDisplay = classes.includes("math-display");
        // remark-math text math (inline, $…$) carries math-inline
        const mathInline = classes.includes("math-inline");
        let displayMode = mathDisplay;

        if (!languageMath && !mathDisplay && !mathInline) return;

        let parent: Root | Element | undefined = parents[parents.length - 1];
        let scope: Element = element;

        // ```math was rendered as <pre><code> — replace the <pre>, display mode
        if (
          element.tagName === "code" &&
          languageMath &&
          parent &&
          parent.type === "element" &&
          (parent as Element).tagName === "pre"
        ) {
          scope = parent as Element;
          parent = parents[parents.length - 2];
          displayMode = true;
        }

        if (!parent) return;

        const value = toText(scope, { whitespace: "pre" });

        let result: Array<ElementContent> | string | undefined;

        try {
          result = katex.renderToString(value, {
            ...settings,
            displayMode,
            throwOnError: true,
          } as KatexRenderOptions);
        } catch (error) {
          file.message("Could not render math with KaTeX", {
            ancestors: [...parents, element],
            cause: error as Error,
            place: element.position,
            ruleId: String((error as Error)?.name ?? "Error").toLowerCase(),
            source: "rehype-katex-mhchem",
          });

          // KaTeX should handle ParseError itself (red source, not a crash)
          try {
            result = katex.renderToString(value, {
              ...settings,
              displayMode,
              strict: "ignore",
              throwOnError: false,
            } as KatexRenderOptions);
          } catch {
            result = [
              {
                type: "element",
                tagName: "span",
                properties: {
                  className: ["katex-error"],
                  style: "color:" + (settings.errorColor || "#cc0000"),
                  title: String(error),
                },
                children: [{ type: "text", value }],
              },
            ];
          }
        }

        if (typeof result === "string") {
          const root = fromHtmlIsomorphic(result, { fragment: true });
          result = root.children as Array<ElementContent>;
        }

        const children = parent.children as Array<ElementContent>;
        const index = children.indexOf(scope);
        children.splice(index, 1, ...(result as Array<ElementContent>));
        return SKIP;
      },
    );
  };
}
