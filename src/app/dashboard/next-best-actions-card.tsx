"use client";

/**
 * Dashboard "Next best actions" card — the demo port of the web workbench's
 * T-033 learner-facing recommendation card (F-092 minimal slice, ADR-017).
 *
 * RECOMMENDATION output, deliberately separate from measured-fact panels.
 * Two sources, never mixed within a course (HUB-DASH-CORE P1-4, operator
 * trace 1a0ec29c8c8cfb71):
 *
 *   - core path — the pilot course, signed in, core reachable: rows come
 *     from the account's own read model (GET /recommendations) in core's
 *     rank order, deep-linked into the hub's question sets via the bridge's
 *     subtopicSets join. This is the SAME read model the workbench consumes;
 *     the local rules below are its browser-local port.
 *   - local path — everything else (signed out, other courses, core down):
 *     ranked learning advice derived from the learner's own browser-local
 *     evidence (marks, mastery, the forgetting-decay schedule and the
 *     SIMULATED misconception watch) via lib/next-best-actions.ts.
 *
 * The UI never invents or rewords the evidence — reason lines carry the
 * derived numbers verbatim, misconception states keep their SIMULATED label
 * (and, since P1-6, the local path ranks them below the learner's own
 * measured evidence), and the footer names the provenance of every row.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  BookOpenCheck,
  CalendarClock,
  Compass,
  Layers,
  MessagesSquare,
  RotateCcw,
  Target,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchBridge, type LearnerBridge } from "@/lib/learner-state";
import { useAllCourseProgress } from "@/lib/progress";
import { useDashboardCore } from "@/lib/dashboard-core";
import { useNow } from "@/lib/use-now";
import {
  coreActionsToDashboard,
  deriveDashboardActions,
  humanizeCode,
  NBA_ROW_CAP,
  type DashboardAction,
  type NbaActionType,
} from "@/lib/next-best-actions";
import { PILOT_COURSE_SLUG } from "@/lib/attempt-bridge";
import type { CourseMeta } from "@/lib/courses";

/* Status chips ride the semantic slots (--success/warn/info/cat/destructive),
   not hardcoded Tailwind hues — each theme resolves them into its own family
   (SME emerald/amber/sky/violet; QG fern/clay/teal/violet; candy mulberry/
   cherry/plum; plum violet/lavender/plum). The slots flip per mode, so no
   dark: overrides are needed. Design-audit second pass (m2). */
const typeConfig: Record<NbaActionType, { label: string; icon: typeof Compass; chip: string }> = {
  REMEDIATE_MISCONCEPTION: {
    label: "Fix misconception",
    icon: BookOpenCheck,
    chip: "border-warn/40 text-warn",
  },
  REVIEW_TOPIC: {
    label: "Review topic",
    icon: CalendarClock,
    chip: "border-info/40 text-info",
  },
  RETRY_PROBLEM_QUESTION: {
    label: "Retry question",
    icon: RotateCcw,
    chip: "border-destructive/40 text-destructive",
  },
  PRACTISE_QUESTIONS: {
    label: "Practise questions",
    icon: Target,
    chip: "border-success/40 text-success",
  },
  UNCOVERED_NOTE: {
    label: "Cover new ground",
    icon: BookOpen,
    chip: "border-cat/40 text-cat",
  },
  // core-only action types (HUB-DASH-CORE P1-4) — the local rules never
  // produce these; the chips follow the same semantic-slot discipline
  REVIEW_PREREQUISITE: {
    label: "Revise prerequisite",
    icon: Layers,
    chip: "border-info/40 text-info",
  },
  ASK_TUTOR: {
    label: "Ask the tutor",
    icon: MessagesSquare,
    chip: "border-cat/40 text-cat",
  },
  TIMED_EXERCISE: {
    label: "Practise timed",
    icon: Timer,
    chip: "border-success/40 text-success",
  },
};

function ActionRow({ action, rank }: { action: DashboardAction; rank: number }) {
  const config = typeConfig[action.actionType];
  const Icon = config.icon;
  return (
    <li
      className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
      aria-label={`Action ${rank}: ${config.label} — ${action.title}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums text-muted-foreground">
          {rank}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={`${config.chip} h-5 gap-1 px-1.5 text-[11px]`}>
              <Icon className="size-3" aria-hidden="true" />
              {config.label}
            </Badge>
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-medium">
              {action.courseLabel} · {action.courseLevel}
            </Badge>
          </div>
          <p className="mt-1 truncate text-sm font-medium" title={action.title}>
            {action.title}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{action.detail}</p>
        </div>
      </div>
      <div className="shrink-0 pt-0.5">
        <Button asChild variant="outline" size="sm" className="h-7 text-xs">
          <Link href={action.href}>{action.cta}</Link>
        </Button>
      </div>
    </li>
  );
}

export function NextBestActionsCard({ courses }: { courses: CourseMeta[] }) {
  const slugs = useMemo(() => courses.map((c) => c.slug), [courses]);
  const slugsKey = slugs.join(",");
  const progressBySlug = useAllCourseProgress(slugs);
  const [bridges, setBridges] = useState<Record<string, LearnerBridge | null>>({});
  const now = useNow();
  const core = useDashboardCore();
  const [pilotBridge, setPilotBridge] = useState<LearnerBridge | null>(null);

  useEffect(() => {
    if (!slugsKey) return;
    let cancelled = false;
    for (const slug of slugsKey.split(",")) {
      fetchBridge(slug).then((bridge) => {
        if (!cancelled) setBridges((prev) => (prev[slug] === bridge ? prev : { ...prev, [slug]: bridge }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [slugsKey]);

  // the pilot's bridge deep-links core rows into the hub's own question sets
  // (additive join — null bridge degrades rows to the exam-questions index)
  const coreReady =
    core.kind === "ready" && courses.some((c) => c.slug === PILOT_COURSE_SLUG);
  useEffect(() => {
    if (!coreReady) return;
    let cancelled = false;
    fetchBridge(PILOT_COURSE_SLUG).then((bridge) => {
      if (!cancelled) setPilotBridge(bridge);
    });
    return () => {
      cancelled = true;
    };
  }, [coreReady]);

  const coreView =
    coreReady && core.kind === "ready" ? core.model.recommendations : null;
  const coreActions = useMemo(() => {
    if (!coreView || coreView.actions.length === 0) return [];
    const meta = courses.find((c) => c.slug === PILOT_COURSE_SLUG) as CourseMeta;
    return coreActionsToDashboard(coreView, {
      course: meta.slug,
      courseLabel: meta.subject,
      courseLevel: meta.level,
      bridge: pilotBridge,
    });
  }, [coreView, courses, pilotBridge]);

  // the account's read model REPLACES the local derivation for the pilot
  // course only (replace-not-merge, per course — the same ruling as the KG
  // drawer's core path); other courses keep their device-derived rows
  const coreReplacedPilot = coreActions.length > 0;
  const localCourses = useMemo(
    () =>
      coreReplacedPilot ? courses.filter((c) => c.slug !== PILOT_COURSE_SLUG) : courses,
    [courses, coreReplacedPilot],
  );

  const inputs = useMemo(
    () =>
      localCourses.map((c) => ({
        slug: c.slug,
        subject: c.subject,
        label: c.label,
        level: c.level,
        bridge: bridges[c.slug] ?? null,
        progress: progressBySlug[c.slug],
      })),
    [localCourses, bridges, progressBySlug],
  );

  const pending =
    courses.some((c) => bridges[c.slug] === undefined) ||
    (courses.some((c) => c.slug === PILOT_COURSE_SLUG) && core.kind === "loading");
  const actions = useMemo(() => {
    // core rows first (the account's evidence outranks the device overlay —
    // the same precedence P1-6 encodes inside the local rules), then the
    // local derivation in its tier order, capped together
    return [...coreActions, ...deriveDashboardActions(inputs, now)].slice(0, NBA_ROW_CAP);
  }, [coreActions, inputs, now]);

  const reasonCodes = useMemo(
    () => [...new Set(actions.map((a) => a.reasonCode))].map(humanizeCode),
    [actions],
  );

  const bridgeFailed =
    courses.length > 0 &&
    actions.length === 0 &&
    courses.every((c) => bridges[c.slug] === null) &&
    !(core.kind === "ready" && core.model.recommendations);

  const provenance = coreReplacedPilot
    ? localCourses.length > 0
      ? "advice from your account's learner model (pilot subject) — other courses ranked from this device's evidence"
      : "advice from your account's learner model — the same read model the workbench consumes"
    : "deterministic rule baseline";

  return (
    <Card className="md:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Compass className="size-4 text-primary" aria-hidden="true" />
          Next best actions
        </CardTitle>
        <CardDescription>
          Ranked learning advice from your evidence — what to do next and why. Reasons cite
          measured marks, mastery and review schedules; they are advice, not facts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a course and your next best actions will appear here, ranked from your own
            evidence.
          </p>
        ) : pending && actions.length === 0 ? (
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : bridgeFailed ? (
          <p className="text-sm text-muted-foreground">
            Next-best actions are unavailable right now — the measured panels still work.
          </p>
        ) : actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to recommend yet — answer a question and the learning loop starts here.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {actions.map((action, i) => (
                <ActionRow key={action.key} action={action} rank={i + 1} />
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Layers className="size-3 shrink-0" aria-hidden="true" />
                {provenance} · reason codes: {reasonCodes.slice(0, 3).join(", ")}
                {reasonCodes.length > 3 ? ", …" : ""}
              </p>
              <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
                <Link href="/tutor">
                  <MessagesSquare className="size-3.5" aria-hidden="true" />
                  Stuck? Ask the AI Tutor
                </Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
