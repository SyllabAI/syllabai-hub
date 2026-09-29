"use client";

/**
 * AnswerEditor — the rich-math editing core inside the SME-shelled answer
 * box (HUB-ANSWER-BOX wave 4: answer format v2, operator trace
 * 1a0ea6d4ca777a75 "Go on with updating the answer format").
 *
 * Stack = the stack verified inside SaveMyExams' production bundle
 * (research trace, chunk 79d2298f): TipTap (MIT) as the editor core —
 * this is literally where their `contenteditable="tiptap ProseMirror"`
 * ground-truth DOM comes from — and MathLive (MIT) as the equation editor
 * whose stock virtual keyboard is "the keyboard that appears in SME".
 * Rendering of equations rides the repo's existing KaTeX (MIT, with the
 * mhchem extension already wired for chemistry).
 *
 * The editor owns the dialect boundary: every keystroke is serialized
 * through src/lib/answer-format.ts into the answer-format-v2 string the
 * surface stores and submits; every external value (a saved draft, or
 * transcription output) is parsed the same way. Legacy v1 plain-text
 * answers parse as plain text — nothing to migrate.
 *
 * What this wave adds, matching SME's toolbar anatomy:
 *   - Italic / Subscript / Superscript — real rich-text marks (the wave-3c
 *     record kept them honest-absent under the v1 plain-text contract);
 *   - Insert equation — an inline atom rendered by KaTeX, edited in a
 *     MathLive mathfield. SME embeds the mathfield in the text itself; we
 *     open it in an anchored popover carrying the SAME mathfield + the
 *     SAME stock keyboard, documented in the TODO row as the wave-4
 *     refinement candidate.
 * The MathLive virtual keyboard mounts body-fixed like SME's
 * (--keyboard-zindex: 1055, their only override) and its theme tracks the
 * hub's class dark mode.
 *
 * Undo/redo is REAL here (TipTap history over the doc) — unlike the w3d
 * replica keyboard, which honestly could not offer it on controlled
 * textarea state.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Placeholder } from "@tiptap/extensions";
import { Node, mergeAttributes } from "@tiptap/core";
import katex from "katex";
import "katex/dist/katex.min.css";
import { parseAnswerText, serializeAnswerDoc, type AnswerDoc } from "@/lib/answer-format";
import { cn } from "@/lib/utils";

// (ambient typings for <math-field> live in src/types/answer-editor.d.ts —
// module namespaces are not allowed in source files under this lint config)

/** SME's only keyboard override, verbatim from their css bundle: the
 *  MathLive keyboard sheet sits at z-index 1055. */
const KEYBOARD_ZINDEX = "1055";

/** The inline math atom. Serialized as $latex$ by answer-format. */
const AnswerEquation = Node.create({
  name: "answerEquation",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { latex: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "span[data-answer-equation]" }];
  },

  renderHTML({ node }) {
    return [
      "span",
      mergeAttributes({ "data-answer-equation": "", "data-latex": node.attrs.latex as string }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EquationView);
  },
});

/** KaTeX-rendered equation atom; click selects the node and opens the
 *  mathfield popover pre-filled (SME: tapping an equation re-opens the
 *  math editor). NodeViewWrapper is TipTap's required React node-view
 *  host (a plain span breaks its mutation observer). */
function EquationView({ node, selected, editor, getPos }: NodeViewProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(node.attrs.latex || "\\?", { throwOnError: false });
    } catch {
      return node.attrs.latex;
    }
  }, [node.attrs.latex]);

  return (
    <NodeViewWrapper
      as="span"
      // the atom is a deliberate click target: selecting it opens the
      // equation editor, exactly like tapping an equation re-opens the
      // math editor on the reference product
      role="button"
      tabIndex={-1}
      className={cn("answer-equation", selected && "answer-equation--selected")}
      onMouseDown={(e: React.MouseEvent) => {
        e.preventDefault();
        const pos = getPos();
        if (typeof pos === "number") {
          editor.commands.focus();
          editor.commands.setNodeSelection(pos);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export type AnswerEditorHandle = {
  /** toggle a mark at the current selection (focus preserved) */
  toggleMark: (mark: "italic" | "subscript" | "superscript") => void;
  /** open the equation popover ("insert" mode), or edit the currently
   *  selected equation atom ("edit" mode — pre-filled) */
  openEquation: () => void;
  /** insert raw text at the caret; parseMath=true routes transcription
   *  output through the v2 parser so $…$ spans land as equation atoms */
  insertText: (text: string, parseMath?: boolean) => void;
  /** current mark state at the selection (drives the toolbar pressed styles) */
  markState: () => { italic: boolean; subscript: boolean; superscript: boolean };
  /** whether an equation atom is currently selected */
  equationSelected: () => boolean;
};

export const AnswerEditor = forwardRef<
  AnswerEditorHandle,
  {
    value: string;
    onChange: (next: string) => void;
    ariaLabel: string;
    ariaLabelledBy?: string;
    placeholder: string;
    /** equation popover asked to open from outside (the toolbar button) */
    onEquationPopoverChange?: (open: boolean) => void;
    /** fired on every editor transaction: the live mark state at the
     *  selection — the parent toolbar's pressed styles + guards read this */
    onStateChange?: (state: { italic: boolean; subscript: boolean; superscript: boolean; equation: boolean }) => void;
    /** the active-state min-height floor (marks-proportional), applied to
     *  the editor area — the collapsed state passes undefined (one line) */
    minHeight?: string;
    /** wired onto the editable region as the label's htmlFor target
     *  (SME's label→editor association) */
    id?: string;
  }
>(function AnswerEditor(
  { value, onChange, ariaLabel, ariaLabelledBy, placeholder, onEquationPopoverChange, onStateChange, minHeight, id },
  ref,
) {
  const lastEmitted = useRef<string>(value);
  const [equationOpen, setEquationOpen] = useState(false);
  const [mathliveReady, setMathliveReady] = useState(false);
  const [equationDraft, setEquationDraft] = useState("");
  /** "insert" puts a new atom at the caret; "edit" rewrites the selection */
  const equationMode = useRef<"insert" | "edit">("insert");
  const mfRef = useRef<HTMLElement | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        bold: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        horizontalRule: false,
        link: false,
        underline: false,
        dropcursor: false,
        gapcursor: false,
        // italic stays ON (from the kit) — one of the wave-4 rich marks
        // undoRedo stays ON — a real undo is one of the things the w3d
        // replica honestly could not offer (see header)
      }),
      Subscript,
      Superscript,
      AnswerEquation,
      Placeholder.configure({ placeholder }),
    ],
    content: parseAnswerText(value),
    editorProps: {
      attributes: {
        // SME ground truth: translate=no on the editable region; the
        // tiptap/ProseMirror classes are TipTap's own defaults. The id is
        // the label's htmlFor target (SME's label→editor association).
        translate: "no",
        role: "textbox",
        "aria-multiline": "true",
        ...(id ? { id } : {}),
        ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : { "aria-label": ariaLabel }),
      },
    },
    onUpdate: ({ editor: e }) => {
      const next = serializeAnswerDoc(e.getJSON() as unknown as AnswerDoc);
      lastEmitted.current = next;
      onChange(next);
    },
    onTransaction: ({ editor: e }) => {
      onStateChangeRef.current?.({
        italic: e.isActive("italic"),
        subscript: e.isActive("subscript"),
        superscript: e.isActive("superscript"),
        equation: e.state.doc.nodeAt(e.state.selection.from)?.type.name === "answerEquation",
      });
    },
  }, [placeholder]);

  // external value changes (draft load, transcription-adjacent writes the
  // surface performs) re-enter the doc; our own emissions do not (they
  // would reset the caret + undo stack on every keystroke)
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(parseAnswerText(value), { emitUpdate: false });
  }, [value, editor]);

  // MathLive loads lazily, client-only (the module registers the
  // <math-field> custom element on import; it must never run during SSR)
  useEffect(() => {
    let live = true;
    import("mathlive")
      .then(() => {
        if (!live) return;
        document.documentElement.style.setProperty("--keyboard-zindex", KEYBOARD_ZINDEX);
        setMathliveReady(true);
      })
      .catch(() => {
        // honest degradation: the popover mathfield stays unavailable;
        // text + symbols + ink still work
      });
    return () => {
      live = false;
    };
  }, []);

  /** MathLive's keyboard palette tracks the hub's class dark mode. The
   *  palette CSS keys on a `theme` attribute on an ANCESTOR of the
   *  .ML__keyboard element (MathLive 0.110 renders the keyboard as a div
   *  inside a body-mounted layer), so the attribute goes on that layer. */
  const applyKeyboardTheme = useCallback(() => {
    try {
      const dark = document.documentElement.classList.contains("dark");
      const kb = document.querySelector(".ML__keyboard");
      const host = kb?.parentElement ?? null;
      if (host) host.setAttribute("theme", dark ? "dark" : "light");
    } catch {
      // keyboard theme is cosmetic — never block editing
    }
  }, []);

  useEffect(() => {
    if (equationOpen && mfRef.current) {
      const mf = mfRef.current as unknown as { value: string; focus: () => void };
      mf.value = equationDraft;
      mf.focus();
      // MathLive's default keyboard policy only auto-shows on coarse
      // pointers; the reference product shows the keyboard on desktop too,
      // so show it explicitly — this is "the keyboard that appears in SME".
      // Theme first, then a rAF re-check (the keyboard layer mounts on
      // show, so the attribute must land after the element exists).
      requestAnimationFrame(() => {
        applyKeyboardTheme();
        try {
          (window as unknown as { mathVirtualKeyboard?: { show: () => void } })
            .mathVirtualKeyboard?.show();
          applyKeyboardTheme();
        } catch {
          // keyboard display is progressive — editing still works without it
        }
      });
    }
  }, [equationOpen, mathliveReady, equationDraft, applyKeyboardTheme]);

  const closeEquation = useCallback(
    (apply: boolean) => {
      if (apply && editor) {
        const mf = mfRef.current as unknown as { value: string } | null;
        const latex = (mf?.value ?? "").trim();
        if (latex) {
          if (equationMode.current === "edit") {
            editor.chain().focus().updateAttributes("answerEquation", { latex }).run();
          } else {
            editor.chain().focus().insertContent({ type: "answerEquation", attrs: { latex } }).run();
          }
        } else {
          editor.commands.focus();
        }
      }
      setEquationOpen(false);
      onEquationPopoverChange?.(false);
    },
    [editor, onEquationPopoverChange],
  );

  useImperativeHandle(
    ref,
    () => ({
      toggleMark: (mark) => {
        if (!editor) return;
        const chain = editor.chain().focus();
        if (mark === "italic") chain.toggleItalic();
        else if (mark === "subscript") chain.toggleSubscript();
        else chain.toggleSuperscript();
        chain.run();
      },
      openEquation: () => {
        if (!editor) return;
        const sel = editor.state.selection;
        const node = editor.getAttributes("answerEquation");
        const editing = editor.state.doc.nodeAt(sel.from)?.type.name === "answerEquation";
        equationMode.current = editing ? "edit" : "insert";
        setEquationDraft(editing ? (node.latex as string) ?? "" : "");
        setEquationOpen(true);
        onEquationPopoverChange?.(true);
      },
      insertText: (text, parseMath) => {
        if (!editor) return;
        if (parseMath) {
          const docNodes = parseAnswerText(text).content;
          editor.chain().focus().insertContent(docNodes).run();
        } else {
          editor.chain().focus().insertContent(text).run();
        }
      },
      markState: () => ({
        italic: !!editor?.isActive("italic"),
        subscript: !!editor?.isActive("subscript"),
        superscript: !!editor?.isActive("superscript"),
      }),
      equationSelected: () => {
        const s = editor?.state;
        if (!s) return false;
        return s.doc.nodeAt(s.selection.from)?.type.name === "answerEquation";
      },
    }),
    [editor, onEquationPopoverChange],
  );

  return (
    <>
      <EditorContent
        editor={editor}
        style={minHeight ? { minHeight } : undefined}
        className="answer-editor-area max-h-96 overflow-y-auto px-4 py-4 text-[13px] md:text-sm"
      />
      {equationOpen && (
        // the equation popover — a small white card under the box, SME's
        // popover shadow; the MathLive mathfield inside brings the stock
        // virtual keyboard (the keyboard that appears in SME)
        <div className="answer-equation-popover mt-2 rounded-lg border border-input bg-background p-2 shadow-[0_4px_30px_rgba(59,68,89,0.16)]">
          {/* the action row rides ABOVE the mathfield: the MathLive keyboard
              sheets over the viewport bottom and would pin a footer row
              underneath it — unreachable exactly when it's needed (caught
              by the browser probe) */}
          <div className="flex items-center justify-between pb-1">
            <p className="px-1 text-xs font-semibold text-muted-foreground">
              {equationMode.current === "edit" ? "Edit equation" : "Insert equation"}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => closeEquation(false)}
                className="flex h-8 items-center rounded-full px-3 text-[13px] font-medium text-foreground/90 hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => closeEquation(true)}
                className="flex h-8 items-center rounded-full bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                {equationMode.current === "edit" ? "Update" : "Insert"}
              </button>
            </div>
          </div>
          {mathliveReady ? (
            <math-field
              ref={mfRef}
              className="answer-mathfield"
              math-virtual-keyboard-policy="manual"
              // mathlive dispatches input on every keystroke; we read the
              // value on Insert — no React state in the typing loop
            />
          ) : (
            <p className="px-2 py-3 text-[13px] text-muted-foreground">Loading the equation editor…</p>
          )}
        </div>
      )}
    </>
  );
});
