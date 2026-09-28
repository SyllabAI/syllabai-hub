"use client";

/**
 * Per-deck due chip (tranche 4.6) — reads this browser's rating trail and
 * shows how many cards of the deck are due for review right now (the same
 * Ebbinghaus schedule the drawer's "Flashcards due" section and the deck
 * player's "Review due first" run on — lib/flashcard-review.ts). Renders
 * nothing until the trail says so: decks never rated show no badge rather
 * than an empty promise.
 */
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useCourseProgress, type Course } from "@/lib/progress";
import { dueCountBySubtopic } from "@/lib/flashcard-review";

export function DeckDueBadge({
  course,
  subtopicCode,
}: {
  course: Course;
  subtopicCode: string;
}) {
  const progress = useCourseProgress(course);
  const due = useMemo(
    () => dueCountBySubtopic(progress.flashcards, Date.now()).get(subtopicCode) ?? 0,
    [progress.flashcards, subtopicCode],
  );
  if (due === 0) return null;
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-warn/40 text-[10px] text-warn"
      title={`${due} card${due === 1 ? "" : "s"} in this deck are due for review again`}
    >
      {due} due
    </Badge>
  );
}
