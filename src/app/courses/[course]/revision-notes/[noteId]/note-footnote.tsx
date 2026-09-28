"use client";

/**
 * Note-page client island: (1) fires the read event so the sidebar rings
 * react like SME's (research §8), and — when the course is the 4CH1 pilot
 * and the learner is signed in — ALSO reports the view to syllabai-core
 * (revision-notes progress feeds the backend's learner model), and (2)
 * renders the "Was this revision note helpful?" micro-feedback footer
 * (research §5.4). The helpful rating always lands on the local overlay;
 * tranche 4.9 additionally mirrors it to the learner's core account as
 * append-only self-report evidence (lib/note-vote-bridge — pilot + signed
 * in + reachable only, every negative degrades silently, never mastery).
 */
import { useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markNoteRead, rateNoteHelpful, useCourseProgress, type Course } from "@/lib/progress";
import { api } from "@/lib/api";
import { submitNoteVote } from "@/lib/note-vote-bridge";
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
  // tranche 4.9 honesty line: did the vote also reach the core account?
  // null until the first vote's mirror resolves (the local overlay holds it
  // either way — the footer never blocks on the answer)
  const [voteSync, setVoteSync] = useState<null | "account" | "local-signed-out" | "local-unreachable">(null);

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

  const castVote = (v: "up" | "down") => {
    rateNoteHelpful(course, noteId, v);
    // tranche 4.9: best-effort core mirror (pilot + signed in + anchor
    // resolved only) — the local overlay already holds the vote; a vote
    // change is a new append-only event and core's latest row wins
    if (!subtopic) return;
    void submitNoteVote(course, noteId, v, subtopic).then((outcome) => {
      if (outcome.kind === "synced") setVoteSync("account");
      else if (outcome.reason === "signed out") setVoteSync("local-signed-out");
      else setVoteSync("local-unreachable");
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      <p className="text-sm font-medium">Was this revision note helpful?</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={voted === "up" ? "default" : "outline"}
          className="gap-1.5"
          onClick={() => castVote("up")}
          aria-pressed={voted === "up"}
        >
          <ThumbsUp className="size-3.5" aria-hidden /> Yes
        </Button>
        <Button
          size="sm"
          variant={voted === "down" ? "default" : "outline"}
          className="gap-1.5"
          onClick={() => castVote("down")}
          aria-pressed={voted === "down"}
        >
          <ThumbsDown className="size-3.5" aria-hidden /> No
        </Button>
      </div>
      {voted && (
        <p className="text-xs text-muted-foreground">
          {voteSync === "account"
            ? "Thanks — recorded to your account as self-report evidence."
            : voteSync === "local-signed-out"
              ? "Thanks — recorded to your local overlay. Sign in to also keep votes on your account."
              : voteSync === "local-unreachable"
                ? "Thanks — recorded to your local overlay (your account is unreachable right now)."
                : "Thanks — recorded."}
        </p>
      )}
    </div>
  );
}
