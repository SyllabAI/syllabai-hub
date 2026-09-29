"use client";

/**
 * AnswerTextarea — the shared typed-answer surface (HUB-ANSWER-BOX wave 2;
 * wave 3b re-shelled to the SaveMyExams anatomy the operator pinned; wave 4
 * puts the rich-math editor core inside the same shell).
 *
 * Ground truth (operator DOM paste + SME production CSS, extracted from the
 * four cdn.savemyexams.com bundles): a bold label above a single clean box
 * (1px border, ~8px radius, white background, 1rem padding) that "looks
 * normal at first" and ACTIVATES on focus — the box grows to a working
 * height and the options strip attaches directly below it (flex-wrap,
 * ~0.5rem padding, bottom corners rounded, top square against the box).
 * While collapsed, nothing but label + box + placeholder renders
 * (SME: `.Editor_collapsed .tiptap { min-height:0 }`; options live in
 * `.Editor_menu`, focus outline rides the container via :focus-within).
 *
 * Wave 3c — the EXPANDED toolbar look, matched to the component bundle:
 * SME's question-player chunk pins the menu anatomy verbatim (Editor_menu +
 * MenuButton/Symbols CSS modules): a white flex-wrap strip with gap .25rem,
 * padding .5rem (.25rem under a 768px viewport) and bottom-only radius,
 * holding an icon-only 2rem square group on the left and labeled pill
 * buttons on the right (radius 50rem, padding-inline .5rem .75rem, labels
 * hidden under a @container (max-width: 540px) query). The strip swallows
 * mousedown on its dead space so toggling tools never steals the caret
 * (SME does the same). The symbols groups "Mathematical" and "Greek
 * letters" are SME's verbatim lists; the wave-3 chemistry glyphs SME lacks
 * keep their own group.
 *
 * Wave 3d → wave 4 — THE KEYBOARD, resolved: wave 3d replicated MathLive's
 * stock virtual keyboard over the plain textarea. Wave 4 supersedes the
 * replica with the REAL thing: "Insert equation" opens a MathLive
 * mathfield (MIT — the verified SME math editor) whose own stock virtual
 * keyboard mounts body-fixed at SME's --keyboard-zindex: 1055, themed by
 * the hub's class dark mode. The replica sheet retires — a real keyboard
 * beats a faithful copy, and real undo/redo arrives with TipTap history.
 * The Ω square returns to SME's Insert-symbol dropdown species (the
 * wave-3c popover anatomy) inserting Unicode glyphs at the rich caret.
 *
 * Wave 4 — the answer format contract, updated (operator trace
 * 1a0ea6d4ca777a75): the editor core is TipTap (MIT — the verified SME
 * editor; the `contenteditable="tiptap ProseMirror"` ground-truth DOM),
 * carrying Italic / Subscript / Superscript marks (honest-absent since
 * wave 3c under the plain-text contract) and the inline equation atom
 * rendered by KaTeX. Every keystroke serializes through
 * src/lib/answer-format.ts to the answer-format-v2 string — Markdown with
 * embedded LaTeX math and limited inline HTML, the dialect the corpus
 * renderer already interprets; legacy plain-text answers remain valid.
 * Storage, the 4000-char cap, per-keystroke autosave semantics and both
 * mark lanes are untouched (the string is still just a string).
 *
 * Wave 5 — the mathfield moves INTO the text (operator trace
 * 1a0eb5e936962765 "Yes want the equation mathfield embedded in the text",
 * the green light on wave 4's recorded refinement candidate): the wave-4
 * anchored popover retires — clicking an equation edits it in place and
 * "Insert equation" drops an atom at the caret already editing, exactly
 * like SME. Zero contract delta; the Insert-equation button is a plain
 * action again (no open/close state to track).
 *
 * Wave 7 — the symbols palette goes fully TRANSIENT (operator bug report,
 * trace 1a0ec11bc830f67d: on Exam Questions the Mathematics / Greek
 * letters / Chemistry palette "stays opened up by default, cant close it
 * as well"). Two mechanical defects, both retired: (1) wave 3c persisted
 * the palette's open-state in localStorage ("syllabai-hub:answer-symbols-open")
 * and re-applied it one tick after hydration, so any browser that had ever
 * toggled Ω loaded with the palette ALREADY expanded — an Insert-symbol
 * dropdown is a transient surface (SME's own is), it does not outlive the
 * page; the pref and its mount-time effect are gone and the stale key is
 * swept once so affected browsers self-heal. (2) the palette was a
 * CONTROLLED Radix Popover wired without onOpenChange, so every dismiss
 * path Radix offers — outside pointer-down, Escape, focus-away — routed
 * to a no-op and the layer stayed mounted; Radix's onOpenChange is now
 * the single source of truth and every dismiss path closes the palette.
 *
 * Unchanged honesty behaviors:
 *   - wave-3 ink pad / photo → core transcription → insert at the caret,
 *     session-gated (the spend is authenticated and per-learner — a button
 *     that always 401s would be dishonest); transcription output is now
 *     parsed through the v2 dialect so handwritten math lands as rendered
 *     equation atoms;
 *   - Ctrl/Cmd+Enter delegates to onSubmitShortcut — the component never
 *     decides what "submit" means; real-evidence actions keep their
 *     deliberate gates on the surface;
 *   - persistence stays the SURFACE's concern: statusSlot/hintSlot let the
 *     exam player render its own derived save chip and its "saved in this
 *     browser" honesty copy inside the active state; this component still
 *     renders no save indicator of its own (session-only practice must not
 *     claim persistence);
 *   - placeholder heuristics read ONLY the stem's imperative verbs (a
 *     writing hint, never a fabricated marking policy), rendered by
 *     TipTap's placeholder extension — SME's exact p[data-placeholder]
 *     mechanism;
 *   - a11y per the repo's axe gate: the label is programmatically
 *     associated (aria-labelledby on the editable region, SME's own
 *     pattern), toggles keep aria-expanded/aria-pressed, focus is visible
 *     on the container, contrast-safe tokens only.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import {
  ChevronDown,
  Italic as ItalicIcon,
  Omega,
  PenLine,
  SquareRadical,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AnswerEditor,
  type AnswerEditorHandle,
} from "@/components/answer-editor";
import { AnswerInkPad, useHasLearnerSession } from "@/components/answer-ink-pad";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Wave 7: the wave-3c persisted open-pref key, kept ONLY as the name of
 * the thing to sweep — the palette no longer reads or writes it.
 */
const LEGACY_SYMBOLS_PREF_KEY = "syllabai-hub:answer-symbols-open";

/**
 * Toolbar symbol groups, in the pinned SME order. "Mathematical" and
 * "Greek letters" are SaveMyExams' VERBATIM bundle lists (question-player
 * chunk 3273, the eD constant feeding their Insert-symbol dropdown) — the
 * exact glyphs their expanded toolbar offers. "Chemistry & notation"
 * carries the wave-3 IGCSE set SME's lists lack (sub/superscripts,
 * charges, root/integral/sum), deduped against the SME groups so no glyph
 * ships twice. Everything inserts as plain Unicode text at the rich
 * caret — math proper goes through the equation editor.
 */
const SYMBOL_GROUPS: { label: string; symbols: string[] }[] = [
  {
    label: "Mathematical",
    symbols: ["+", "−", "±", "×", "·", "=", "≠", "≈", "<", ">", "≤", "≥", "→", "⇌", "°", "%", "∝", "⊥", "∥"],
  },
  {
    label: "Greek letters",
    symbols: ["α", "β", "γ", "Δ", "δ", "ε", "η", "θ", "λ", "μ", "ν", "π", "ρ", "∑", "σ", "τ", "Φ", "φ", "ψ", "Ω", "ω"],
  },
  {
    label: "Chemistry & notation",
    symbols: ["₂", "₃", "₄", "⁺", "⁻", "²", "³", "√", "÷", "∫", "Σ", "∞", "⁄"],
  },
];

/** SME MenuButton geometry, verbatim: 2rem transparent square, .25rem
 *  radius, neutral hover/active fill, 4px brand halo on keyboard focus. */
const MENU_BUTTON_SQUARE =
  "flex size-8 items-center justify-center rounded-[4px] text-foreground/90 hover:bg-muted aria-expanded:bg-muted aria-pressed:bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25";

/** SME MenuButton withLabel geometry, verbatim: auto width pill,
 *  padding-inline .5rem .75rem, label hidden when the box is narrow
 *  (their @container (max-width: 540px) rule). */
const MENU_BUTTON_PILL =
  "flex h-8 items-center gap-1 rounded-full pl-2 pr-3 text-[13px] font-medium text-foreground/90 hover:bg-muted aria-expanded:bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25";

/** SME Insert-symbol popover: xs-bold legends over a 7-column grid of
 *  square symbol buttons, their exact popover shadow. */
const SYMBOL_LEGEND = "text-xs font-bold text-foreground";
const SYMBOL_GRID = "grid grid-cols-7 gap-1";
const SYMBOL_BUTTON =
  "flex size-8 items-center justify-center rounded-[4px] border border-input bg-background text-sm hover:bg-muted";

/**
 * Answer-shape-aware placeholder derived ONLY from the stem's imperative
 * verbs — a writing hint, never a marking expectation (no fabricated
 * exam policy; the marks chip stays the honest contract). Compact register
 * per the pinned SME ground truth; the generic fallback is SME's own
 * placeholder, verbatim.
 */
export function answerPlaceholder(problemMd: string): string {
  const s = problemMd.toLowerCase();
  if (/\b(calculate|determine|compute|work out)\b/.test(s)) {
    return "Show your working…";
  }
  if (/\b(balance|equation)\b/.test(s)) {
    return "Write the equation…";
  }
  if (/\b(explain|describe|suggest|state|give)\b/.test(s)) {
    return "Answer in clear points…";
  }
  return "Enter your answer here...";
}

export function AnswerTextarea({
  value,
  onChange,
  ariaLabel,
  id,
  label,
  placeholder,
  marks,
  onSubmitShortcut,
  onBlur,
  statusSlot,
  hintSlot,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  id?: string;
  /** SME-style bold label rendered above the box; programmatically
   *  associated with the editable region (aria-labelledby + useId) */
  label?: string;
  placeholder: string;
  marks: number;
  /** Ctrl/Cmd+Enter inside the editor → the surface's primary action
   *  (already gated by the surface; omitted = no shortcut on this surface) */
  onSubmitShortcut?: () => void;
  onBlur?: () => void;
  /** surface-owned status rendered at the strip's right (save chip, lane
   *  badge) — visible only while the box is active, like SME's menu */
  statusSlot?: ReactNode;
  /** surface-owned muted line rendered under the strip (honesty copy such
   *  as where the draft is stored) — visible only while active */
  hintSlot?: ReactNode;
  className?: string;
}) {
  // Wave 7: the palette is transient — ALWAYS closed on load, no persisted
  // pref, no post-hydration correction (SSR and client agree on "closed").
  // The wave-3c key is swept once so browsers that stored it self-heal.
  const [symOpen, setSymOpen] = useState(false);
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_SYMBOLS_PREF_KEY);
    } catch {
      // private mode — nothing stored to remove
    }
  }, []);
  const [padOpen, setPadOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [focused, setFocused] = useState(false);
  /** live mark state at the editor selection (drives aria-pressed) */
  const [markState, setMarkState] = useState({ italic: false, subscript: false, superscript: false, equation: false });
  const editorRef = useRef<AnswerEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasSession = useHasLearnerSession();
  const autoId = useId();
  const inputId = id ?? autoId;
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;

  /** SME activation: pristine until focused, typed into, or a tool is open */
  const active = focused || value.trim().length > 0 || symOpen || padOpen;

  /** the marks-proportional floor (a 6-mark answer starts taller than a
   *  1-mark one; SME's fixed 10rem sits inside this range) — rides
   *  min-height on the editor area while active */
  const floorRows = Math.min(10, Math.max(4, marks * 2));

  /** wave 3: ink pad / photo → core transcription → v2 text at the caret
   *  (SaveMyExams-parity "Write", free/no-card route). $…$ spans land as
   *  rendered equation atoms; words land as text. */
  const onTranscriptionInsert = useCallback((text: string) => {
    editorRef.current?.insertText(text, true);
  }, []);

  /** SME's "Upload" pill → the EXISTING wave-3 photo→core-transcribe
   *  flow: the file rides into the ink pad as pendingFile and goes through
   *  the same convert → editable-preview → insert-at-caret path (never a
   *  silent rewrite; the image is never stored). */
  const onUploadPicked = (e: ReactChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setPendingFile(file);
    setPadOpen(true);
  };

  const onFileConsumed = useCallback(() => setPendingFile(null), []);

  /** Keys must never steal the caret: mousedown's focus side-effect is
   *  swallowed (the canonical editor pattern — click still fires) so the
   *  editor keeps its selection, exactly like SME's menu. */
  const keepFocus = (e: ReactMouseEvent) => e.preventDefault();

  const onWrapperKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // the equation mathfield owns Enter — a shortcut keystroke typed while
    // editing math must never submit the answer (wave 5: the mathfield
    // lives inline in the editor area, so the guard keys on math-field)
    if ((e.target as HTMLElement).closest("math-field")) return;
    if (onSubmitShortcut && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmitShortcut();
    }
  };

  return (
    <div className={cn("@container", "min-w-0", className)}>
      {label && (
        <label htmlFor={inputId} className="mb-2 block text-sm font-bold text-foreground">
          {label}
        </label>
      )}
      {/* the composite box — mirrors SME's writtenMode: ONE bordered
          container holding the editor area and (when active) the menu strip
          attached below it; the focus outline rides the container via
          :focus-within exactly like SME's
          .Editor_writtenMode:focus-within, so tabbing into the tools keeps
          the ring just as it does on the real editor */}
      <div
        className="overflow-hidden rounded-lg border border-input bg-background transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
        // activation tracks the COMPOSITE (SME verbatim: their blur handler
        // drops focus state only when relatedTarget leaves the wrapper —
        // focus moving into the toolbar must not tear the strip down, or
        // the click never lands on the button it was meant for)
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocused(false);
            onBlur?.(); // surface autosave flush — the learner left the box
          }
        }}
        onKeyDown={onWrapperKeyDown}
      >
        {/* collapsed = one line tall (SME: min-height 0); once active the
            floor scales with the part's marks. The rich editor grows with
            its content naturally, capped at max-h-96 so long answers
            scroll internally and the strip stays reachable */}
        <AnswerEditor
          ref={editorRef}
          value={value}
          onChange={onChange}
          ariaLabel={ariaLabel}
          ariaLabelledBy={label ? inputId : undefined}
          id={label ? inputId : undefined}
          placeholder={placeholder}
          minHeight={active ? `${floorRows * 1.5}rem` : undefined}
          onStateChange={setMarkState}
        />
        {/* the active strip — mirrors SME's Editor_menu, verbatim anatomy:
            flex-wrap, gap .25rem, space-between (left icon group vs right
            pill group), white surface, .5rem padding (.25rem under 768px),
            attached below the box with bottom-only radius. Mousedown on
            dead space is swallowed exactly like SME's menu so the caret
            never moves when a tool is toggled. */}
        {active && (
          <div className="border-t border-border/60">
            <div
              className="flex flex-wrap items-center gap-1 p-2 max-md:p-1"
              onMouseDown={(e) => {
                const t = e.target as HTMLElement;
                if (!t.closest("button, input, math-field")) e.preventDefault();
              }}
            >
              {/* SME's left group: icon-only square toggles — wave 4 makes
                  Italic/Sub/Sup real (contract-gated until now), plus the
                  equation editor and the Insert-symbol dropdown. */}
              <div className="flex items-center gap-1" onMouseDown={keepFocus}>
                <button
                  type="button"
                  onClick={() => editorRef.current?.toggleMark("italic")}
                  aria-pressed={markState.italic}
                  aria-label="Italic"
                  title="Italic"
                  className={MENU_BUTTON_SQUARE}
                >
                  <ItalicIcon className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => editorRef.current?.toggleMark("subscript")}
                  aria-pressed={markState.subscript}
                  aria-label="Subscript"
                  title="Subscript"
                  className={MENU_BUTTON_SQUARE}
                >
                  <SubscriptIcon className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => editorRef.current?.toggleMark("superscript")}
                  aria-pressed={markState.superscript}
                  aria-label="Superscript"
                  title="Superscript"
                  className={MENU_BUTTON_SQUARE}
                >
                  <SuperscriptIcon className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    editorRef.current?.openEquation();
                  }}
                  aria-label="Insert equation"
                  title="Insert equation"
                  className={MENU_BUTTON_SQUARE}
                >
                  <SquareRadical className="size-4" aria-hidden />
                </button>
                <Popover open={symOpen} onOpenChange={setSymOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-expanded={symOpen}
                      aria-label="Insert symbol"
                      title="Insert symbol"
                      className={MENU_BUTTON_SQUARE}
                    >
                      <Omega className="size-4" aria-hidden />
                      <ChevronDown className="-ms-1 size-3 text-muted-foreground" aria-hidden />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-auto space-y-2 p-3 shadow-[0_4px_30px_rgba(59,68,89,0.16)]"
                  >
                    {SYMBOL_GROUPS.map((group) => (
                      <div key={group.label} className="space-y-1.5">
                        <p className={SYMBOL_LEGEND}>{group.label}</p>
                        <div className={SYMBOL_GRID}>
                          {group.symbols.map((ch) => (
                            <button
                              key={ch}
                              type="button"
                              onClick={() => editorRef.current?.insertText(ch)}
                              aria-label={`Insert ${ch}`}
                              className={SYMBOL_BUTTON}
                            >
                              <span aria-hidden="true">{ch}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
              {/* SME's right group: labeled pills (Write / Upload), pushed
                  to the strip's far edge by the space-between rhythm. */}
              <div className="ms-auto flex flex-wrap items-center gap-1">
                {/* wave 3: ink pad / photo → core transcription → text at
                    the caret (SaveMyExams-parity "Write", free/no-card
                    route). Hidden without a learner session — the spend is
                    authenticated and per-learner. */}
                {hasSession && (
                  <button
                    type="button"
                    onClick={() => setPadOpen((v) => !v)}
                    aria-expanded={padOpen}
                    aria-label="Write"
                    title="Write"
                    className={MENU_BUTTON_PILL}
                  >
                    <PenLine className="size-4 shrink-0" aria-hidden />
                    <span className="@max-[540px]:hidden">Write</span>
                  </button>
                )}
                {hasSession && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Upload"
                    title="Upload"
                    className={MENU_BUTTON_PILL}
                  >
                    <Upload className="size-4 shrink-0" aria-hidden />
                    <span className="@max-[540px]:hidden">Upload</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onUploadPicked}
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                />
                {/* wave-1/3 honesty chrome — surface-owned status rides the
                    strip's right edge, visually subordinate to the tools */}
                <div className="ms-2 flex flex-wrap items-center gap-2">
                  {statusSlot}
                  {wordCount > 0 && (
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {wordCount} word{wordCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {active && hintSlot && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{hintSlot}</p>
      )}
      {padOpen && hasSession && (
        <AnswerInkPad
          onInsert={onTranscriptionInsert}
          pendingFile={pendingFile}
          onFileConsumed={onFileConsumed}
        />
      )}
    </div>
  );
}
