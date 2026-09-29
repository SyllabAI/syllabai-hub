"use client";

/**
 * Review-due strip (HUB-DASH-CORE P1-5, operator trace 1a0ec29c8c8cfb71) —
 * the dashboard's honest "what's slipping today" headline.
 *
 * The retention loop is the app's strongest learning lever and it used to be
 * invisible on home: the review queue lived inside the KG drawer / My
 * Progress, while the dashboard surfaced it only implicitly (a single tier-1
 * NBA row, and only when this device held marked attempts). The strip counts
 * due spec points per roster course and never mixes provenance within a
 * course:
 *
 *   - pilot + signed in + core reachable → the ACCOUNT's pendingReviews due
 *     now (the nightly decay job's queue — core-measured);
 *   - otherwise → the same client-side forgetting derivation the NBA card
 *     uses (marked attempts through the Ebbinghaus model, this device).
 *
 * Renders nothing while counts are unresolved and nothing when nothing is
 * due — an empty strip is not news. The CTA lands where the underlying queue
 * actually lives: /learner (My State tab) when the account contributed,
 * the course's knowledge graph (same drawer, simulated path) otherwise.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchBridge, buildOverlay, type LearnerBridge } from "@/lib/learner-state";
import { useAllCourseProgress } from "@/lib/progress";
import { useDashboardCore } from "@/lib/dashboard-core";
import { useNow } from "@/lib/use-now";
import { PILOT_COURSE_SLUG } from "@/lib/attempt-bridge";
import type { CourseMeta } from "@/lib/courses";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

interface CourseDue {
  slug: string;
  subject: string;
  count: number;
  /** where this count came from — the account's queue or this device's marks */
  source: "account" | "device";
}

export function ReviewDueStrip({ courses }: { courses: CourseMeta[] }) {
  const slugs = useMemo(() => courses.map((c) => c.slug), [courses]);
  const slugsKey = slugs.join(",");
  const progressBySlug = useAllCourseProgress(slugs);
  const [bridges, setBridges] = useState<Record<string, LearnerBridge | null>>({});
  const now = useNow();
  const core = useDashboardCore();

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

  const pilotInRoster = courses.some((c) => c.slug === PILOT_COURSE_SLUG);
  // the strip stays hidden while the pilot's provenance is unresolved — it
  // must never flash a device-derived count and then swap to the account's
  const coreUnresolved = pilotInRoster && core.kind === "loading";

  const dues = useMemo<CourseDue[] | null>(() => {
    if (coreUnresolved) return null;
    const out: CourseDue[] = [];
    for (const c of courses) {
      const pilotCore =
        c.slug === PILOT_COURSE_SLUG &&
        core.kind === "ready" &&
        pilotInRoster;
      if (pilotCore && core.kind === "ready") {
        const due = core.model.state.pendingReviews.filter(
          (r) => Date.parse(r.dueAt) <= now,
        ).length;
        out.push({ slug: c.slug, subject: c.subject, count: due, source: "account" });
        continue;
      }
      const bridge = bridges[c.slug];
      const progress = progressBySlug[c.slug];
      if (!bridge) {
        // bridge unresolved (undefined) or absent (null: import pending) —
        // null means the course honestly contributes nothing yet; undefined
        // means we are still loading, which hides the strip one turn longer
        if (bridges[c.slug] === null) {
          out.push({ slug: c.slug, subject: c.subject, count: 0, source: "device" });
        } else {
          return null;
        }
        continue;
      }
      const model = buildOverlay(progress, bridge, now);
      out.push({
        slug: c.slug,
        subject: c.subject,
        count: model.stats.reviewDue,
        source: "device",
      });
    }
    return out;
  }, [courses, bridges, progressBySlug, core, coreUnresolved, pilotInRoster, now]);

  const total = dues?.reduce((a, d) => a + d.count, 0) ?? 0;
  if (!dues || total === 0 || courses.length === 0) return null;

  // the CTA lands where the due queue actually lives: the account's queue on
  // /learner when the account contributed due points, the contributing
  // course's graph drawer (simulated path) when the evidence is device-side
  const anyAccount = dues.some((d) => d.source === "account" && d.count > 0);
  const firstDue = dues.find((d) => d.count > 0);
  const href =
    anyAccount
      ? "/learner" // My State tab renders the account's review queue
      : firstDue
        ? `/knowledge-graph?course=${firstDue.slug}` // the same drawer, simulated path
        : "/learner";

  return (
    <Card className="border-warn/30">
      <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
        <CalendarClock className="size-4 shrink-0 text-warn" aria-hidden="true" />
        <p className="text-sm font-medium">
          {plural(total, "spec point")} due for review now
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {dues
            .filter((d) => d.count > 0)
            .map((d) => (
              <Badge
                key={d.slug}
                variant="outline"
                className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground"
                title={
                  d.source === "account"
                    ? "Counted from your SyllabAI account's review schedule"
                    : "Counted from this device's marked attempts (Ebbinghaus decay model)"
                }
              >
                {d.subject} · {d.count} · {d.source === "account" ? "account" : "device"}
              </Badge>
            ))}
        </div>
        <Button asChild size="sm" className="ml-auto h-7 gap-1 text-xs">
          <Link href={href}>
            Review now
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
