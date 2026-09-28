"use client";

/**
 * AnswerTextarea — the shared typed-answer surface (HUB-ANSWER-BOX wave 2;
 * wave 3b re-shelled to the SaveMyExams anatomy the operator pinned).
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
 * hidden under a @container (max-width: 540px) query), plus an
 * "Insert symbol" dropdown whose popover carries xs-bold legends over a
 * 7-column grid of square symbol buttons. The strip swallows mousedown on
 * its dead space so toggling tools never steals the caret (SME does the
 * same). The symbols groups "Mathematical" and "Greek letters" are SME's
 * verbatim lists; the wave-3 chemistry glyphs SME lacks keep their own
 * group.
 *
 * Wave 3d — the KEYBOARD look, matched to the keyboard that actually
 * appears in SME. SME's editor ships no popover palette at all: pressing
 * their math tools opens MathLive's stock VIRTUAL KEYBOARD — body-mounted
 * (no virtualKeyboardContainer override in any SME chunk), i.e. a
 * viewport-fixed bottom sheet at SME's --keyboard-zindex: 1055, styled
 * verbatim (recovered from the MathLive bundle in chunk 79d2298f + SME's
 * css_0308bb0b7a1ae6ad.css z-index override):
 *   light: sheet #cacfd7, top border #ddd, backdrop shadow
 *     0 -5px 6px rgba(0,0,0,.08); toolbar tabs (glyph labels — "123",
 *     italic "αβγ", "∞≠∈", "abc") text #2c2e2f at 135%, min 42×34,
 *     radius 8px, hover #eee, selected = accent #0c75d8 text + 2px
 *     underline, toolbar max-width 996px centered; keycaps white with a
 *     #e5e6e9 border and a #8d8f92 bottom edge (the 3D cap), radius 6px,
 *     height 60px, gap 8px, font clamp(16px,4cqw,24px), pressed = accent
 *     bg + white text; secondary action keys #a0a9b8 (hover #7d8795,
 *     bottom edge #989da6, text #060707, weight 600); row separators are
 *     1px white rules on the gray sheet.
 *   dark: sheet #151515, keycaps #1f2022 (hover #2f3032), text #e3e4e8,
 *     action keys #3d4144 (hover #4d5154), accent #0b5c9c, transparent
 *     borders — MathLive's own dark palette, mapped to the hub's class
 *     dark mode.
 * The sheet portals to document.body (MathLive mounts there too) and its
 * keys swallow mousedown so the textarea NEVER loses the caret — inserts
 * land exactly where the learner was typing, like the real keyboard.
 * Honest scope, unchanged from wave 3c: this is LOOK parity on the
 * plain-text Unicode keyboard, not a LaTeX editor. The tab strip reuses
 * MathLive's glyph-label register — "∞≠∈" for Mathematical (their symbols
 * album label), italic "αβγ" for Greek letters (their greek album label)
 * — and "₂⁺°" for Chemistry & notation, which is OURS (MathLive has no
 * chemistry album). Action row = [left] [right] [backspace ×2]
 * [hide-keyboard], all implementable exactly on a controlled textarea;
 * MathLive's undo/redo keys are NOT faked (a controlled React value has
 * no honest native-undo contract). "Insert equation" stays contract-gated
 * (wave 3c record). Keycap glyphs render in a serif stack as the closest
 * honest stand-in for SME's KaTeX_Main keycap font.
 *
 * This component mirrors that anatomy on the plain-text textarea:
 *   - collapsed = one line tall; ACTIVE (focused, has content, or a tool
 *     open) = the marks-proportional floor (rows = clamp(4, 2×marks, 10))
 *     over field-sizing-content growth, max-h-96 cap so long answers scroll
 *     internally and the strip stays reachable;
 *   - the tool strip (symbols / write / status / word count) renders only
 *     when active, attached below the box like SME's menu row;
 *   - the symbols keyboard (caret insert, preference under the
 *     syllabai-hub: namespaced localStorage key) portals to the viewport
 *     bottom as the wave-3d MathLive-look sheet;
 *   - wave-3 ink pad / photo → core transcription → insert-at-caret is
 *     session-gated (the spend is authenticated and per-learner — a button
 *     that always 401s would be dishonest);
 *   - Ctrl/Cmd+Enter delegates to onSubmitShortcut — the component never
 *     decides what "submit" means; real-evidence actions keep their
 *     deliberate gates on the surface;
 *   - persistence stays the SURFACE's concern: statusSlot/hintSlot let the
 *     exam player render its own derived save chip and its "saved in this
 *     browser" honesty copy inside the active state; this component still
 *     renders no save indicator of its own (session-only practice must not
 *     claim persistence);
 *   - placeholder heuristics read ONLY the stem's imperative verbs (a
 *     writing hint, never a fabricated marking policy), in SME's compact
 *     register with the SME default as the generic fallback;
 *   - a11y per the repo's axe gate: the label is programmatically
 *     associated (htmlFor/useId), toggles keep aria-expanded, focus is
 *     visible on the container, contrast-safe tokens only.
 *
 * Plain-text contract end-to-end: palette and transcription insert plain
 * text; core submitStructuredAttempt and the legacy /api/ai/mark read the
 * same string they always have.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Delete,
  Omega,
  PenLine,
  Upload,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AnswerInkPad, useHasLearnerSession } from "@/components/answer-ink-pad";

/**
 * localStorage key follows the syllabai-hub: namespacing convention
 * (progress.ts parity — a shared/demo key must never collide or wipe).
 */
const SYMBOLS_PREF_KEY = "syllabai-hub:answer-symbols-open";

/**
 * Toolbar symbol groups, in the pinned SME order. "Mathematical" and
 * "Greek letters" are SaveMyExams' VERBATIM bundle lists (question-player
 * chunk 3273, the eD constant feeding their Insert-symbol dropdown) — the
 * exact glyphs their expanded toolbar offers. "Chemistry & notation"
 * carries the wave-3 IGCSE set SME's lists lack (sub/superscripts,
 * charges, root/integral/sum), deduped against the SME groups so no glyph
 * ships twice. Everything inserts as plain text — the answer stays a
 * plain-text contract end-to-end (core submitStructuredAttempt and the
 * legacy /api/ai/mark read the same string they always have).
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
  "flex size-8 items-center justify-center rounded-[4px] text-foreground/90 hover:bg-muted aria-expanded:bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25";

/** SME MenuButton withLabel geometry, verbatim: auto width pill,
 *  padding-inline .5rem .75rem, label hidden when the box is narrow
 *  (their @container (max-width: 540px) rule). */
const MENU_BUTTON_PILL =
  "flex h-8 items-center gap-1 rounded-full pl-2 pr-3 text-[13px] font-medium text-foreground/90 hover:bg-muted aria-expanded:bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25";

/** MathLive virtual-keyboard palette, verbatim from SME's production
 *  MathLive bundle (light + dark theme blocks of the injected stylesheet;
 *  z-index from SME's own --keyboard-zindex override). Every value below
 *  traces to that stylesheet — nothing here is invented. */
const KB_SHEET =
  "fixed inset-x-0 bottom-0 z-[1055] border-t border-[#ddd] bg-[#cacfd7] pt-[5px] pb-[env(safe-area-inset-bottom)] shadow-[0_-5px_6px_rgba(0,0,0,0.08)] dark:border-transparent dark:bg-[#151515] dark:shadow-none";
const KB_TABS = "mx-auto flex min-h-8 max-w-[996px] items-end px-2";
const KB_TAB =
  "mx-0.5 flex min-h-[34px] min-w-[42px] items-center justify-center rounded-[8px] px-2.5 pb-2 pt-2 text-[135%] leading-none text-[#2c2e2f] hover:bg-[#eee] dark:text-[#e3e4e8] dark:hover:bg-[#303030]";
const KB_TAB_ACTIVE =
  "mb-2 rounded-none border-b-2 border-[#0c75d8] pb-1 text-[#0c75d8] hover:bg-transparent dark:border-[#0b5c9c] dark:text-[#0b5c9c] dark:hover:bg-transparent";
const KB_ROWS =
  "mx-auto max-w-[996px] divide-y divide-white px-2 dark:divide-[#303030]";
const KB_ROW = "grid grid-cols-10 gap-2 py-1";
const KB_KEY =
  "flex h-[60px] items-center justify-center rounded-[6px] border border-[#e5e6e9] border-b-[#8d8f92] bg-white font-serif text-[clamp(16px,4vw,24px)] leading-none text-black hover:bg-[#f5f5f7] active:bg-[#0c75d8] active:text-white dark:border-transparent dark:bg-[#1f2022] dark:text-[#e3e4e8] dark:active:bg-[#0b5c9c] dark:hover:bg-[#2f3032]";
const KB_ACTION =
  "flex h-[60px] items-center justify-center rounded-[6px] border border-[#e5e6e9] border-b-[#989da6] bg-[#a0a9b8] font-semibold text-[min(1rem,3.2vw)] leading-none text-[#060707] hover:bg-[#7d8795] active:bg-[#0c75d8] active:text-white dark:border-transparent dark:bg-[#3d4144] dark:text-[#e7ebee] dark:active:bg-[#0b5c9c] dark:hover:bg-[#4d5154]";

/** Tab strip labels, in MathLive's glyph-label register (their toolbar
 *  shows glyph sigils, not words). "∞≠∈" and italic "αβγ" are MathLive's
 *  verbatim album labels; "₂⁺°" is ours for Chemistry & notation —
 *  MathLive ships no chemistry album (documented honest substitution). */
const SYMBOL_TABS = SYMBOL_GROUPS.map((g, i) => ({
  label: ["∞≠∈", "αβγ", "₂⁺°"][i] ?? g.label,
  italic: i === 1,
}));

/** MathLive layers are 10 keycaps wide (their numeric layer: 10 keys per
 *  row) — our glyph groups chunk onto the same grid, ragged last rows and
 *  all, exactly like MathLive's separator-padded rows. */
const KB_COLS = 10;
const kbRows = (symbols: string[]): string[][] => {
  const rows: string[][] = [];
  for (let i = 0; i < symbols.length; i += KB_COLS) rows.push(symbols.slice(i, i + KB_COLS));
  return rows;
};

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
   *  associated with the textarea (htmlFor + useId fallback) */
  label?: string;
  placeholder: string;
  marks: number;
  /** Ctrl/Cmd+Enter inside the textarea → the surface's primary action
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
  // palette pref is read POST-hydration (latent wave-3b defect, fixed in
  // 3c): initializing state from localStorage during the first render made
  // SSR and a returning user's client disagree (React #418 hydration
  // mismatch on every load with the pref set). SSR and client now agree on
  // "closed"; the pref applies one tick after mount from a timer callback
  // (not synchronously in the effect body — react-hooks/set-state-in-effect).
  // Private-mode behavior is unchanged: a failed write keeps the palette
  // session-only and still working.
  const [symOpen, setSymOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setSymOpen(window.localStorage.getItem(SYMBOLS_PREF_KEY) === "1");
      } catch {
        // private mode — session-only default
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const [padOpen, setPadOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [focused, setFocused] = useState(false);
  const [symTab, setSymTab] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasSession = useHasLearnerSession();
  const autoId = useId();
  const inputId = id ?? autoId;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;

  /** SME activation: pristine until focused, typed into, or a tool is open */
  const active = focused || value.trim().length > 0 || symOpen || padOpen;

  /** insert at the caret; focus + caret placement restored after React
   *  commits the controlled value */
  const insertAtCaret = (ch: string) => {
    const el = taRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    onChange(value.slice(0, start) + ch + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + ch.length, start + ch.length);
    });
  };

  /** SME's "Upload" pill → our EXISTING wave-3 photo→core-transcribe
   *  flow: the file rides into the ink pad as pendingFile and goes through
   *  the same convert → editable-preview → insert-at-caret path (never a
   *  silent rewrite; the image is never stored). */
  const onUploadPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setPendingFile(file);
    setPadOpen(true);
  };

  const onFileConsumed = useCallback(() => setPendingFile(null), []);

  /** Keyboard action row — caret ops on the controlled textarea, exactly
   *  what MathLive's [left] [right] [backspace] [hide-keyboard] keys do
   *  on the mathfield. Undo/redo stay honest-absent (see header). */
  const caretMove = (dir: -1 | 1) => {
    const el = taRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const collapsed = start === end;
    const pos = Math.max(0, Math.min(value.length, collapsed ? start + dir : dir === -1 ? start : end));
    el.focus();
    el.setSelectionRange(pos, pos);
  };
  const backspaceAtCaret = () => {
    const el = taRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    if (start === end && start === 0) return;
    const nextStart = start === end ? start - 1 : start;
    onChange(value.slice(0, nextStart) + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextStart, nextStart);
    });
  };

  /** Keys must never steal the caret: mousedown's focus side-effect is
   *  swallowed (the canonical editor pattern — click still fires) so the
   *  textarea keeps focus and insertAtCaret lands where the learner was
   *  typing, exactly like MathLive's keyboard holds the mathfield. */
  const keepFocus = (e: ReactMouseEvent) => e.preventDefault();

  const toggleSymbols = () => {
    const next = !symOpen;
    setSymOpen(next);
    try {
      window.localStorage.setItem(SYMBOLS_PREF_KEY, next ? "1" : "0");
    } catch {
      // private mode — the preference is session-only, palette still works
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
      >
        <Textarea
          ref={taRef}
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (onSubmitShortcut && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSubmitShortcut();
            }
          }}
          // collapsed = a single line (SME: min-height 0); once active the
          // floor scales with the part's marks (a 6-mark answer starts
          // taller than a 1-mark one; SME's fixed 10rem sits inside this
          // range). The floor rides min-height because field-sizing:content
          // sizes to content and ignores rows — rows stay the fallback for
          // browsers without field-sizing. field-sizing does the growth,
          // the cap keeps the strip reachable for very long answers
          rows={active ? Math.min(10, Math.max(4, marks * 2)) : 1}
          style={{ minHeight: active ? `${Math.min(10, Math.max(4, marks * 2)) * 1.5}rem` : undefined }}
          aria-label={label ? undefined : ariaLabel}
          placeholder={placeholder}
          className="max-h-96 min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-4 shadow-none outline-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 aria-invalid:border-0 text-[13px] dark:bg-transparent md:text-sm"
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
                if (!t.closest("button, input")) e.preventDefault();
              }}
            >
              {/* SME's left group: icon-only square toggles. Ours carries
                  the Insert-symbol dropdown; SME's Italic/Sub/Sup are
                  rich-text toggles and stay honestly absent (plain text). */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleSymbols}
                  aria-expanded={symOpen}
                  aria-label="Insert symbol"
                  title="Insert symbol"
                  className={MENU_BUTTON_SQUARE}
                >
                  <Omega className="size-4" aria-hidden />
                </button>
              </div>
              {/* SME's right group: labeled pills (Write / Upload), pushed
                  to the strip's far edge by the space-between rhythm. */}
              <div className="ms-auto flex flex-wrap items-center gap-1">
                {/* wave 3: ink pad / photo → core transcription → plain
                    text at the caret (SaveMyExams-parity "Write", free/
                    no-card route). Hidden without a learner session — the
                    spend is authenticated and per-learner. */}
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
          onInsert={insertAtCaret}
          pendingFile={pendingFile}
          onFileConsumed={onFileConsumed}
        />
      )}
      {symOpen &&
        createPortal(
          <div
            role="group"
            aria-label="Math keyboard"
            data-testid="answer-keyboard"
            className={KB_SHEET}
          >
            {/* MathLive toolbar: glyph-label album tabs, selected tab gets
                the 2px accent underline; 135% labels, 42×34 minimum. */}
            <div role="tablist" aria-label="Keyboard layouts" className={KB_TABS}>
              {SYMBOL_GROUPS.map((group, i) => (
                <button
                  key={group.label}
                  type="button"
                  role="tab"
                  aria-selected={symTab === i}
                  onMouseDown={keepFocus}
                  onClick={() => setSymTab(i)}
                  className={cn(KB_TAB, symTab === i && KB_TAB_ACTIVE)}
                >
                  <span aria-hidden="true" className={cn(SYMBOL_TABS[i].italic && "italic")}>
                    {SYMBOL_TABS[i].label}
                  </span>
                  <span className="sr-only">{group.label}</span>
                </button>
              ))}
            </div>
            {/* Keycap rows on the gray sheet, 1px white rules between rows
                (MathLive's --_horizontal-rule), 10 caps per row. */}
            <div className={KB_ROWS}>
              {kbRows(SYMBOL_GROUPS[symTab]?.symbols ?? []).map((row, r) => (
                <div key={r} role="group" aria-label={`Keyboard row ${r + 1}`} className={KB_ROW}>
                  {row.map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onMouseDown={keepFocus}
                      onClick={() => insertAtCaret(ch)}
                      aria-label={`Insert ${ch}`}
                      className={KB_KEY}
                    >
                      <span aria-hidden="true">{ch}</span>
                    </button>
                  ))}
                </div>
              ))}
              {/* MathLive's action row — secondary keycaps. Ours carries the
                  four keys a controlled textarea implements exactly: caret
                  left/right, backspace (2-wide like their numeric layer),
                  hide-keyboard. Undo/redo honest-absent (header note). */}
              <div role="group" aria-label="Keyboard actions" className={KB_ROW}>
                <button type="button" onMouseDown={keepFocus} onClick={() => caretMove(-1)} aria-label="Move caret left" className={KB_ACTION}>
                  <ArrowLeft className="size-5" aria-hidden />
                </button>
                <button type="button" onMouseDown={keepFocus} onClick={() => caretMove(1)} aria-label="Move caret right" className={KB_ACTION}>
                  <ArrowRight className="size-5" aria-hidden />
                </button>
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <button type="button" onMouseDown={keepFocus} onClick={backspaceAtCaret} aria-label="Backspace" className={cn(KB_ACTION, "col-span-2")}>
                  <Delete className="size-5" aria-hidden />
                </button>
                <button type="button" onMouseDown={keepFocus} onClick={toggleSymbols} aria-expanded={symOpen} aria-label="Hide keyboard" title="Hide keyboard" className={KB_ACTION}>
                  <ChevronDown className="size-5" aria-hidden />
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
