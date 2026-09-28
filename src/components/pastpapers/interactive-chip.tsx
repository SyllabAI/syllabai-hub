"use client";

/**
 * InteractiveChip — Mode 2 entry for one paper row (decided with the user:
 * "live where parsed"). Two honest states:
 *
 *   matched — the parsed question corpus holds questions from THIS paper
 *             (sourcePaper provenance), so the row links into the real
 *             Exam-Questions player: deterministic MCQ marking, self-mark +
 *             Smart Mark for structured parts, mark-scheme modals. When the
 *             official paper totals are known (blueprints), the chip also
 *             shows coverage — "10/10" complete, amber "6/7" partial.
 *
 *   roadmap — the paper exists as a PDF but isn't parsed yet. The chip opens
 *             a popover explaining the pipeline; it never pretends to play.
 */
import Link from "next/link";
import { Puzzle, Route, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function InteractiveChip({
  href,
  paperRef,
  interactiveCount,
  coverageLabel = null,
  coverageTitle = null,
}: {
  /** reconstruction player route when matched, null for roadmap state */
  href: string | null;
  paperRef: string;
  /** how many papers on this course ARE interactive (for the roadmap copy) */
  interactiveCount: number;
  /** held/official question count, e.g. "10/10" — null when unverified */
  coverageLabel?: string | null;
  /** human coverage summary (title/aria) */
  coverageTitle?: string | null;
}) {
  if (href) {
    const title = coverageTitle ?? `Interactive reconstruction of ${paperRef}`;
    return (
      <Button
        asChild
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 border-primary/40 text-xs text-primary"
      >
        <Link href={href} title={title} aria-label={`Interactive reconstruction of ${paperRef} — ${title}`}>
          <Sparkles className="size-3.5" aria-hidden />
          Interactive
          {coverageLabel ? (
            <span
              className={
                Number(coverageLabel.split("/")[0]) === Number(coverageLabel.split("/")[1])
                  ? "rounded-sm bg-primary/10 px-1 font-semibold"
                  : "rounded-sm bg-warn/15 px-1 font-semibold text-warn-ink"
              }
            >
              {coverageLabel}
            </span>
          ) : null}
        </Link>
      </Button>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          aria-label={`Interactive version of ${paperRef} — not parsed yet`}
        >
          <Puzzle className="size-3.5" aria-hidden />
          Interactive
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-sm">
        <p className="flex items-center gap-1.5 font-semibold">
          <Route className="size-4 text-primary" aria-hidden />
          {paperRef} isn&apos;t interactive yet
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Interactive play needs this paper&apos;s questions parsed into the syllabai corpus:
          PDF → question parsing → validation → the same player you use for topic questions
          (instant MCQ marking, Smart Mark for structured answers).
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {interactiveCount > 0
            ? `${interactiveCount} paper${interactiveCount === 1 ? " has" : "s have"} interactive reconstructions on this course already — everything else shows this chip until parsing lands.`
            : "No papers on this course are parsed yet — parsing coverage grows with the corpus."}
        </p>
      </PopoverContent>
    </Popover>
  );
}
