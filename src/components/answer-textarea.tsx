"use client";

/**
 * AnswerTextarea — the shared typed-answer surface (HUB-ANSWER-BOX wave 2).
 *
 * Extracted from the exam-questions TypedAnswerWorkspace and adopted by the
 * practice player so every answer surface behaves identically:
 *   - marks-proportional floor (rows = clamp(4, 2×marks, 10)) over the
 *     primitive's field-sizing-content growth, with a max-h-96 cap so the
 *     action row stays reachable (long answers scroll internally);
 *   - the chemistry symbols palette (caret insert, collapsed by default,
 *     preference under the syllabai-hub: namespaced localStorage key);
 *   - a live word count in the aux row;
 *   - Ctrl/Cmd+Enter delegated to the surface's own primary action via
 *     onSubmitShortcut — the component never decides what "submit" means.
 *     Real-evidence actions (core attempt submission) keep their deliberate
 *     gates; surfaces wire only what is safe to fire from the keyboard.
 *
 * Honesty rules carried from wave 1: placeholder heuristics read ONLY the
 * stem's imperative verbs (a writing hint, never a fabricated marking
 * policy); palette inserts plain text (the answer stays a plain-text
 * contract end-to-end); persistence is the SURFACE's concern — the exam
 * player autosaves per keystroke and shows its own derived "saved" chip,
 * while practice is session-only by design, so this component renders no
 * save indicator at all.
 */
import { useRef, useState } from "react";
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
 * exam policy; the marks chip stays the honest contract).
 */
export function answerPlaceholder(problemMd: string): string {
  const s = problemMd.toLowerCase();
  if (/\b(calculate|determine|compute|work out)\b/.test(s)) {
    return "Show your working — set out each step as you would in the exam…";
  }
  if (/\b(balance|equation)\b/.test(s)) {
    return "Write the equation — include state symbols if the question asks…";
  }
  if (/\b(explain|describe|suggest|state|give)\b/.test(s)) {
    return "Answer in clear points — one idea per point…";
  }
  return "Write your answer as you would in the exam…";
}

export function AnswerTextarea({
  value,
  onChange,
  ariaLabel,
  id,
  placeholder,
  marks,
  onSubmitShortcut,
  onBlur,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  id?: string;
  placeholder: string;
  marks: number;
  /** Ctrl/Cmd+Enter inside the textarea → the surface's primary action
   *  (already gated by the surface; omitted = no shortcut on this surface) */
  onSubmitShortcut?: () => void;
  onBlur?: () => void;
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
  const hasSession = useHasLearnerSession();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;

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
    <>
      <Textarea
        ref={taRef}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (onSubmitShortcut && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSubmitShortcut();
          }
        }}
        // floor scales with the part's marks (a 6-mark answer starts
        // taller than a 1-mark one); field-sizing-content in the primitive
        // does the growth on modern browsers, the cap keeps the action row
        // reachable for very long answers (older browsers scroll instead)
        rows={Math.min(10, Math.max(4, marks * 2))}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={cn("min-h-24 max-h-96 overflow-y-auto bg-background text-[13px]", className)}
      />
      <div className="mt-1.5 flex items-center gap-2">
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
        {/* wave 3: ink pad / photo → core transcription → plain text at the
            caret (SaveMyExams-parity "Write"/"Upload", free/no-card route).
            Hidden without a learner session — the spend is authenticated and
            per-learner, and a button that always 401s would be dishonest. */}
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
        {wordCount > 0 && (
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            {wordCount} word{wordCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {padOpen && hasSession && (
        <AnswerInkPad onInsert={insertAtCaret} />
      )}
      {symOpen && (
        <div
          className="mt-1 flex flex-wrap gap-1"
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
    </>
  );
}
