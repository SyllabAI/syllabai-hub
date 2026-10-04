"use client";

/**
 * Per-sub-topic progress ring — the demo analogue of the SME circular
 * indicator that appears on every sidebar tree row (research §8). Driven by
 * the browser-local SIMULATED progress overlay only.
 */
import { useCourseProgress, type Course } from "@/lib/progress";
import { formatPercent, roundPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ProgressRing({
  course,
  subtopic,
  counts,
  size = 18,
  className,
}: {
  course: Course;
  /** sub-topic code the ring is computed for */
  subtopic: string | null;
  counts: { notes: number; questions: number; flashcards: number };
  size?: number;
  className?: string;
}) {
  const progress = useCourseProgress(course);
  const radius = (size - 3) / 2;
  const c = 2 * Math.PI * radius;

  let percent = 0;
  if (subtopic) {
    const k = counts;
    const total = k.notes + k.questions + k.flashcards;
    if (total > 0) {
      const notes = Object.values(progress.notesRead).filter((v) => v.subtopic === subtopic).length;
      const questions =
        Object.values(progress.selfScores).filter((v) => v.subtopic === subtopic).length +
        Object.values(progress.mcqAnswers).filter((v) => v.subtopic === subtopic).length;
      const cards = Object.values(progress.flashcards).filter((v) => v.subtopic === subtopic).length;
      const done =
        Math.min(notes, k.notes) + Math.min(questions, k.questions) + Math.min(cards, k.flashcards);
      // UX audit 2026-10-02 #17: one-decimal precision — Math.round made the
      // first completed item read as "0%" in the aria label and tooltip
      percent = roundPercent((done / total) * 100);
    }
  }

  const complete = percent >= 100;
  const started = percent > 0;

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      role="img"
      aria-label={`Progress: ${formatPercent(percent)}`}
      title={complete ? "Complete" : started ? formatPercent(percent) : "Not started"}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={2}
          className={complete ? "stroke-primary" : "stroke-muted-foreground/30"}
        />
        {started && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={2}
            stroke="currentColor"
            strokeDasharray={`${(c * percent) / 100} ${c}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className="text-primary transition-[stroke-dasharray] duration-500"
          />
        )}
        {complete && <circle cx={size / 2} cy={size / 2} r={radius - 3} className="fill-primary" />}
      </svg>
    </span>
  );
}
