"use client";

/**
 * Exam-series picker + countdown chip (T-C79, ADR-035 D1 ruling
 * 2026-10-04): the learner's one bounded, optional, editable, clearable
 * target-series declaration for a course. A native select over the
 * IMPORTED calendar rows — the learner picks an id, they never type a
 * date (the rejected learner-entered option stands rejected).
 *
 * Honesty posture (the lib/exam-series module owns the degradation rules):
 *  - unavailable (signed out / core behind the contract) → renders nothing;
 *  - empty calendar → a disabled select with the honest hint, never a
 *    fake list;
 *  - a declared target shows its derived countdown with the "≈" mark when
 *    the sitting is estimated, plus the "entries closed" fact — both are
 *    core-computed at read (ADR-031), never invented client-side;
 *  - provenance rides every row (Pearson source document + retrieved-at):
 *    the select's tooltip states the CORE_MEASURED posture.
 */
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { api } from "@/lib/api";
import {
  countdownText,
  fetchExamCalendar,
  notifyExamTargetsChanged,
  qualForLevel,
  useExamCalendar,
} from "@/lib/exam-series";
import type { CourseExamTargetView } from "@/lib/types";

export function ExamSeriesPicker({
  slug,
  level,
  target,
  compact = false,
}: {
  slug: string;
  /** the hub registry level (content/courses.json — Edexcel lanes only) */
  level: string;
  /** undefined = availability unknown → no surface; null = nothing declared */
  target: CourseExamTargetView | null | undefined;
  /** compact = inline on subject cards; full = the add-course overlay row */
  compact?: boolean;
}) {
  const calendar = useExamCalendar(qualForLevel(level));
  const [busy, setBusy] = useState(false);

  if (calendar === null) return null;

  const set = async (seriesId: string) => {
    if (!seriesId || busy) return;
    setBusy(true);
    try {
      if (seriesId === "__clear__") {
        await api.clearExamSeriesTarget(slug);
        notifyExamTargetsChanged();
      } else {
        await api.setExamSeriesTarget(slug, seriesId);
        notifyExamTargetsChanged();
      }
    } catch {
      // a failed declaration leaves the previous state untouched — no word
    } finally {
      setBusy(false);
    }
  };

  const width = compact ? "max-w-[15rem]" : "max-w-full";

  if (calendar.length === 0) {
    // the honest empty state: nothing imported yet — a dead-looking but
    // truthful control, never a placeholder row
    return (
      <select
        aria-label={`Exam series for ${slug} (none imported yet)`}
        disabled
        className={`h-7 w-full truncate rounded-md border border-dashed bg-transparent px-1.5 text-xs text-muted-foreground ${width}`}
      >
        <option>No exam series imported yet</option>
      </select>
    );
  }

  return (
    <div className={`flex items-center gap-1.5 ${width}`}>
      <CalendarClock
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <select
        aria-label={`Exam series for ${slug}`}
        title="Measured from the official Pearson key-dates documents — estimated windows are marked ≈"
        value={target ? target.seriesId : ""}
        disabled={busy}
        onChange={(e) => set(e.target.value)}
        className={`h-7 w-full min-w-0 truncate rounded-md border bg-transparent px-1.5 text-xs ${
          target
            ? "border-primary/40 font-medium text-foreground"
            : "border-dashed text-muted-foreground"
        }`}
      >
        <option value="">Set exam series… (optional)</option>
        {calendar.map((s) => (
          <option key={s.id} value={s.id}>
            {s.estimated ? "≈ " : ""}
            {s.label}
            {s.entryDeadline ? ` · enter by ${s.entryDeadline}` : ""}
          </option>
        ))}
        {target && <option value="__clear__">Not sure yet — clear</option>}
      </select>
      {target && (
        <span
          className={`shrink-0 whitespace-nowrap text-[11px] font-semibold tabular-nums ${
            target.entryDeadlinePassed ? "text-destructive" : "text-muted-foreground"
          }`}
          title={
            target.entryDeadlinePassed
              ? "The entry deadline for this sitting has passed"
              : "From the official Pearson timetable (measured)"
          }
        >
          {countdownText(target)}
        </span>
      )}
    </div>
  );
}

/** re-exported for overlay consumers that want to warm the cache */
export { fetchExamCalendar };
