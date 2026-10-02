"use client";

/**
 * Flashcard deck player — the SME loop (research §7.1, figure 12): flip
 * card, Still learning / Know rating, deck progress, shuffle + restart.
 * Ratings always persist to the browser-local SIMULATED overlay (rings,
 * queue); on the pilot course, when signed in, they additionally record to
 * the learner's core account as append-only self-report evidence
 * (tranche 4.4 — lib/flashcard-bridge, never mastery, degrades silently).
 *
 * Tranche 4.6: the deck is also where the Ebbinghaus review queue is worked
 * — cards whose rating trail says they are due again carry a badge, and
 * "Review due first" lifts them (stalest due first) to the front of the run.
 * T-C57: the queue is the UNION of this browser's trail and the account's
 * core review-schedule feed (pilot + signed in — lib/flashcard-unified.ts),
 * so a card rated from another device can come due here too. Still timing
 * only — self-report never touches mastery.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronLeft, RotateCcw, Shuffle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { rateFlashcard, useCourseProgress, type Course, type FlashcardRating } from "@/lib/progress";
import { unifiedQueue, useCoreReviewSchedule } from "@/lib/flashcard-unified";
import { getToken } from "@/lib/api";
import { PILOT_COURSE_SLUG } from "@/lib/attempt-bridge";
import { submitFlashcardRating } from "@/lib/flashcard-bridge";
import { cn } from "@/lib/utils";

export interface DeckCard {
  id: string;
  front: string;
  back: string;
  sourceNoteId: string | null;
  sourceTitle: string | null;
  provenanceTier: string;
}

export function DeckPlayer({
  course,
  subtopicCode,
  cards,
}: {
  course: Course;
  subtopicCode: string;
  cards: DeckCard[];
}) {
  const progress = useCourseProgress(course);
  const core = useCoreReviewSchedule(course);
  const [order, setOrder] = useState<string[]>(() => cards.map((c) => c.id));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // tranche 4.4 honesty chip: does rating here also record to the account?
  // Read after mount (async so SSR paint stays identical — the server never
  // sees the token), then during-render adjustments are unnecessary: the
  // session token doesn't change while a deck is open.
  const [syncMode, setSyncMode] = useState<null | "account" | "device" | "offline">(null);
  useEffect(() => {
    if (course !== PILOT_COURSE_SLUG) return; // off-pilot: chip stays hidden
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setSyncMode(getToken() ? "account" : "device");
    });
    return () => {
      cancelled = true;
    };
  }, [course]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const current = order.length > 0 ? byId.get(order[Math.min(pos, order.length - 1)]) : undefined;
  // T-C57 + T-C61: the rated counts and the schedule read the unified queue
  // (true cross-device trail merge when the raw trail walk completes, else
  // the T-C57 feed union, else this device alone), scoped to this deck's
  // cards — the honest counts a multi-device account sees, self-report only.
  const schedules = useMemo(
    () => unifiedQueue(progress.flashcards, core.source, Date.now()),
    [progress.flashcards, core.source],
  );
  const rated = schedules.filter((s) => s.subtopic === subtopicCode && byId.has(s.cardId));
  const stillLearning = rated.filter((s) => s.rating === "still-learning").length;
  const know = rated.filter((s) => s.rating === "know").length;
  const scheduleById = useMemo(() => new Map(schedules.map((c) => [c.cardId, c])), [schedules]);
  const dueStalestFirst = useMemo(
    () =>
      schedules
        .filter((c) => c.due && byId.has(c.cardId))
        .sort((a, b) => a.dueAt - b.dueAt || a.cardId.localeCompare(b.cardId))
        .map((c) => c.cardId),
    [schedules, byId],
  );

  const advance = (rating: FlashcardRating | null) => {
    if (!current) return;
    if (rating) {
      const ratedAt = rateFlashcard(course, current.id, subtopicCode, rating);
      // best-effort core mirror (pilot + signed in only); never blocks the
      // deck — the local overlay already holds the rating. T-C61: the
      // bridge persists the outcome as the entry's sync receipt, the one
      // fact the true cross-device merge uses to exclude the account's
      // copy of this flip (core stamps occurred_at server-side, so
      // timestamps cannot recognize the same event across sides)
      void submitFlashcardRating(
        course,
        current.id,
        rating,
        subtopicCode,
        ratedAt,
      ).then(
        (outcome) => {
          if (outcome.kind === "synced") {
            setSyncMode((m) => (m === "device" ? "account" : m));
          } else if (
            syncMode === "account" &&
            !/signed out|not the pilot/.test(outcome.reason)
          ) {
            // a real negative (core down / unknown anchor) — say it honestly
            setSyncMode("offline");
          }
        },
      );
    }
    setFlipped(false);
    setPos((p) => (p + 1 < order.length ? p + 1 : 0));
  };

  const shuffle = () => {
    // deterministic reshuffle so hydration stays stable
    let seed = cards.length * 7919 + 17;
    const arr = [...order];
    for (let i = arr.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const j = seed % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    setOrder(arr);
    setPos(0);
    setFlipped(false);
  };

  if (!current) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">This deck is empty.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* SME deck header: progress + counters */}
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="sm" variant="ghost" className="gap-1.5 text-xs">
          <Link href={`/courses/${course}/flashcards`}>
            <ChevronLeft className="size-3.5" aria-hidden /> All decks
          </Link>
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground">
          {pos + 1}/{order.length}
        </span>
        {syncMode && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              syncMode === "account" && "border-success/30 text-success",
              syncMode === "device" && "text-muted-foreground",
              syncMode === "offline" && "border-destructive/30 text-destructive",
            )}
            title={
              syncMode === "account"
                ? "Ratings also record to your account as self-report evidence — they never change mastery."
                : syncMode === "device"
                  ? "Ratings stay on this device — sign in to record them to your account."
                  : "Core unreachable — ratings stay on this device for now."
            }
          >
            {syncMode === "account"
              ? "saved to your account"
              : syncMode === "device"
                ? "local only — sign in to sync"
                : "core unreachable — local only"}
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dueStalestFirst.length > 0 && (
            <Badge variant="outline" className="border-warn/40 text-[10px] text-warn">
              {dueStalestFirst.length} due for review
            </Badge>
          )}
          <Badge variant="outline" className="border-destructive/30 text-[10px] text-destructive">
            {stillLearning} still learning
          </Badge>
          <Badge variant="outline" className="border-success/30 text-[10px] text-success">
            {know} know
          </Badge>
          {dueStalestFirst.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-xs"
              onClick={() => {
                // lift the due cards to the front, stalest due first; the
                // rest keep their current run order behind them
                const dueSet = new Set(dueStalestFirst);
                setOrder([...dueStalestFirst, ...order.filter((id) => !dueSet.has(id))]);
                setPos(0);
                setFlipped(false);
              }}
            >
              <CalendarClock className="size-3.5" aria-hidden /> Review due first
            </Button>
          )}
          <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={shuffle}>
            <Shuffle className="size-3.5" aria-hidden /> Shuffle
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-xs"
            onClick={() => {
              setPos(0);
              setFlipped(false);
            }}
          >
            <RotateCcw className="size-3.5" aria-hidden /> Restart
          </Button>
        </div>
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${((pos + 1) / order.length) * 100}%` }}
        />
      </div>

      {/* the card */}
      <Card
        className="min-h-64 cursor-pointer select-none transition-shadow hover:shadow-md"
        onClick={() => setFlipped((f) => !f)}
        role="button"
        tabIndex={0}
        aria-label={flipped ? "Show front" : "Reveal answer"}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFlipped((f) => !f);
          }
        }}
      >
        <CardContent className="flex min-h-64 flex-col justify-between gap-4 p-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">
              {current.provenanceTier}
            </Badge>
            {scheduleById.get(current.id)?.due && (
              <Badge
                variant="outline"
                className="text-[10px] border-warn/40 text-warn"
                title="Your rating trail says this card is due for review again"
              >
                due for review
              </Badge>
            )}
            <span>{flipped ? "Back" : "Front"}</span>
            {current.sourceTitle && (
              <Link
                href={current.sourceNoteId ? `/courses/${course}/revision-notes/${current.sourceNoteId}` : "#"}
                className="ml-auto truncate text-primary underline-offset-2 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                from “{current.sourceTitle}”
              </Link>
            )}
          </div>
          <div className="flex flex-1 items-center justify-center py-4">
            {flipped ? (
              <Markdown className="text-center">{current.back}</Markdown>
            ) : (
              // fronts carry **bold** key terms + $math$ too (13.7k cards) —
              // render through the corpus Markdown, not plain text
              <Markdown className="text-center" pClassName="text-lg font-medium leading-relaxed">
                {current.front}
              </Markdown>
            )}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {flipped ? "rate your recall below" : "tap the card to flip"}
          </p>
        </CardContent>
      </Card>

      {/* rating controls — enabled once revealed (SME: rate after seeing back) */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="lg"
          variant="outline"
          className={cn("border-destructive/30 text-destructive hover:bg-destructive/10")}
          disabled={!flipped}
          onClick={() => advance("still-learning")}
        >
          Still learning
        </Button>
        {/* Know button: bg-success resolves to the theme's action-green
            (SME emerald-700 5.5:1 / QG fern) — WCAG AA on white (P1-4 fix).
            text-success-ink is the copy-on-success token: dark themes ship
            lightened success hues where white text failed AA (audit 2026-10-02). */}
        <Button
          size="lg"
          className="bg-success text-success-ink hover:bg-success/90"
          disabled={!flipped}
          onClick={() => advance("know")}
        >
          Know
        </Button>
      </div>
    </div>
  );
}
