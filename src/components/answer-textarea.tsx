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
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, PenLine, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AnswerInkPad, useHasLearnerSession } from "@/components/answer-ink-pad";

/**
 * localStorage key follows the syllabai-hub: namespacing convention
 * (progress.ts parity — a shared/demo key must never collide or wipe).
 */
const SYMBOLS_PREF_KEY = "syllabai-hub:answer-symbols-open";

/**
 * Notation typed IGCSE answers actually need: sub/superscripts, charges,
 * the equilibrium/direction arrows, degree, delta, multiplication sign —
 * plus the wave-3 maths group (roots, inequalities, integrals, sums) so
 * equations no longer force students onto ASCII approximations. Inserted
 * as plain text — the answer stays a plain-text contract end-to-end
 * (core submitStructuredAttempt and the legacy /api/ai/mark).
 */
const ANSWER_SYMBOLS = [
  "₂", "₃", "₄", "⁺", "⁻", "²", "³", "→", "⇌", "°", "Δ", "×",
  "√", "π", "≤", "≥", "≠", "≈", "±", "÷", "∫", "Σ", "∞", "⁄",
] as const;

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
  const [symOpen, setSymOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SYMBOLS_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [padOpen, setPadOpen] = useState(false);
  const [focused, setFocused] = useState(false);
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
    <div className={cn("min-w-0", className)}>
      {label && (
        <label htmlFor={inputId} className="mb-2 block text-sm font-bold text-foreground">
          {label}
        </label>
      )}
      {/* the box — mirrors SME's writtenMode (border + radius on the
          container, focus outline rides the container, editor is chromeless
          inside with 1rem padding) */}
      <div
        className={cn(
          "rounded-lg border border-input bg-background transition-colors",
          focused && "border-primary/50 ring-1 ring-primary/20",
        )}
      >
        <Textarea
          ref={taRef}
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          onFocus={() => setFocused(true)}
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
          className="max-h-96 min-h-0 w-full resize-none overflow-y-auto rounded-lg border-0 bg-transparent px-4 py-4 shadow-none outline-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 aria-invalid:border-0 text-[13px] dark:bg-transparent md:text-sm"
        />
      </div>
      {/* the active strip — mirrors SME's Editor_menu: attaches directly
          below the box, bottom corners rounded, top square against it */}
      {active && (
        <div className="rounded-b-lg border border-t-0 bg-background">
          <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={toggleSymbols}
              aria-expanded={symOpen}
              className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
            >
              <Type className="size-3.5" aria-hidden /> symbols
              {symOpen ? (
                <ChevronUp className="size-3" aria-hidden />
              ) : (
                <ChevronDown className="size-3" aria-hidden />
              )}
            </Button>
            {/* wave 3: ink pad / photo → core transcription → plain text at
                the caret (SaveMyExams-parity "Write", free/no-card route).
                Hidden without a learner session — the spend is authenticated
                and per-learner. */}
            {hasSession && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPadOpen((v) => !v)}
                aria-expanded={padOpen}
                className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
              >
                <PenLine className="size-3.5" aria-hidden /> write
                {padOpen ? (
                  <ChevronUp className="size-3" aria-hidden />
                ) : (
                  <ChevronDown className="size-3" aria-hidden />
                )}
              </Button>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {statusSlot}
              {wordCount > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {wordCount} word{wordCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
          {symOpen && (
            <div
              className="flex flex-wrap gap-1 border-t border-border/60 px-2 py-2"
              role="group"
              aria-label="Insert chemistry and maths symbols"
            >
              {ANSWER_SYMBOLS.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => insertAtCaret(ch)}
                  className="h-7 min-w-8 rounded-md border bg-background px-1.5 font-mono text-[13px] leading-none text-foreground/90 hover:bg-muted"
                  aria-label={`Insert ${ch}`}
                >
                  {ch}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {active && hintSlot && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{hintSlot}</p>
      )}
      {padOpen && hasSession && <AnswerInkPad onInsert={insertAtCaret} />}
    </div>
  );
}
