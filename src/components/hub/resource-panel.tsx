"use client";

/**
 * ResourcePanel — SME's second column (research §4, figures 14–15): a
 * resource-scoped topic panel that appears ONLY on resource detail pages
 * (question set, note reader, deck player). Header row with a "Hide topics"
 * collapse, "View all topics" and "Saved questions" cards, then the numbered
 * specification tree. Course hub / index pages never mount it — there the
 * course sidebar is the only chrome, exactly as on SaveMyExams.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Bookmark, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  useCourseData,
  resourceIndexHref,
} from "@/components/hub/course-data-context";
import { TopicTree, useActiveSubtopic } from "@/components/hub/topic-tree";
import { useCourseProgress, type Course } from "@/lib/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PanelVariant = "notes" | "questions" | "flashcards";

const PANEL_TITLE: Record<PanelVariant, string> = {
  notes: "Revision Notes",
  questions: "Exam Questions",
  flashcards: "Flashcards",
};

export function ResourcePanel({ variant }: { variant: PanelVariant }) {
  const data = useCourseData();
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const activeSubtopic = useActiveSubtopic(variant);
  const progress = useCourseProgress(data.course.slug as Course);
  const savedCount = useMemo(() => Object.keys(progress.saved).length, [progress.saved]);

  const base = `/courses/${data.course.slug}`;
  const indexHref = resourceIndexHref(base, variant);

  if (hidden) {
    // collapsed rail — SME keeps a slim expand affordance at the panel edge
    return (
      <div className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-11 shrink-0 flex-col items-center border-r bg-background pt-3 lg:flex">
        <Button
          variant="ghost"
          size="icon"
          className="size-9"
          onClick={() => setHidden(false)}
          aria-label="Show topics"
        >
          <PanelLeftOpen className="size-4" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <aside
      className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-72 shrink-0 border-r bg-background lg:block"
      aria-label={`${PANEL_TITLE[variant]} topic navigation`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold tracking-tight">{PANEL_TITLE[variant]}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => setHidden(true)}
          >
            <PanelLeftClose className="size-4" aria-hidden /> Hide topics
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <Link
            href={indexHref}
            className="group mb-2 flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            View all topics
            <ArrowRight
              className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
          {variant === "questions" && (
            <Link
              href={`${base}/exam-questions/saved`}
              className={cn(
                "group mb-3 flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
                pathname === `${base}/exam-questions/saved` && "border-primary/40 bg-primary/[0.04]",
              )}
            >
              <span className="flex items-center gap-2">
                Saved questions
                {savedCount > 0 && (
                  <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                    {savedCount}
                  </span>
                )}
              </span>
              <Bookmark className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          )}
          <TopicTree data={data} variant={variant} activeSubtopic={activeSubtopic} />
        </div>
      </div>
    </aside>
  );
}
