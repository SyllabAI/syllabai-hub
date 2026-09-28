"use client";

/**
 * note-vote-bridge — client half of the note-vote evidence class (ADR-029
 * tranche 4.9). Mirrors the flashcard-bridge honesty rules exactly:
 *
 *   - every negative (not the pilot / signed out / core down / unknown
 *     anchor) degrades to the local experience — the vote always lands in
 *     the browser-local overlay, the footer never blocks, never spins;
 *   - votes go to core ONLY as self-report evidence (append-only trail):
 *     they never touch BKT/SkillState/misconceptions — mastery comes from
 *     marked attempts only, and a vote is never a content-quality verdict
 *     (the content pipeline's VALIDATED states are operator-owned);
 *   - on success the `syllabai:core-evidence` event fires, so the KG / My
 *     State surfaces re-derive from core promptly.
 *
 * No module state: the local overlay (lib/progress.ts) stays the source of
 * truth for the vote UI; this helper is the core-side mirror, best-effort
 * by design. Idempotence is event-level (append-only) — a vote change is a
 * new event, and core's latest-row-per-note rule is the current vote.
 */
import { api, getToken } from "./api";
import { PILOT_COURSE_SLUG } from "./attempt-bridge";

export type NoteVoteSyncOutcome =
  | { kind: "synced" }
  | { kind: "local-only"; reason: string };

/**
 * Record one vote to the learner's core account when the full preflight
 * passes (pilot course + signed in + core reachable + the note's anchor
 * resolves). Resolves regardless — the caller must never await
 * user-visible consequences from this.
 */
export async function submitNoteVote(
  course: string,
  noteId: string,
  vote: "up" | "down",
  subtopicCode: string,
): Promise<NoteVoteSyncOutcome> {
  if (course !== PILOT_COURSE_SLUG) {
    return { kind: "local-only", reason: "not the pilot course" };
  }
  if (!subtopicCode) {
    // an unplaced note has nothing to attribute against — core would (and
    // must) refuse it; stay honest and local without the round trip
    return { kind: "local-only", reason: "no note anchor" };
  }
  if (!getToken()) {
    return { kind: "local-only", reason: "signed out" };
  }
  try {
    await api.recordNoteVote({ noteId, vote, subtopicCode });
    window.dispatchEvent(new CustomEvent("syllabai:core-evidence"));
    return { kind: "synced" };
  } catch (err) {
    // core down / 404 unknown anchor / expired session — the local overlay
    // already holds the vote; core simply stays without this event
    const reason = err instanceof Error ? err.message : "core unavailable";
    return { kind: "local-only", reason };
  }
}
