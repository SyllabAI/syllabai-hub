"use client";

/**
 * Per-deck due chip (tranche 4.6, unified T-C57) — reads this browser's
 * rating trail UNIONED with the account's core review-schedule feed (the
 * pilot course, signed in — lib/flashcard-unified.ts) and shows how many
 * cards of the deck are due for review right now (the same Ebbinghaus
 * schedule the drawer's "Flashcards due" section and the deck player's
 * "Review due first" run on). Renders nothing until the union says so:
 * decks never rated anywhere show no badge rather than an empty promise.
 */
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useCourseProgress, type Course } from "@/lib/progress";
import { unifiedDueCountBySubtopic, useCoreReviewSchedule } from "@/lib/flashcard-unified";

export function DeckDueBadge({
  course,
  subtopicCode,
}: {
  course: Course;
  subtopicCode: string;
}) {
  const progress = useCourseProgress(course);
  const core = useCoreReviewSchedule(course);
  const due = useMemo(
    () =>
      unifiedDueCountBySubtopic(progress.flashcards, core.source, Date.now()).get(
        subtopicCode,
      ) ?? 0,
    [progress.flashcards, core.source, subtopicCode],
  );
  if (due === 0) return null;
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-warn/40 text-[10px] text-warn"
      title={
        core.state === "ready"
          ? `${due} card${due === 1 ? "" : "s"} in this deck are due for review again (this device ∪ your account)`
          : `${due} card${due === 1 ? "" : "s"} in this deck are due for review again`
      }
    >
      {due} due
    </Badge>
  );
}
