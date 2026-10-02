"use client";

/**
 * Class knowledge graph — the teacher lens over the same subject graph
 * (TEACHER-2, spec: syllabai/syllabai TEACHER_ARCHITECTURE.md §13 + §16).
 *
 * The student graph (/knowledge-graph) answers "what do I know?"; this lens
 * answers "what have I taught, what does my class understand, and where is
 * intervention needed?":
 *   - every subtopic carries a teaching-coverage overlay (teacher-toggled,
 *     local store) that is SEMANTICALLY SEPARATE from understanding — grey
 *     means "not taught", never "weak" (§13.4's 2×2 is preserved: band chips
 *     stay visible for not-taught subtopics as prior-knowledge evidence);
 *   - class understanding uses the §13.1 bands and §13.3 distributions
 *     (proficient / developing / struggling), never a single average;
 *   - each node drills to misconceptions, mapped resources and a suggested
 *     action — a remediation Test Builder run preloaded with the subtopic
 *     (§16 teacher action loop).
 *
 * The byte-faithful student renderer iframe is deliberately untouched (the
 * integration doc keeps builds byte-faithful until Phase 3) — this is the
 * F-072 "Class KG heatmap" presentation of the same canonicalKG data.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  FileQuestion,
  Loader2,
  Network,
  ShieldAlert,
  Target,
  TriangleAlert,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TeacherNav } from "@/components/teacher/teacher-nav";
import { useTeachingCoverage } from "@/lib/teacher/stores";
import type { TeacherCourseData } from "@/lib/teacher/types";
import type { SubtopicAggregate, UnderstandingBand } from "@/lib/teacher/class-sim";
import type { SwitchableCourse } from "@/lib/teacher/types";
import { cn } from "@/lib/utils";

const BAND_LABEL: Record<UnderstandingBand, string> = {
  strong: "Strong understanding",
  good: "Good / secure",
  developing: "Developing",
  weak: "Weak",
  critical: "Critical weakness",
};

const BAND_CLASS: Record<UnderstandingBand, string> = {
  strong: "bg-chart-2/15 text-chart-2 border-chart-2/40",
  good: "bg-chart-2/10 text-foreground border-chart-2/30",
  developing: "bg-chart-4/15 text-foreground border-chart-4/40",
  weak: "bg-chart-5/15 text-foreground border-chart-5/40",
  critical: "bg-destructive/10 text-destructive border-destructive/40",
};

const BAND_BAR: Record<UnderstandingBand, string> = {
  strong: "bg-chart-2",
  good: "bg-chart-2/70",
  developing: "bg-chart-4",
  weak: "bg-chart-5",
  critical: "bg-destructive",
};

export function ClassGraphClient({
  courses,
  initialCourse,
}: {
  courses: SwitchableCourse[];
  initialCourse: string | null;
}) {
  const [course, setCourse] = useState<string | null>(initialCourse);
  // course-tagged payload state; loading derives from it (no sync setState)
  const [state, setState] = useState<{
    course: string;
    data?: TeacherCourseData;
    error?: string;
  } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const loading = course !== null && state?.course !== course;
  const data = state?.course === course ? state.data : undefined;
  const error = state?.course === course ? state.error : undefined;
  const { taught, toggle } = useTeachingCoverage(course ?? "");

  useEffect(() => {
    if (!course) return;
    let cancelled = false;
    fetch(`/api/teacher/course-data?slug=${encodeURIComponent(course)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`course data unavailable (${res.status})`);
        return (await res.json()) as TeacherCourseData;
      })
      .then((payload) => {
        if (!cancelled) setState({ course, data: payload });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ course, error: err instanceof Error ? err.message : "failed to load course" });
      });
    return () => {
      cancelled = true;
    };
  }, [course]);

  const subtopicList = useMemo(
    () => data?.class.sections.flatMap((s) => s.subtopics) ?? [],
    [data],
  );
  const taughtCount = useMemo(
    () => subtopicList.filter((s) => taught.has(s.code)).length,
    [subtopicList, taught],
  );

  const current = courses.find((c) => c.slug === course);

  return (
    <div className="space-y-6">
      <TeacherNav />

      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1 text-[10px] font-normal">
            <Network className="size-3" aria-hidden />
            Analytics · teacher
          </Badge>
          <Badge variant="secondary" className="text-[10px] font-normal">
            TEACHER_ARCHITECTURE §13
          </Badge>
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Class knowledge graph
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          A different lens over the same subject graph the students use. Teaching coverage
          (your overlay) and class understanding (aggregated evidence) are kept semantically
          separate — grey means <em>not taught</em>, never <em>weak</em>.
        </p>
      </header>

      {/* controls + disclosure */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <div className="relative">
          <select
            aria-label="Class course"
            value={course ?? ""}
            onChange={(e) => {
              setCourse(e.target.value || null);
              setExpanded(null);
            }}
            className="h-9 w-full appearance-none rounded-md border bg-background pr-8 pl-3 text-sm sm:w-80"
          >
            {courses.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label} ({c.code})
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
        {data && (
          <Badge variant="outline" className="gap-1 font-mono text-[10px] font-normal">
            {data.class.className} · {data.class.students} students
          </Badge>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          SAMPLE cohort — simulated evidence generated deterministically for the demo; real
          analytics need accounts + server-side attempts
        </span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> aggregating class evidence…
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Course data unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {data && (
        <>
          {/* summary strip */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="py-0">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Class mean mastery</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {(data.class.classMean * 100).toFixed(0)}%
                </p>
              </CardContent>
            </Card>
            <Card className="py-0">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Weakest area</p>
                {data.class.weakest ? (
                  <>
                    <p className="mt-1 truncate text-sm font-semibold">
                      {data.class.weakest.code} {data.class.weakest.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(data.class.weakest.meanMastery * 100).toFixed(0)}% mean
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-2xl">—</p>
                )}
              </CardContent>
            </Card>
            <Card className="py-0">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Teaching coverage</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {taughtCount}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{subtopicList.length} taught
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card className="py-0">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Sim-anchored areas</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.class.anchoredSubtopics}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{subtopicList.length}
                  </span>
                </p>
                <p className="text-[10px] text-muted-foreground">
                  rest is seeded SAMPLE evidence
                </p>
              </CardContent>
            </Card>
          </div>

          {/* legend (§13.1 semantics) */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm border bg-background" />
              not taught (no coverage recorded)
            </span>
            {(Object.keys(BAND_LABEL) as UnderstandingBand[]).map((band) => (
              <span key={band} className="flex items-center gap-1.5">
                <span className={cn("inline-block size-3 rounded-sm", BAND_BAR[band])} />
                {BAND_LABEL[band]}
              </span>
            ))}
          </div>

          {/* the graph-as-heatmap */}
          <div className="space-y-4">
            {data.class.sections.map((section) => (
              <Card key={section.code} className="py-0">
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2.5">
                    <span className="font-mono text-xs text-muted-foreground">
                      {section.code}
                    </span>
                    <h2 className="text-sm font-semibold">{section.title}</h2>
                  </div>
                  <ul className="divide-y">
                    {section.subtopics.map((sub) => (
                      <SubtopicRow
                        key={sub.code}
                        sub={sub}
                        isTaught={taught.has(sub.code)}
                        onToggle={() => toggle(sub.code)}
                        expanded={expanded === sub.code}
                        onExpand={() => setExpanded(expanded === sub.code ? null : sub.code)}
                        courseSlug={data.class.course.slug}
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SubtopicRow({
  sub,
  isTaught,
  onToggle,
  expanded,
  onExpand,
  courseSlug,
}: {
  sub: SubtopicAggregate;
  isTaught: boolean;
  onToggle: () => void;
  expanded: boolean;
  onExpand: () => void;
  courseSlug: string;
}) {
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        {/* coverage toggle — the teacher overlay */}
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={isTaught}
          title={isTaught ? "Taught — click to mark not taught" : "Not taught — click to mark taught"}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isTaught
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:border-primary/50",
          )}
        >
          <Check className="size-4" aria-hidden />
          <span className="sr-only">{isTaught ? "Taught" : "Not taught"}</span>
        </button>

        <button
          type="button"
          onClick={onExpand}
          aria-expanded={expanded}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <span className="font-mono text-xs text-muted-foreground">{sub.code}</span>{" "}
          <span className="text-sm font-medium">{sub.title}</span>
        </button>

        {/* understanding distribution — stacked, §13.3 */}
        <span className="hidden w-28 shrink-0 sm:block" aria-hidden>
          <span className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            <span
              className="bg-chart-2"
              style={{ width: `${sub.proficientPct}%` }}
            />
            <span
              className="bg-chart-4"
              style={{ width: `${sub.developingPct}%` }}
            />
            <span
              className="bg-destructive/70"
              style={{ width: `${sub.strugglingPct}%` }}
            />
          </span>
        </span>
        <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums">
          {(sub.meanMastery * 100).toFixed(0)}%
        </span>

        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
            isTaught ? BAND_CLASS[sub.band] : "border-border bg-background text-muted-foreground",
          )}
        >
          {BAND_LABEL[sub.band]}
        </span>

        {sub.misconceptions.length > 0 && (
          <Badge variant="outline" className="gap-1 border-warn/40 text-[10px] font-normal">
            <ShieldAlert className="size-3" aria-hidden />
            {sub.misconceptions.length}
          </Badge>
        )}
      </div>

      {/* node detail panel (§13.5) */}
      {expanded && (
        <div className="space-y-4 border-t bg-muted/20 px-4 py-4 sm:pl-14">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold">Class understanding distribution</p>
              <ul className="mt-2 space-y-1 text-xs">
                <li className="flex items-center gap-2">
                  <span className="w-20 text-muted-foreground">Proficient</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-chart-2"
                      style={{ width: `${sub.proficientPct}%` }}
                    />
                  </span>
                  <span className="w-9 text-right tabular-nums">{sub.proficientPct}%</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-20 text-muted-foreground">Developing</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-chart-4"
                      style={{ width: `${sub.developingPct}%` }}
                    />
                  </span>
                  <span className="w-9 text-right tabular-nums">{sub.developingPct}%</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-20 text-muted-foreground">Struggling</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-destructive/70"
                      style={{ width: `${sub.strugglingPct}%` }}
                    />
                  </span>
                  <span className="w-9 text-right tabular-nums">{sub.strugglingPct}%</span>
                </li>
              </ul>
              <p className="mt-2 text-[10px] text-muted-foreground">
                teaching status:{" "}
                <span className={isTaught ? "font-medium text-foreground" : ""}>
                  {isTaught ? "TAUGHT" : "NOT_TAUGHT"}
                </span>
                {sub.hasSimEvidence
                  ? " · anchored to the /learner corpus sim"
                  : " · seeded SAMPLE evidence"}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold">Common misconceptions</p>
              {sub.misconceptions.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {sub.misconceptions.map((m) => (
                    <li key={m.code} className="rounded-md border bg-background p-2">
                      <p className="flex items-start gap-1.5 text-xs leading-relaxed">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
                        {m.title}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        prevalence {(m.probability * 100).toFixed(0)}% · {m.evidenceCount} evidence
                        events
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">none recorded for this area</p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold">Mapped resources</p>
              <ul className="mt-2 space-y-1.5 text-xs">
                <li>
                  <Link
                    href={`/courses/${courseSlug}/revision-notes`}
                    className="flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
                  >
                    <BookOpen className="size-3.5" aria-hidden /> Revision notes
                  </Link>
                </li>
                <li>
                  <Link
                    href={`/courses/${courseSlug}/exam-questions`}
                    className="flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
                  >
                    <FileQuestion className="size-3.5" aria-hidden /> Exam questions
                  </Link>
                </li>
                <li>
                  <Link
                    href={`/courses/${courseSlug}/flashcards`}
                    className="flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
                  >
                    <CircleHelp className="size-3.5" aria-hidden /> Flashcards
                  </Link>
                </li>
              </ul>
              <p className="mt-3 text-xs font-semibold">Suggested teacher action</p>
              <Button asChild size="sm" className="mt-2 gap-1.5">
                <Link
                  href={`/teacher/test-builder?course=${courseSlug}&subtopics=${encodeURIComponent(sub.code)}`}
                >
                  <Target className="size-3.5" aria-hidden />
                  Build a remediation test
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
