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
 * Honest-absent (plain-text contract, NOT faked with lookalikes): SME's
 * Italic/Subscript/Superscript are rich-text toggles over markdown
 * storage and "Insert equation" is the MathLive LaTeX editor — all three
 * are deferred pending the answer-format contract decision.
 *
 * This component mirrors that anatomy on the plain-text textarea:
 *   - collapsed = one line tall; ACTIVE (focused, has content, or a tool
 *     open) = the marks-proportional floor (rows = clamp(4, 2×marks, 10))
 *     over field-sizing-content growth, max-h-96 cap so long answers scroll
 *     internally and the strip stays reachable;
 *   - the tool strip (symbols / write / status / word count) renders only
 *     when active, attached below the box like SME's menu row;
 *   - the symbols palette (caret insert, preference under the syllabai-hub:
 *     namespaced localStorage key) opens inside the strip block;
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
import type { ChangeEvent, ReactNode } from "react";
import { Omega, PenLine, Upload } from "lucide-react";
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

/** SME Symbols_menu popover: padding .25rem, border, their exact ambient
 *  shadow (0 4px 30px rgba(59,68,89,.16)). */
const SYMBOLS_PANEL =
  "m-1 mt-0 rounded-md border bg-muted/40 p-1 shadow-[0_4px_30px_0_rgba(59,68,89,0.16)]";

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
            {symOpen && (
              <div className={SYMBOLS_PANEL}>
                {SYMBOL_GROUPS.map((group) => (
                  <fieldset key={group.label}>
                    <legend className="px-2 pt-1.5 text-xs font-bold text-foreground">
                      {group.label}
                    </legend>
                    <div
                      role="group"
                      aria-label={`Insert ${group.label.toLowerCase()} symbols`}
                      className="grid grid-cols-7 gap-1 p-1 pb-2"
                    >
                      {group.symbols.map((ch) => (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => insertAtCaret(ch)}
                          aria-label={`Insert ${ch}`}
                          className={MENU_BUTTON_SQUARE}
                        >
                          <span aria-hidden="true" className="font-mono text-sm">{ch}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            )}
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
    </div>
  );
}
