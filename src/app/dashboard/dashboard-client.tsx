"use client";

/**
 * Dashboard — the student's SME-style home (Task 21 + 21-b fidelity pass,
 * matched against the real savemyexams.com /members/ reference page):
 *
 *   1. Greeting header ("Hi {name} 👋" — mock identity from /login when present)
 *   2. My courses — one card per added subject:
 *        eyebrow "Edexcel · {level}" · subject name · Last viewed badge ·
 *        "Continue revising" · per-resource rows with corpus counts AND
 *        live progress % (SME ProgressBarGroup parity) computed from the
 *        browser-local activity overlay (notes read, questions attempted,
 *        flashcards rated) — real activity, honestly 0% before you start.
 *        On the pilot card, signed-in learners also get an ACCOUNT strip
 *        (course-stats contract, ADR-029 tranche 4.11): full-trail coverage
 *        from the core account — attempts volume + distinct questions /
 *        notes / cards — shown as its own honest element BESIDE the device
 *        rows, never replacing them (self-marked answers and pre-account
 *        activity are device-local by design; core counts can only be a
 *        subset of what this device shows).
 *   3. Next best actions — ranked advice from the learner's own evidence
 *        (lib/next-best-actions.ts): misconception watch, review-due topics,
 *        problem-question retries, low-mastery practice, note coverage
 *   4. "Got another course?" slot card (SME's trailing grid cell) — opens
 *        the cascading board → level → subject add-course overlay
 *   5. "Jump back in" — resume card from the last-opened store
 *
 * The dashboard lists ONLY the learner's own subjects (no full-registry
 * catalogue — discovery lives in the overlay). The roster + last-opened
 * persist client-side (no auth in the demo); resource counts come from
 * /api/course-stats (committed bundles).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  CircleHelp,
  CloudCheck,
  FileQuestion,
  GraduationCap,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMySubjects } from "@/lib/my-subjects";
import { useIdentity } from "@/lib/identity";
import { useLastOpened, resourceLabel } from "@/lib/last-opened";
import { useCourseProgress } from "@/lib/progress";
import { api, getToken } from "@/lib/api";
import { fetchPilotInfo, PILOT_COURSE_SLUG } from "@/lib/attempt-bridge";
import { useDashboardCore } from "@/lib/dashboard-core";
import { fetchBridge, type LearnerBridge } from "@/lib/learner-state";
import { useExamTargets } from "@/lib/exam-series";
import { daysAgo, subtopicSetFor } from "@/lib/next-best-actions";
import { NextBestActionsCard } from "./next-best-actions-card";
import { ReviewDueStrip } from "./review-due-strip";
import { SetWorkCard } from "./set-work-card";
import { ExamSeriesPicker } from "./exam-series-picker";
import { AddCourseOverlay } from "./add-course-overlay";
import type { CourseMeta } from "@/lib/courses";
import type { CourseExamTargetView, CourseStatsView } from "@/lib/types";

interface CourseStat {
  slug: string;
  hasBundle: boolean;
  topics: number;
  notes: number;
  questionSets: number;
  questions: number;
  flashcards: number;
}

const QUICK_ADD = ["igcse-chemistry-19", "igcse-physics-19", "igcse-biology-19", "ial-maths-20-pure-1"];

function rowValue(value: number | undefined, unit: string) {
  if (value === undefined) return <Skeleton className="h-3 w-10" />;
  return (
    <span className="text-xs font-medium tabular-nums text-foreground">
      {value} {unit}
      {value === 1 ? "" : "s"}
    </span>
  );
}

function percentOf(done: number, total: number | undefined): number | undefined {
  if (total === undefined || total <= 0) return undefined;
  // precise value — tiny fractions (<1%) still move the needle and are
  // formatted with a decimal at display time, so the first answered
  // question is visible immediately instead of rounding to 0%
  return Math.min(100, (done / total) * 100);
}

function formatPercent(percent: number): string {
  if (percent <= 0) return "0%";
  return percent >= 1 ? `${Math.round(percent)}%` : `${percent.toFixed(1)}%`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * Pilot account coverage (course-stats contract, ADR-029 tranche 4.11):
 * the learner's FULL-trail aggregates from their core account. Additive by
 * design — every negative (signed out, roster without the pilot, core
 * behind the contract or down) degrades to null without a word and the
 * card keeps its device rows. Re-reads when new core evidence lands
 * (attempt / rating / vote events fire `syllabai:core-evidence`).
 */
function usePilotAccountStats(enabled: boolean): CourseStatsView | null {
  const [stats, setStats] = useState<CourseStatsView | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      if (!getToken()) return; // signed out — no account trail to show
      fetchPilotInfo(PILOT_COURSE_SLUG)
        .then((pilot) => {
          if (!pilot || cancelled) return; // not the pilot — nothing to say
          return api
            .learnerCourseStats()
            .then((s) => {
              if (!cancelled) setStats(s);
            })
            .catch(() => {}); // core behind the contract or down — silent
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("syllabai:core-evidence", load);
    return () => {
      cancelled = true;
      window.removeEventListener("syllabai:core-evidence", load);
    };
  }, [enabled]);

  return stats;
}

/** SME ProgressBarGroup parity: title row + percent, thin rounded bar underneath. */
function ProgressBar({ percent }: { percent: number | undefined }) {
  if (percent === undefined) return null;
  return (
    <div
      className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${
          percent >= 100 ? "bg-chart-2" : "bg-primary"
        }`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function ResourceRow({
  href,
  icon: Icon,
  label,
  value,
  percent,
  disabled,
}: {
  href: string;
  icon: typeof BookOpen;
  label: string;
  value: React.ReactNode;
  percent?: number | undefined;
  disabled?: boolean;
}) {
  const inner = (
    <>
      <span className="flex w-full items-center gap-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1 truncate text-sm">{label}</span>
        {value}
        {percent !== undefined && (
          <span
            className={`w-9 shrink-0 text-right text-xs font-semibold tabular-nums ${
              percent > 0 ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {formatPercent(percent)}
          </span>
        )}
        <ChevronRight
          className={`size-4 shrink-0 transition-opacity ${disabled ? "text-muted-foreground/30" : "text-muted-foreground/60"}`}
          aria-hidden
        />
      </span>
      <ProgressBar percent={percent} />
    </>
  );
  const cls =
    "flex flex-col gap-0 rounded-md px-2 py-2 transition-colors " +
    (disabled
      ? "cursor-not-allowed text-muted-foreground/60"
      : "hover:bg-muted hover:text-foreground");
  return (
    <li>
      {disabled ? (
        <span aria-disabled className={cls} title="Import pending">
          {inner}
        </span>
      ) : (
        <Link href={href} className={cls}>
          {inner}
        </Link>
      )}
    </li>
  );
}

function SubjectCard({
  meta,
  stat,
  isLastViewed,
  onRemove,
  accountStats,
  examTarget,
}: {
  meta: CourseMeta;
  stat: CourseStat | undefined;
  isLastViewed: boolean;
  onRemove: (slug: string) => void;
  /** pilot-only account coverage (course-stats contract) — null = not
   *  signed in / not the pilot / core unreachable; the card is identical
   *  to every other card in that case */
  accountStats?: CourseStatsView | null;
  /** T-C79: the declared exam target with its derived countdown —
   *  undefined = unavailable (signed out / core behind the contract; no
   *  surface at all), null = nothing declared (the honest picker state) */
  examTarget?: CourseExamTargetView | null;
}) {
  const base = `/courses/${meta.slug}`;
  const counts =
    stat?.hasBundle
      ? { notes: stat.notes, questions: stat.questions, sets: stat.questionSets, cards: stat.flashcards }
      : null;

  // Live progress % — the student's own browser-local activity overlay
  // (notes read · distinct questions attempted · flashcards rated), shown
  // against real corpus totals. Honestly 0% before any activity.
  const progress = useCourseProgress(meta.slug);
  const questionsTouched = useMemo(
    () =>
      new Set([...Object.keys(progress.selfScores), ...Object.keys(progress.mcqAnswers)]).size,
    [progress],
  );
  const percents = counts
    ? {
        notes: percentOf(Object.keys(progress.notesRead).length, counts.notes),
        questions: percentOf(questionsTouched, counts.questions),
        cards: percentOf(Object.keys(progress.flashcards).length, counts.cards),
      }
    : null;

  return (
    <Card className="relative h-full border-primary/25 transition-colors hover:border-primary/60">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove ${meta.label} from my subjects`}
        onClick={() => onRemove(meta.slug)}
        className="absolute top-1 right-1 size-9 rounded-full text-muted-foreground hover:text-destructive"
      >
        <X className="size-4" aria-hidden />
      </Button>
      <CardContent className="flex h-full flex-col gap-1 p-4 pr-11">
        {/* eyebrow: board · level (SME: "IGCSE · Edexcel") */}
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Edexcel · {meta.level}
        </p>

        {/* subject name + Last viewed badge */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={base} className="group min-w-0">
            <span className="block truncate text-base font-bold group-hover:text-primary">
              {meta.subject}
            </span>
          </Link>
          {isLastViewed && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-medium">
              Last viewed
            </Badge>
          )}
        </div>
        <p className="font-mono text-xs text-muted-foreground">{meta.code || "code pending"}</p>

        {/* T-C79: the exam-series declaration + its derived countdown —
            a picker over the IMPORTED calendar, never a typed date; the
            chip renders "≈" for estimated sittings and the entries-closed
            fact; unavailable states render nothing at all */}
        <div className="pt-0.5">
          <ExamSeriesPicker slug={meta.slug} level={meta.level} target={examTarget} compact />
        </div>

        <Link
          href={base}
          className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          Continue revising
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>

        {/* per-resource rows: corpus counts + live progress % (SME parity) */}
        {counts && percents ? (
          <ul className="mt-1 space-y-0.5 border-t pt-1">
            <ResourceRow
              href={`${base}/revision-notes`}
              icon={BookOpen}
              label="Revision Notes"
              value={rowValue(counts.notes, "note")}
              percent={percents.notes}
            />
            <ResourceRow
              href={`${base}/exam-questions`}
              icon={FileQuestion}
              label="Exam Questions"
              value={rowValue(counts.questions, "question")}
              percent={percents.questions}
            />
            <ResourceRow
              href={`${base}/flashcards`}
              icon={CircleHelp}
              label="Flashcards"
              value={rowValue(counts.cards, "card")}
              percent={percents.cards}
            />
          </ul>
        ) : (
          <div className="mt-1 space-y-2 border-t pt-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-10" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-10" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-10" />
            </div>
            {!meta.hasBundle && (
              <p className="text-xs text-muted-foreground">
                Content import pending — hub not available yet.
              </p>
            )}
          </div>
        )}

        {/* ACCOUNT strip (course-stats contract, tranche 4.11) — the pilot
            card's second truth: what the learner's SyllabAI account holds,
            full trail, cross-device. Deliberately BESIDE the device rows,
            never instead of them: self-marked answers and pre-account
            activity are device-local, so the account counts can only be a
            subset of what this device shows — replacing the rows would
            erase real progress. */}
        {accountStats && (
          <p
            className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-t pt-2 text-[11px] text-muted-foreground"
            title="Counted from your SyllabAI account — it follows you across devices. The progress bars above track this device's activity, including self-marked answers that stay local."
          >
            <Badge
              variant="outline"
              className="gap-1 px-1.5 py-0 text-[10px] font-medium text-primary"
            >
              <CloudCheck className="size-3" aria-hidden /> Live
            </Badge>
            <span className="tabular-nums">
              {plural(accountStats.attempts, "attempt")} ·{" "}
              {plural(accountStats.distinctQuestions, "question")} ·{" "}
              {plural(accountStats.notesViewed, "note")} ·{" "}
              {plural(accountStats.flashcardsRated, "card")} on your account
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardClient({ courses }: { courses: CourseMeta[] }) {
  const { slugs, has, add, remove } = useMySubjects();
  const identity = useIdentity();
  const lastOpened = useLastOpened();
  const [addOpen, setAddOpen] = useState(false);
  const [stats, setStats] = useState<Record<string, CourseStat>>({});

  const bySlug = useMemo(() => {
    const m = new Map<string, CourseMeta>();
    for (const c of courses) m.set(c.slug, c);
    return m;
  }, [courses]);

  // valid roster = stored slugs that still exist in the registry
  const mySubjects = useMemo(
    () => slugs.filter((s) => bySlug.has(s)).map((s) => bySlug.get(s) as CourseMeta),
    [slugs, bySlug],
  );
  const slugsKey = mySubjects.map((c) => c.slug).join(",");

  useEffect(() => {
    if (!slugsKey) return;
    let cancelled = false;
    fetch(`/api/course-stats?slugs=${encodeURIComponent(slugsKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { stats?: Record<string, CourseStat> }) => {
        if (!cancelled && data.stats) setStats((prev) => ({ ...prev, ...data.stats }));
      })
      .catch(() => {
        /* keep previous stats; card falls back to skeletons */
      });
    return () => {
      cancelled = true;
    };
  }, [slugsKey]);

  // "Jump back in" — only if the recorded course still resolves in the registry
  // (memoized: the core jump-back's derivation depends on it below)
  const jumpBack = useMemo(
    () =>
      lastOpened && bySlug.has(lastOpened.slug)
        ? { course: bySlug.get(lastOpened.slug) as CourseMeta, resource: lastOpened.resource }
        : null,
    [lastOpened, bySlug],
  );

  // pilot card only — the account strip needs the pilot's core join AND the
  // learner's roster to actually hold the course
  const pilotInRoster = mySubjects.some((c) => c.slug === PILOT_COURSE_SLUG);
  const accountStats = usePilotAccountStats(pilotInRoster);

  // T-C79: the learner's declared exam targets keyed by course slug —
  // undefined per card = unavailable (signed out / core behind the V62
  // contract); a missing key = nothing declared (the honest picker state)
  const examTargets = useExamTargets();

  // P1-7 — cross-device jump back in (HUB-DASH-CORE, trace 1a0ec29c8c8cfb71):
  // when THIS device has no navigation history, the account's most recent
  // measured topic takes the slot — the account trail is real evidence of
  // where the learner left off, even from another device. Silently absent
  // when signed out, non-pilot roster, core down, or no measured evidence.
  const core = useDashboardCore();
  const [pilotBridge, setPilotBridge] = useState<LearnerBridge | null>(null);
  useEffect(() => {
    if (core.kind !== "ready") return;
    let cancelled = false;
    fetchBridge(PILOT_COURSE_SLUG).then((bridge) => {
      if (!cancelled) setPilotBridge(bridge);
    });
    return () => {
      cancelled = true;
    };
  }, [core]);

  const coreJumpBack = useMemo(() => {
    if (jumpBack || !pilotInRoster || !pilotBridge || core.kind !== "ready") return null;
    const top = [...core.model.state.skillStates]
      .filter((s) => s.attempts > 0 && s.lastPracticedAt)
      .sort((a, b) => Date.parse(b.lastPracticedAt) - Date.parse(a.lastPracticedAt))[0];
    if (!top) return null;
    const meta = bySlug.get(PILOT_COURSE_SLUG) as CourseMeta | undefined;
    if (!meta) return null;
    const node = core.model.kg?.nodes.find((n) => n.id === top.nodeId) ?? null;
    // node code → the hub's own question set for that sub-topic (the bridge's
    // additive join); the exam-questions index is the honest fallback
    const setSlug = subtopicSetFor(node?.code, pilotBridge);
    return {
      title: top.nodeName ?? node?.title ?? "Your most recent topic",
      href: setSlug
        ? `/courses/${PILOT_COURSE_SLUG}/exam-questions/${setSlug}`
        : `/courses/${PILOT_COURSE_SLUG}/exam-questions`,
      lastPractised: daysAgo(Date.now(), Date.parse(top.lastPracticedAt)),
      meta,
    };
  }, [jumpBack, pilotInRoster, pilotBridge, core, bySlug]);

  return (
    <div className="space-y-8">
      {/* greeting (SME: "Hi, {name} 👋" — mock identity from the login
          page when present, otherwise the original generic greeting) */}
      <header className="space-y-1.5">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Hi {identity?.name ?? "there"} 👋
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Welcome to your SyllabAI dashboard — your launchpad for stress-free, spec-anchored
          study. Add the courses you are taking, then revise each one from notes, exam questions
          and flashcards mapped to its syllabus.{" "}
          {/* HUB-DASH-CORE P0-2 (operator trace 1a0ec29c8c8cfb71): the progress
              sentence tells the truth per session state — the old static line
              claimed device-only storage to learners whose account trail
              follows them across devices (the exact split-brain the account
              strip's tooltip already contradicted). Mirrors the identity
              store's reactivity: login/logout rewrites it in place. */}
          {identity
            ? "Your measured progress follows your account across devices — self-marked answers and reading history stay on this device."
            : "Your progress is saved on this device."}
        </p>
      </header>

      {/* ---- Review due (HUB-DASH-CORE P1-5): the retention loop's headline.
          Account queue when the pilot's core path is live, the device's
          Ebbinghaus derivation otherwise; renders nothing when nothing is due ---- */}
      <ReviewDueStrip courses={mySubjects} />

      {/* ---- My courses ---- */}
      <section aria-label="My subjects" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            My subjects <span className="text-sm font-normal text-muted-foreground">· {mySubjects.length}</span>
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-3.5" aria-hidden />
            Add course
          </Button>
        </div>

        {mySubjects.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-start gap-3 p-6">
              <p className="flex items-center gap-2 text-sm font-medium">
                <GraduationCap className="size-4 text-primary" aria-hidden />
                No subjects yet — add your first one.
              </p>
              <p className="text-sm text-muted-foreground">
                Pick your exam board, level and subject, or start with a popular one:
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                  <Plus className="size-3.5" aria-hidden />
                  Choose a subject
                </Button>
                {QUICK_ADD.filter((s) => bySlug.has(s)).map((slug) => {
                  const c = bySlug.get(slug) as CourseMeta;
                  return (
                    <Button key={slug} size="sm" variant="outline" className="gap-1.5" onClick={() => add(slug)}>
                      <Plus className="size-3.5" aria-hidden />
                      {c.label}
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mySubjects.map((c) => (
              <SubjectCard
                key={c.slug}
                meta={c}
                stat={stats[c.slug]}
                isLastViewed={lastOpened?.slug === c.slug}
                onRemove={remove}
                accountStats={c.slug === PILOT_COURSE_SLUG ? accountStats : null}
                examTarget={
                  examTargets === null ? undefined : examTargets.get(c.slug) ?? null
                }
              />
            ))}
            {/* SME's trailing slot cell: "Got another course?" — opens the
                cascading board → level → subject overlay */}
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex min-h-[10rem] flex-col items-start justify-center gap-2 rounded-xl border border-dashed border-muted-foreground/40 p-4 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-sm font-semibold">Got another course?</p>
              <p className="text-xs text-muted-foreground">
                Save your courses for easy access.
              </p>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Plus className="size-3.5" aria-hidden />
                Add course
              </span>
            </button>
          </div>
        )}
      </section>

      {/* ---- Set work (T-C78, Spec §22 agenda): the server-composed
          "what is due" facts — teacher-set assignments with the learner's
          own hand-in trail, due-soonest first. The agenda's other blocks
          live where they belong: reviews headline in the strip above,
          advice in the NBA card below. Signed out, it renders nothing. ---- */}
      <section aria-label="Set work">
        <SetWorkCard />
      </section>

      {/* ---- Next best actions (recommendation output — advice, not facts) ---- */}
      <section aria-label="Next best actions">
        <NextBestActionsCard courses={mySubjects} />
      </section>

      {/* ---- Jump back in (SME resume card, backed by real navigation) ---- */}
      {jumpBack && (
        <section aria-label="Jump back in" className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RotateCcw className="size-4 text-primary" aria-hidden />
            Jump back in
          </h2>
          <Link
            href={
              jumpBack.resource === "hub"
                ? `/courses/${jumpBack.course.slug}`
                : `/courses/${jumpBack.course.slug}/${jumpBack.resource}`
            }
            className="group block focus-visible:outline-none"
          >
            <Card className="transition-colors group-hover:border-primary/50">
              <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
                <Badge variant="secondary" className="font-medium">
                  {resourceLabel(jumpBack.resource)}
                </Badge>
                <span className="text-sm font-semibold">{jumpBack.course.subject}</span>
                <span className="text-sm text-muted-foreground">
                  Edexcel · {jumpBack.course.level} · {jumpBack.course.code}
                </span>
                <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </CardContent>
            </Card>
          </Link>
        </section>
      )}

      {/* ---- Jump back in (cross-device, HUB-DASH-CORE P1-7) — the account's
          most recent measured topic when this device has no history of its
          own; provenance-labelled and silently absent otherwise ---- */}
      {!jumpBack && coreJumpBack && (
        <section aria-label="Jump back in" className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RotateCcw className="size-4 text-primary" aria-hidden />
            Jump back in
          </h2>
          <Link
            href={coreJumpBack.href}
            className="group block focus-visible:outline-none"
          >
            <Card className="transition-colors group-hover:border-primary/50">
              <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
                <Badge variant="secondary" className="font-medium">
                  {resourceLabel("exam-questions")}
                </Badge>
                <span className="text-sm font-semibold">{coreJumpBack.title}</span>
                <span className="text-sm text-muted-foreground">
                  Edexcel · {coreJumpBack.meta.level} · {coreJumpBack.meta.code}
                </span>
                <Badge
                  variant="outline"
                  className="gap-1 px-1.5 py-0 text-[10px] font-medium text-primary"
                  title="From your SyllabAI account — it follows you across devices"
                >
                  <CloudCheck className="size-3" aria-hidden />
                  from your account · last practised {coreJumpBack.lastPractised}
                </Badge>
                <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </CardContent>
            </Card>
          </Link>
        </section>
      )}

      {/* ---- Add course — cascading board → level → subject overlay ---- */}
      <AddCourseOverlay
        open={addOpen}
        onOpenChange={setAddOpen}
        courses={courses}
        has={has}
        onAdd={add}
      />

    </div>
  );
}
