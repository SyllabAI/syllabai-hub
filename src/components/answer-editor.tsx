"use client";

/**
 * AnswerEditor — the rich-math editing core inside the SME-shelled answer
 * box (HUB-ANSWER-BOX wave 4: answer format v2, operator trace
 * 1a0ea6d4ca777a75 "Go on with updating the answer format"; wave 5: the
 * equation mathfield embedded in the text, operator trace
 * 1a0eb5e936962765 "Yes want the equation mathfield embedded in the text").
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
 * Wave 5 — THE MATHFIELD LIVES IN THE TEXT (the wave-4 record's own
 * refinement candidate: "SME edits the mathfield IN the text; ours is an
 * anchored popover"). The wave-4 popover retires:
 *   - an equation atom at rest renders static KaTeX inline;
 *   - clicking it swaps the SAME spot in the text flow to a live MathLive
 *     mathfield (SME's exact interaction — tapping an equation re-opens
 *     the math editor, in the text itself);
 *   - "Insert equation" drops a new atom at the caret already in edit
 *     mode — you type immediately, like SME;
 *   - the LaTeX is written back into the node live on every mathfield
 *     keystroke (so per-keystroke autosave tracks math exactly like
 *     text), and blur / Escape / tapping elsewhere commits and returns
 *     the atom to its static render; committing an empty field deletes
 *     the atom — the dialect never carries an invisible empty $…$;
 *   - the stock virtual keyboard still mounts body-fixed at SME's
 *     --keyboard-zindex: 1055 (their only override) and its theme tracks
 *     the hub's class dark mode.
 *
 * Italic / Subscript / Superscript remain real rich-text marks, and
 * undo/redo is REAL (TipTap history over the doc) — the w3d replica
 * keyboard honestly could not offer either.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Placeholder } from "@tiptap/extensions";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  normalizeMathPlaceholders,
  parseAnswerText,
  serializeAnswerDoc,
  type AnswerDoc,
} from "@/lib/answer-format";
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

/** The inline equation atom's node view — wave 5: the mathfield lives IN
 *  the text. At rest: static KaTeX (the atom's resting look). Click: the
 *  SAME spot in the text flow becomes a live MathLive mathfield. A freshly
 *  inserted empty atom mounts already editing (SME: insert and type).
 *  Commit = blur / Escape / selection moving away; an empty commit deletes
 *  the atom. NodeViewWrapper is TipTap's required React node-view host (a
 *  plain span breaks its mutation observer). */
function EquationView({
  node,
  selected,
  editor,
  getPos,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const latex = node.attrs.latex as string;
  const latexRef = useRef(latex);
  latexRef.current = latex;
  const [editing, setEditing] = useState(latex.trim().length === 0);
  const [ready, setReady] = useState(false);
  const mfRef = useRef<HTMLElement | null>(null);
  /** guards the selection-away commit against the mount tick (the
   *  NodeSelection prop can land one render after editing starts) */
  const sessionOpen = useRef(false);
  /** commit latch — a session closes exactly once (the unmount of the
   *  mathfield fires a stray blur that must never re-enter commit) */
  const closing = useRef(false);
  /** the sheet-settle re-scroll timer (cleared on unmount / session end) */
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // MathLive loads lazily, client-only (the module registers the
  // <math-field> custom element on import; it must never run during SSR).
  // The import is a cached module-level promise — every atom awaits the
  // same warm-up the parent started.
  useEffect(() => {
    let live = true;
    import("mathlive")
      .then(() => {
        if (live) setReady(true);
      })
      .catch(() => {
        // honest degradation: this atom stays a static KaTeX render;
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

  /** End the editing session: LaTeX back into the node (live writes made
   *  this a no-op when nothing changed since the last keystroke), the
   *  keyboard sheets down, the atom returns to its static render — or is
   *  deleted when empty, so no invisible empty $…$ can exist. */
  const commit = useCallback(
    (refocusAfter = false) => {
      if (closing.current) return;
      closing.current = true;
      const mf = mfRef.current as unknown as { value: string } | null;
      // empty placeholder scaffolding never enters the doc (wave 6: an
      // unfilled Insert-Matrix cell stores as an empty cell, never as the
      // \placeholder{} string KaTeX paints red)
      const next = normalizeMathPlaceholders(mf?.value ?? "").trim();
      try {
        (window as unknown as { mathVirtualKeyboard?: { hide: () => void } }).mathVirtualKeyboard?.hide();
      } catch {
        // keyboard display is progressive
      }
      setEditing(false);
      sessionOpen.current = false;
      if (!next) {
        deleteNode();
        return;
      }
      if (next !== latexRef.current.trim()) updateAttributes({ latex: next });
      if (refocusAfter && editor && typeof getPos() === "number") {
        // Escape: back into the text with the caret just AFTER the atom —
        // a plain focus() would restore the NodeSelection and the next
        // keystroke would replace the equation
        const after = Math.min((getPos() as number) + 1, editor.state.doc.content.size);
        editor.chain().focus().setTextSelection(after).run();
      }
    },
    [deleteNode, updateAttributes, getPos, editor],
  );

  /** MathLive's keyboard sheet is a body-fixed overlay: it covers the
   *  bottom of the viewport and MathLive only self-scrolls on its OWN
   *  toggle path — a programmatic show() (our session open) can leave the
   *  editing chip BEHIND the sheet, out of reach (wave 6 probe: the Menu
   *  toggle landed at y=749 under the sheet at y≤480). Walk the scrollable
   *  ancestors, then the window, until the chip clears the sheet's top
   *  edge. */
  const scrollAboveKeyboard = useCallback(() => {
    try {
      const mf = mfRef.current;
      if (!mf) return;
      // the sheet's visible edge is .MLK__backdrop; the outer .ML__keyboard
      // element is a full-viewport hit area whose top is always 0
      const sheet = document.querySelector(".MLK__backdrop") ?? document.querySelector(".ML__keyboard");
      if (!sheet) return;
      const sheetTop = sheet.getBoundingClientRect().top;
      const rect = mf.getBoundingClientRect();
      if (rect.bottom <= sheetTop) return;
      let remaining = rect.bottom - sheetTop + 16;
      let el: HTMLElement | null = mf as HTMLElement;
      while (el && remaining > 0) {
        el = el.parentElement;
        if (!el) break;
        const st = window.getComputedStyle(el);
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) {
          const before = el.scrollTop;
          el.scrollTop = before + remaining;
          remaining -= el.scrollTop - before;
        }
      }
      if (remaining > 0) window.scrollBy({ top: remaining, behavior: "smooth" });
    } catch {
      // scrolling is progressive — editing still works without it
    }
  }, []);

  // the editing session: fill the field, focus it, sheet the keyboard up.
  // MathLive's default keyboard policy auto-shows only on coarse pointers;
  // the reference product shows it on desktop too, so show it explicitly —
  // "the keyboard that appears in SME". The keyboard layer mounts on show,
  // so the theme attribute lands after a rAF re-check.
  useEffect(() => {
    if (!editing || !ready) return;
    closing.current = false;
    const mf = mfRef.current as unknown as { value: string; focus: () => void } | null;
    if (!mf) return;
    mf.value = latexRef.current;
    mf.focus();
    const raf = requestAnimationFrame(() => {
      applyKeyboardTheme();
      try {
        (window as unknown as { mathVirtualKeyboard?: { show: () => void } }).mathVirtualKeyboard?.show();
        applyKeyboardTheme();
        scrollAboveKeyboard();
        // the sheet's mount animation settles — re-check once it does
        const t = setTimeout(scrollAboveKeyboard, 380);
        settleTimer.current = t;
      } catch {
        // keyboard display is progressive — editing still works without it
      }
    });
    // the session opens one tick after mount — the selection-away guard
    // must not see "not selected" from the mount render and insta-commit
    const t = setTimeout(() => {
      sessionOpen.current = true;
    }, 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = null;
    };
  }, [editing, ready, applyKeyboardTheme, scrollAboveKeyboard]);

  // live write-back + commit-on-blur, as native listeners on the custom
  // element. While the session is open the mathfield OWNS its value —
  // attrs flow OUT to the doc (and the autosave), never back into the
  // field, so re-renders can't clobber typing or move the field's caret.
  useEffect(() => {
    if (!editing || !ready) return;
    const mf = mfRef.current;
    if (!mf) return;
    const onInput = () => {
      const raw = (mf as unknown as { value: string }).value;
      // wave 6: MathLive serializes unfilled Insert-Matrix cells as
      // \placeholder{} — scaffolding, stripped before it touches the doc
      const next = normalizeMathPlaceholders(raw);
      if (next.trim() && next !== latexRef.current) {
        updateAttributes({ latex: next });
        // setNodeMarkup demotes the session's NodeSelection (TipTap maps it
        // off the replaced node) — re-pin it so the editing session survives
        // its own write-back and `selected` stays truthful for the
        // selection-away guard below
        const pos = getPos();
        if (typeof pos === "number") {
          const sel = editor.state.selection;
          if (!(sel instanceof NodeSelection && sel.from === pos)) {
            editor.commands.setNodeSelection(pos);
          }
        }
      }
    };
    const onBlur = () => {
      // a field being unmounted by its own commit fires a stray blur —
      // not a user action (the commit latch also guards this)
      if (!mf.isConnected) return;
      // the virtual keyboard is body-mounted and focus-safe (MathLive
      // keeps its keys from stealing focus); commit only when focus
      // really left this field's session
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.closest?.("math-field") || el.closest?.(".ML__keyboard"))) return;
      commit();
    };
    const onKeyDown = (ev: Event) => {
      // capture ON THE HOST — fires before anything inside the shadow
      // tree can see it; Escape commits and returns to the text
      if ((ev as KeyboardEvent).key === "Escape") {
        // wave 6: while the STOCK menu is open (Menu button ▸ Insert
        // Matrix ▸ …), Escape must dismiss ONLY the menu — MathLive's
        // own keydown handler on the scrim closes it; committing here
        // would unmount the mathfield and take the menu down with it.
        // A second Escape (menu closed) still commits, unchanged.
        const shadow = (mf as unknown as { shadowRoot?: ShadowRoot | null }).shadowRoot;
        if (shadow?.querySelector(".ui-menu-container")) return;
        ev.stopPropagation();
        commit(true);
      }
    };
    mf.addEventListener("input", onInput);
    mf.addEventListener("blur", onBlur);
    mf.addEventListener("keydown", onKeyDown, true);
    return () => {
      mf.removeEventListener("input", onInput);
      mf.removeEventListener("blur", onBlur);
      mf.removeEventListener("keydown", onKeyDown, true);
    };
  }, [editing, ready, updateAttributes, commit, editor, getPos]);

  // ProseMirror moved the selection away (a click into the text, another
  // equation, a toolbar action) — the session ends, like SME committing
  // when you tap elsewhere
  useEffect(() => {
    if (editing && !selected && sessionOpen.current) commit();
  }, [editing, selected, commit]);

  const html = useMemo(() => {
    try {
      return katex.renderToString(latex || "\\?", { throwOnError: false });
    } catch {
      return latex;
    }
  }, [latex]);

  if (editing && ready) {
    return (
      <NodeViewWrapper as="span" className="answer-equation answer-equation--editing">
        <math-field ref={mfRef} className="answer-mathfield" math-virtual-keyboard-policy="manual" />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      // the atom is a deliberate click target: selecting it opens the
      // inline mathfield, exactly like tapping an equation re-opens the
      // math editor on the reference product — in the text itself
      role="button"
      tabIndex={-1}
      className={cn("answer-equation", selected && "answer-equation--selected")}
      onMouseDown={(e: React.MouseEvent) => {
        e.preventDefault();
        const pos = getPos();
        if (typeof pos === "number") {
          editor.commands.setNodeSelection(pos);
          setEditing(true);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export type AnswerEditorHandle = {
  /** toggle a mark at the current selection (focus preserved) */
  toggleMark: (mark: "italic" | "subscript" | "superscript") => void;
  /** insert a new equation atom at the caret — the atom mounts already
   *  editing INLINE (wave 5: the mathfield lives in the text; the wave-4
   *  anchored popover retires). Editing an EXISTING equation = click it. */
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
>(function AnswerEditor({ value, onChange, ariaLabel, ariaLabelledBy, placeholder, onStateChange, minHeight, id }, ref) {
  const lastEmitted = useRef<string>(value);
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

  // MathLive warm-up, client-only (the module registers the <math-field>
  // custom element on import; it must never run during SSR). The equation
  // node views await the same cached import. This also pins SME's only
  // keyboard override: the keyboard sheet sits at z-index 1055.
  useEffect(() => {
    let live = true;
    import("mathlive")
      .then(() => {
        if (!live) return;
        document.documentElement.style.setProperty("--keyboard-zindex", KEYBOARD_ZINDEX);
      })
      .catch(() => {
        // honest degradation: equations stay static KaTeX; text + symbols
        // + ink still work
      });
    return () => {
      live = false;
    };
  }, []);

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
        // wave 5: no popover — drop an empty atom at the caret and select
        // it; the node view mounts already editing (empty latex ⇒ editing)
        // and owns the mathfield + keyboard in the text itself
        editor.chain().focus().insertContent({ type: "answerEquation", attrs: { latex: "" } }).run();
        const from = editor.state.selection.from;
        editor.commands.setNodeSelection(Math.max(0, from - 1));
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
    [editor],
  );

  return (
    <EditorContent
      editor={editor}
      style={minHeight ? { minHeight } : undefined}
      className="answer-editor-area max-h-96 overflow-y-auto px-4 py-4 text-[13px] md:text-sm"
    />
  );
});
