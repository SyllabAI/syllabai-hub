"use client";

/**
 * My learning state / History drawer — KG phase 2 + 3.
 *
 * The host-side answer to the web workbench's StateView + HistoryView, built
 * over the same derivation that paints the graph (lib/kg-learner-state.ts —
 * one pass, so the drawer and the renderer can never disagree). Two tabs:
 *
 *   - My state: stored → effective mastery per touched spec point
 *     (Ebbinghaus decay, demo parameters), the decay-derived review queue
 *     with deep links into mapped revision notes, the misconception watch
 *     (phase 3 — sim learner states over the course corpus, SIMULATED),
 *     exposure-only points and the awaiting-marks count.
 *   - History: the recorded evidence stream — facts only (what was answered,
 *     how it was marked, when), mirroring the web workbench's honesty rules:
 *     typed drafts without a self-score show "awaiting marks", never a guess.
 *
 * Everything is browser-local progress evidence — SIMULATED by design, and
 * labelled so on the sheet itself. The misconception card shows only what
 * the course corpus + seeded sim learner actually carry (active / watching);
 * courses without a corpus render no card rather than an empty promise.
 */
import Link from "next/link";
import {
  BookOpen,
  CalendarClock,
  Eye,
  Gauge,
  Hourglass,
  Info,
  Layers,
  ListChecks,
  ScanEye,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProvenanceBadge, SpecChip } from "@/components/provenance";
import { cn } from "@/lib/utils";
import {
  formatDue,
  formatRelative,
  type LearnerDrawerState,
  type LearnerEvent,
  type MisconceptionWatch,
  type PointState,
} from "@/lib/kg-learner-state";

/** Band tint for a point's effective mastery — the same four bands the
 *  renderer paints, expressed in the demo's theme-aware status hues. */
function bandBarClass(band: PointState["band"]): string {
  switch (band) {
    case "low":
      return "[&>div]:bg-destructive";
    case "developing":
      return "[&>div]:bg-warn";
    case "good":
      return "[&>div]:bg-info";
    case "strong":
      return "[&>div]:bg-success";
    default:
      return "";
  }
}

function bandLabel(band: PointState["band"]): string {
  switch (band) {
    case "low":
      return "low";
    case "developing":
      return "developing";
    case "good":
      return "good";
    case "strong":
      return "strong";
    default:
      return "";
  }
}

function StatTile({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof Gauge;
  value: string;
  label: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Icon className={cn("size-3.5 shrink-0", tone ?? "text-primary")} aria-hidden />
        <span className="text-lg font-semibold tabular-nums leading-none">{value}</span>
      </div>
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}

function PointChips({ codes, max = 3 }: { codes: string[]; max?: number }) {
  if (codes.length === 0) return null;
  const shown = codes.slice(0, max);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((c) => (
        <SpecChip key={c} code={c} />
      ))}
      {codes.length > shown.length && (
        <span className="text-[10px] text-muted-foreground">+{codes.length - shown.length}</span>
      )}
    </span>
  );
}

function NoteLink({ noteId }: { noteId: string }) {
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="size-9 shrink-0 text-muted-foreground"
      aria-label="Read the mapped revision note"
      title="Read the mapped revision note"
    >
      <Link href={`/revision-notes/${encodeURIComponent(noteId)}`}>
        <BookOpen className="size-3.5" aria-hidden />
      </Link>
    </Button>
  );
}

function MisconceptionWatchCard({ watch, live = false }: { watch: MisconceptionWatch; live?: boolean }) {
  const active = watch.items.filter((m) => m.active);
  const watching = watch.items.filter((m) => !m.active);
  return (
    <section className="rounded-lg border">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <TriangleAlert className="size-4 text-destructive" aria-hidden />
        <h3 className="text-sm font-semibold">Misconception watch</h3>
        <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
          {active.length} active · {watching.length} watching
        </Badge>
        <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
          {live ? "CORE_MEASURED" : "SIMULATED"}
        </Badge>
      </header>
      <div className="px-3 py-2">
        <ul className="divide-y">
          {watch.items.map((m) => (
            <li key={m.id} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
              {m.active ? (
                <TriangleAlert
                  className="mt-0.5 size-3.5 shrink-0 text-destructive"
                  aria-hidden
                />
              ) : (
                <Eye className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={
                      m.active
                        ? "border-destructive/40 text-[10px] text-destructive"
                        : "text-[10px] text-muted-foreground"
                    }
                  >
                    {m.active ? "active" : "watching"}
                  </Badge>
                  <span className="text-xs font-medium">{m.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[10px] text-muted-foreground">
                    {Math.round(m.probability * 100)}% likelihood · {m.evidenceCount} evidence
                    {m.evidenceCount === 1 ? " signal" : " signals"}
                  </span>
                  <PointChips codes={m.points} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <footer className="border-t px-3 py-2">
        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            {live
              ? "Probabilities from the backend's misconception model over your real attempt evidence — likelihoods update as you practise."
              : `${watch.disclaimer ?? "Simulated demo learner state over the course misconception corpus."} The patterns themselves are SME / mark-scheme-documented; the active / watching state is a deterministic demo overlay, not measured evidence.`}
          </span>
        </p>
      </footer>
    </section>
  );
}

/** Exported for reuse by /learner (My Progress) — one derivation, one UI,
 * so the KG drawer and the page can never disagree (ADR-029 tranche 4.1). */
export function StateTab({
  drawer,
  live = false,
  course,
}: {
  drawer: LearnerDrawerState;
  live?: boolean;
  /** course slug — when present, due decks deep-link into the player
   *  (tranche 4.6 flashcard queue) */
  course?: string;
}) {
  const stats = drawer.stats;
  const exposureOnly = Math.max(0, stats.touched - stats.measured);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          icon={ListChecks}
          value={`${stats.measured}/${stats.total}`}
          label="points measured (marked attempts)"
        />
        <StatTile
          icon={CalendarClock}
          value={String(stats.reviewDue)}
          label="review due (decayed)"
          tone="text-warn"
        />
        <StatTile
          icon={ScanEye}
          value={String(exposureOnly)}
          label="exposure only (notes, flashcards)"
          tone="text-info"
        />
        <StatTile
          icon={Hourglass}
          value={String(stats.awaitingMarks)}
          label="written answers awaiting marks"
          tone="text-warn"
        />
      </div>

      {/* topic mastery — the core path's measured topics (core's evidence
          granularity for attempts). Absent on the simulated path. */}
      {live && drawer.topicStates && drawer.topicStates.length > 0 && (
        <section className="rounded-lg border">
          <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <Gauge className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-semibold">Topic mastery</h3>
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              {drawer.topicStates.length} measured
            </Badge>
            <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
              CORE_MEASURED
            </Badge>
          </header>
          <div className="px-3 py-2">
            <ul className="divide-y">
              {drawer.topicStates.map((t) => (
                <li key={t.title} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.title}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {t.stored}% → {t.effective}%
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      t.band === "strong"
                        ? "border-success/40 text-success"
                        : t.band === "developing"
                          ? "border-warn/40 text-warn"
                          : "border-destructive/40 text-destructive",
                    )}
                  >
                    {t.band ?? "low"}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {t.attempts} attempt{t.attempts === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t pt-2 text-[10px] leading-relaxed text-muted-foreground">
              Measured by the backend from your real attempts (Smart Mark and auto-marked
              answers). Questions mapped to spec points measure those points directly;
              topic-level mastery also fills its points in the graph (marked "via
              topic" below) until direct point evidence exists.
            </p>
          </div>
        </section>
      )}

      {/* misconception watch (phase 3) — only when the course corpus carries one */}
      {drawer.misconceptionWatch && drawer.misconceptionWatch.items.length > 0 && (
        <MisconceptionWatchCard watch={drawer.misconceptionWatch} live={live} />
      )}

      {/* review queue */}
      <section className="rounded-lg border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <CalendarClock className="size-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">Review queue</h3>
          <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
            {drawer.reviewQueue.length}
          </Badge>
        </header>
        <div className="px-3 py-2">
          {drawer.reviewQueue.length === 0 && drawer.upcoming.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              Nothing due — decayed mastery is still above its review threshold. Keep practising.
            </p>
          ) : (
            <ul className="divide-y">
              {drawer.reviewQueue.map((r) => (
                <li key={r.pointId} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SpecChip code={r.pointId} />
                      <span
                        className={cn(
                          "text-[10px] font-medium",
                          r.effective < 55 ? "text-destructive" : "text-warn",
                        )}
                      >
                        {r.stored}% → {r.effective}%
                      </span>
                    </div>
                    {r.statement && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {r.statement}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        r.effective < 55
                          ? "border-destructive/40 text-destructive"
                          : "border-warn/40 text-warn",
                      )}
                    >
                      {formatDue(r.dueAt, Date.now())}
                    </Badge>
                    {r.noteIds[0] && <NoteLink noteId={r.noteIds[0]} />}
                  </div>
                </li>
              ))}
              {drawer.upcoming.map((r) => (
                <li key={r.pointId} className="flex items-start gap-2 py-2 opacity-70 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SpecChip code={r.pointId} />
                      <span className="text-[10px] text-muted-foreground">
                        {r.stored}% → {r.effective}%
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 text-[10px] text-muted-foreground"
                  >
                    {formatDue(r.dueAt, Date.now())}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* flashcard review queue (tranche 4.6) — scheduled from the rating
          trail, a self-report evidence class distinct from the mastery queue
          above: it colors review TIMING, never the mastery bands */}
      {drawer.cardReviews && (
        <section className="rounded-lg border">
          <header className="flex items-center gap-2 border-b px-3 py-2">
            <Layers className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-semibold">Flashcards due</h3>
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              {drawer.cardReviews.due}
            </Badge>
          </header>
          <div className="px-3 py-2">
            {drawer.cardReviews.due === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                Nothing due — next card{" "}
                {drawer.cardReviews.nextDueAt
                  ? formatDue(drawer.cardReviews.nextDueAt, Date.now())
                  : "has no schedule"}
                .
              </p>
            ) : (
              <ul className="divide-y">
                {drawer.cardReviews.decks.map((d) => (
                  <li key={d.subtopic} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                    <SpecChip code={d.subtopic} />
                    <Badge
                      variant="outline"
                      className="shrink-0 border-warn/40 text-[10px] text-warn"
                    >
                      {d.due} due
                    </Badge>
                    {course && (
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-7 shrink-0 gap-1 px-2 text-[11px]"
                      >
                        <Link href={`/courses/${course}/flashcards/${d.subtopic}`}>
                          open deck
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 border-t pt-2 text-[10px] leading-relaxed text-muted-foreground">
              Scheduled from your ratings on this browser: “still learning” resurfaces
              immediately; “know” returns on an expanding Ebbinghaus ladder
              (1 · 2 · 4 · 8 · 16 · 32 days) and every re-rate resets its clock.
              Self-report drives review timing only — never mastery.
            </p>
          </div>
        </section>
      )}

      {/* mastery table */}
      <section className="rounded-lg border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <Gauge className="size-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">Mastery — stored → effective</h3>
          <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
            {drawer.pointStates.length} touched
          </Badge>
        </header>
        <div className="px-3 py-2">
          {drawer.pointStates.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              No evidence on this course yet — answer and self-mark a question in Practice or
              Exam Questions, and the touched points will appear here.
            </p>
          ) : (
            <ul className="divide-y">
              {drawer.pointStates.map((p) => (
                <li key={p.pointId} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <SpecChip code={p.pointId} />
                      {p.statement && (
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {p.statement}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatRelative(p.lastAt, Date.now())}
                    </span>
                  </div>
                  {p.stored != null && p.effective != null ? (
                    <div className="mt-1 flex items-center gap-2">
                      <Progress
                        value={p.effective}
                        className={cn("h-2 flex-1", bandBarClass(p.band))}
                        aria-label={`Effective mastery ${p.effective} percent (${bandLabel(p.band)})`}
                      />
                      <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        {p.stored}% → {p.effective}%
                      </span>
                      {p.derivedFrom && (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px] text-muted-foreground"
                          title={`Topic-derived: the ${p.derivedFrom} topic's measured mastery fills this point until it has direct marked attempts of its own`}
                        >
                          via {p.derivedFrom}
                        </Badge>
                      )}
                      {p.misconception && (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-destructive/40 text-[10px] text-destructive"
                          title={p.misconception}
                        >
                          misconception
                        </Badge>
                      )}
                      {p.reviewDue && (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-warn/40 text-[10px] text-warn"
                        >
                          review
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {p.misconception && (
                        <Badge
                          variant="outline"
                          className="border-destructive/40 text-[10px] text-destructive"
                          title={p.misconception}
                        >
                          misconception — unmeasured point
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        exposure only — no marked attempt
                      </Badge>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
        <span>
          Effective mastery = stored mastery × Ebbinghaus retention (τ = 30/90/365 days by band;
          review when it decays below its threshold). Bands mirror the graph: low &lt;55 ·
          developing 55–69 · good 70–79 · strong ≥80.
          {live ? " Decay and review scheduling are computed on the backend from your real attempts."
                : " Demo model — simulated parameters."}
        </span>
      </p>
    </div>
  );
}

function EventBadge({ ev }: { ev: LearnerEvent }) {
  if (ev.kind === "awaiting") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-warn/40 text-[10px] text-warn"
      >
        <Hourglass className="size-3" aria-hidden />
        awaiting marks
      </Badge>
    );
  }
  if (ev.kind === "exposure") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
        <BookOpen className="size-3" aria-hidden />
        exposure
      </Badge>
    );
  }
  // marked — MCQ answers know correct/not correct; self-marked work shows
  // its marks value as the fact (no invented classification)
  if (ev.value === "1/1") {
    return (
      <Badge variant="outline" className="gap-1 border-success/40 text-[10px] text-success">
        correct
      </Badge>
    );
  }
  if (ev.value === "0/1") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-destructive/40 text-[10px] text-destructive"
      >
        not correct
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
      marked
    </Badge>
  );
}

function dayLabel(at: number, now: number): string {
  const a = new Date(at);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.floor((startOf(new Date(now)) - startOf(a)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return a.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function HistoryTab({ drawer }: { drawer: LearnerDrawerState }) {
  if (drawer.events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
        <ListChecks className="size-7 text-muted-foreground/60" aria-hidden />
        <p className="max-w-xs text-xs text-muted-foreground">
          No signals recorded yet. Answer and self-mark a question in Practice or Exam
          Questions — every marked attempt, note read and flashcard rating will appear here.
        </p>
      </div>
    );
  }

  // group by day, newest first
  const now = Date.now();
  const groups: { label: string; events: LearnerEvent[] }[] = [];
  for (const ev of drawer.events) {
    const label = dayLabel(ev.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.events.push(ev);
    else groups.push({ label, events: [ev] });
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Facts only — what was answered, how it was marked, when it happened. No advice and no
        re-derived mastery: those live in the graph and the next-best-action panel.
      </p>

      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            {g.label}
          </h3>
          <ul className="space-y-1">
            {g.events.map((ev) => (
              <li key={ev.id} className="rounded-md border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <EventBadge ev={ev} />
                    <span className="text-xs font-medium">{ev.label}</span>
                    {ev.value && (
                      <span className="font-mono text-[11px] tabular-nums text-foreground/80">
                        {ev.value}
                      </span>
                    )}
                  </div>
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    {ev.href && (
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="size-5 text-muted-foreground"
                        aria-label="Open the note"
                      >
                        <Link href={ev.href}>
                          <BookOpen className="size-3" aria-hidden />
                        </Link>
                      </Button>
                    )}
                    {new Date(ev.at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[11px] text-muted-foreground">{ev.detail}</span>
                  <PointChips codes={ev.points} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {drawer.eventCount > drawer.events.length && (
        <p className="text-[10px] text-muted-foreground">
          Showing the latest {drawer.events.length} of {drawer.eventCount} recorded signals.
        </p>
      )}
    </div>
  );
}

export function LearnerStateDrawer({
  open,
  onOpenChange,
  courseLabel,
  course,
  drawer,
  source = "simulated",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseLabel: string;
  /** course slug — deep-links the tranche-4.6 flashcard queue into decks */
  course?: string;
  drawer: LearnerDrawerState | null;
  /** core = the pilot's real learner model from the backend; simulated = the
   *  browser-local demo overlay. Only the provenance labels change. */
  source?: "core" | "simulated";
}) {
  const live = source === "core";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b px-4 py-4">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 shrink-0 text-primary" aria-hidden />
            <SheetTitle className="text-base">My learning state</SheetTitle>
            <ProvenanceBadge tier={live ? "CORE_MEASURED" : "SIMULATED"} />
          </div>
          <SheetDescription className="text-xs">
            {live
              ? `Derived live from your SyllabAI account — real attempt evidence, Ebbinghaus decay and review scheduling computed on the backend for ${courseLabel}.`
              : `Derived live from this browser's progress on ${courseLabel} — simulated, browser-local evidence. It never writes to course data.`}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="state" className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-4 py-2">
            <TabsList>
              <TabsTrigger value="state">My state</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-4">
              <TabsContent value="state" className="mt-0">
                {drawer ? (
                  <StateTab drawer={drawer} live={live} course={course} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    The content bridge is still loading — the state view appears once it
                    resolves.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="history" className="mt-0">
                {drawer ? (
                  <HistoryTab drawer={drawer} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    The content bridge is still loading — the history appears once it resolves.
                  </p>
                )}
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
