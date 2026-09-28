"use client";

/**
 * Note-page client island: (1) fires the read event so the sidebar rings
 * react like SME's (research §8), and — when the course is the 4CH1 pilot
 * and the learner is signed in — ALSO reports the view to syllabai-core
 * (revision-notes progress feeds the backend's learner model), and (2)
 * renders the "Was this revision note helpful?" micro-feedback footer
 * (research §5.4). The helpful rating stays on the local overlay — core has
 * no votes contract yet (tracked gap, honest as ever).
 */
import { useEffect } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markNoteRead, rateNoteHelpful, useCourseProgress, type Course } from "@/lib/progress";
import { api } from "@/lib/api";
import { fetchPilotInfo, coreEvidenceChanged } from "@/lib/attempt-bridge";

export function NoteFootnote({
  course,
  noteId,
  subtopic,
}: {
  course: Course;
  noteId: string;
  subtopic: string | null;
}) {
  const progress = useCourseProgress(course);
  // derived from the overlay store — no local mirror state needed
  const voted = progress.notesRead[noteId]?.helpful ?? null;

  useEffect(() => {
    markNoteRead(course, noteId, subtopic);
    // 4CH1 bridge: the same view becomes real evidence on the learner's core
    // account. Fire-and-forget with the pilot check — a note read must never
    // block rendering, and non-pilot courses stay local-only by design.
    let cancelled = false;
    fetchPilotInfo(course).then((pilot) => {
      if (cancelled || !pilot) return;
      api
        .markRevisionNoteViewed(noteId)
        .then(() => coreEvidenceChanged())
        .catch(() => {
          /* view stays local — honest, silent, non-blocking */
        });
    });
    return () => {
      cancelled = true;
    };
  }, [course, noteId, subtopic]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      <p className="text-sm font-medium">Was this revision note helpful?</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={voted === "up" ? "default" : "outline"}
          className="gap-1.5"
          onClick={() => rateNoteHelpful(course, noteId, "up")}
          aria-pressed={voted === "up"}
        >
          <ThumbsUp className="size-3.5" aria-hidden /> Yes
        </Button>
        <Button
          size="sm"
          variant={voted === "down" ? "default" : "outline"}
          className="gap-1.5"
          onClick={() => rateNoteHelpful(course, noteId, "down")}
          aria-pressed={voted === "down"}
        >
          <ThumbsDown className="size-3.5" aria-hidden /> No
        </Button>
      </div>
      {voted && <p className="text-xs text-muted-foreground">Thanks — recorded to your local overlay.</p>}
    </div>
  );
}
