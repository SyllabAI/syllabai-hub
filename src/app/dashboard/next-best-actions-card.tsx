"use client";

/**
 * Dashboard "Next best actions" card — the demo port of the web workbench's
 * T-033 learner-facing recommendation card (F-092 minimal slice, ADR-017).
 *
 * RECOMMENDATION output, deliberately separate from measured-fact panels:
 * every row is ranked learning advice derived from the learner's own
 * browser-local evidence (marks, mastery, the forgetting-decay schedule and
 * the SIMULATED misconception watch) via lib/next-best-actions.ts. The UI
 * never invents or rewords the evidence — reason lines carry the derived
 * numbers verbatim, and misconception states keep their SIMULATED label.
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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchBridge, type LearnerBridge } from "@/lib/learner-state";
import { useAllCourseProgress } from "@/lib/progress";
import {
  deriveDashboardActions,
  humanizeCode,
  type DashboardAction,
  type NbaActionType,
} from "@/lib/next-best-actions";
import type { CourseMeta } from "@/lib/courses";

const typeConfig: Record<NbaActionType, { label: string; icon: typeof Compass; chip: string }> = {
  REMEDIATE_MISCONCEPTION: {
    label: "Fix misconception",
    icon: BookOpenCheck,
    chip: "border-teal-500/40 text-teal-700 dark:text-teal-400",
  },
  REVIEW_TOPIC: {
    label: "Review topic",
    icon: CalendarClock,
    chip: "border-sky-500/40 text-sky-700 dark:text-sky-400",
  },
  RETRY_PROBLEM_QUESTION: {
    label: "Retry question",
    icon: RotateCcw,
    chip: "border-rose-500/40 text-rose-700 dark:text-rose-400",
  },
  PRACTISE_QUESTIONS: {
    label: "Practise questions",
    icon: Target,
    chip: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  },
  UNCOVERED_NOTE: {
    label: "Cover new ground",
    icon: BookOpen,
    chip: "border-violet-500/40 text-violet-700 dark:text-violet-400",
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
  const [now] = useState(() => Date.now());

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

  const inputs = useMemo(
    () =>
      courses.map((c) => ({
        slug: c.slug,
        subject: c.subject,
        label: c.label,
        level: c.level,
        bridge: bridges[c.slug] ?? null,
        progress: progressBySlug[c.slug],
      })),
    [courses, bridges, progressBySlug],
  );

  const pending = courses.some((c) => bridges[c.slug] === undefined);
  const bridgeFailed = courses.length > 0 && courses.every((c) => bridges[c.slug] === null);
  const actions = useMemo(() => deriveDashboardActions(inputs, now), [inputs, now]);

  const reasonCodes = useMemo(
    () => [...new Set(actions.map((a) => a.reasonCode))].map(humanizeCode),
    [actions],
  );

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
        ) : bridgeFailed && actions.length === 0 ? (
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
                deterministic rule baseline · reason codes: {reasonCodes.slice(0, 3).join(", ")}
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
