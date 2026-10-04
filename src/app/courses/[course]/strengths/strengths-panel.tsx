"use client";

/**
 * Strengths & Weaknesses (SME analytics tab, research §7.3).
 *
 * Anonymous SME state = "No data available yet" + the Answer/Analyse/Improve
 * triplet — ported verbatim. Once the LOCAL SIMULATED overlay has events,
 * the panel computes per-topic engagement strength from the browser store.
 * Nothing here claims governed analytics: it is a UI experiment on overlay
 * data, one honest step below the production plan (Phase C).
 */
import Link from "next/link";
import { BarChart3, Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCourseProgress, subtopicRing, type Course } from "@/lib/progress";
import { formatPercent, roundPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface StrengthsDatum {
  subtopicCode: string;
  title: string;
  topicNumber: number;
  href: string;
  counts: { notes: number; questions: number; flashcards: number };
}

const STEPS = [
  {
    title: "Answer",
    desc: "Work through exam-style questions and rate your recall in flashcards.",
  },
  {
    title: "Analyse",
    desc: "Your answers build a per-topic picture of what is secure and what is not.",
  },
  {
    title: "Improve",
    desc: "Weak topics point straight back at the revision notes that cover them.",
  },
];

export function StrengthsPanel({ course, data }: { course: Course; data: StrengthsDatum[] }) {
  const progress = useCourseProgress(course);

  const rows = data
    .map((d) => {
      const ring = subtopicRing(progress, d.subtopicCode, d.counts);
      const selfScores = Object.values(progress.selfScores).filter((v) => v.subtopic === d.subtopicCode);
      const mcq = Object.values(progress.mcqAnswers).filter((v) => v.subtopic === d.subtopicCode);
      const scored = [
        ...selfScores.map((s) => (s.max > 0 ? s.score / s.max : 0)),
        ...mcq.map((m) => (m.correct ? 1 : 0)),
      ];
      const accuracy = scored.length
        ? // UX audit 2026-10-02 #17: one-decimal — a single 1/2-mark hit must
          // not display as "0% accuracy" next to the ring's 0.4% engaged
          roundPercent((scored.reduce((a, b) => a + b, 0) / scored.length) * 100)
        : null;
      return { ...d, ring, accuracy, attempts: selfScores.length + mcq.length };
    })
    .filter((r) => r.ring.done > 0 || r.attempts > 0)
    .sort((a, b) => (b.accuracy ?? b.ring.percent) - (a.accuracy ?? a.ring.percent));

  if (rows.length === 0) {
    return (
      <div className="mt-8 space-y-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="size-4 text-primary" aria-hidden />
              Strength score
            </CardTitle>
          </CardHeader>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No data available yet. Answer some questions or rate a few flashcards and your
            per-topic picture will appear here.
          </CardContent>
        </Card>
        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={s.title}>
              <CardContent className="p-4">
                <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                    {i + 1}
                  </span>
                  {s.title}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center gap-2">
        <Compass className="size-4 text-primary" aria-hidden />
        <h2 className="text-base font-semibold">Strengths &amp; weaknesses by subtopic</h2>
        <Badge variant="outline" className="border-sim/30 text-[10px] text-sim">
          SIMULATED overlay
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Computed in your browser from this session&apos;s self-marks and flashcard ratings (see the
        progress disclaimer below). Self-mark accuracy is the primary signal; engagement coverage
        fills the gap where nothing is scored yet.
      </p>
      <div className="space-y-2">
        {rows.map((r) => {
          const value = r.accuracy ?? r.ring.percent;
          const band = value >= 67 ? "strength" : value >= 34 ? "developing" : "weakness";
          return (
            <Link
              key={r.subtopicCode}
              href={r.href}
              className="block rounded-lg border p-3 transition-colors hover:border-primary/40"
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                  {r.topicNumber}. {r.title}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    band === "strength" && "border-success/30 text-success",
                    band === "developing" && "border-warn/30 text-warn",
                    band === "weakness" && "border-destructive/30 text-destructive",
                  )}
                >
                  {band === "strength" ? "strength" : band === "developing" ? "developing" : "weak spot"}
                </Badge>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {r.accuracy !== null
                    ? `${formatPercent(r.accuracy)} accuracy`
                    : `${formatPercent(r.ring.percent)} engaged`}
                  {r.attempts > 0 ? ` · ${r.attempts} attempt${r.attempts === 1 ? "" : "s"}` : ""}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    band === "strength" ? "bg-success" : band === "developing" ? "bg-warn" : "bg-destructive",
                  )}
                  style={{ width: `${Math.max(value, 4)}%` }}
                />
              </div>
            </Link>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Production notes: the governed version of this view aggregates attempt events in
        syllabai-core (Master Spec analytics), not a browser overlay — this panel is the UX
        prototype only.
      </p>
    </div>
  );
}
