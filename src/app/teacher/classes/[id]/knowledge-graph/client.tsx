"use client";

/**
 * The F-072 class knowledge-graph heatmap (T-C35): one class's curriculum
 * rendered through the SAME KGExplorer engine every other KG surface uses,
 * colored by the taught/not-taught × understanding matrix (§13.4).
 *
 * Data honesty: everything on this page is live core data for THIS class —
 * the aggregation covers only the class's enrolled students (the
 * independent-student rule: a student without a membership row never moves
 * a number here). Unmeasured nodes are shown as unmeasured; unrecorded
 * coverage is shown as no ring — grey/dashed means "not yet taught", a
 * teaching-coverage state, never low understanding. An archived class stays
 * readable (a past class's heatmap is still a fact), marked read-only here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, TriangleAlert } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { TeacherNav } from "@/components/teacher/teacher-nav";
import { KGExplorer } from "@/components/kg-explorer/KGExplorer";
import { classKnowledgeGraphHost } from "@/components/kg-explorer/adapters";
import type {
  ClassKnowledgeGraphView,
  SubjectView,
  TeacherClassDetailView,
} from "@/lib/types";

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** the engine's band palette (styles.ts bandColor) — restated for the legend */
const RING_LEGEND: { color: string; label: string; dashed?: boolean }[] = [
  { color: "#2a8b8a", label: "Taught · strong" },
  { color: "#4a9b70", label: "Taught · good" },
  { color: "#c38422", label: "Taught · developing" },
  { color: "#c85b78", label: "Taught · weak" },
  { color: "#a09a8c", label: "Not taught yet", dashed: true },
  { color: "#a09a8c", label: "No coverage recorded (no ring)" },
];

export function ClassKGClient({ classId }: { classId: string }) {
  const [detail, setDetail] = useState<TeacherClassDetailView | null>(null);
  const [subjects, setSubjects] = useState<SubjectView[] | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  const [kg, setKg] = useState<ClassKnowledgeGraphView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // one bootstrap fetch: the class (name, course, status) + the subject list
  // (state lands in async callbacks only — the house data-fetching pattern)
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const [d, s] = await Promise.all([api.teacherClassDetail(classId), api.subjects()]);
        if (cancelled) return;
        setDetail(d);
        setSubjects(s);
        // the subject whose knowledge graph this class renders — Paper B is
        // one subject, so the first root wins; the header states which
        // subject is shown (honest labeling beats silent guessing)
        setRootId((current) => current ?? s.find((x) => x.knowledgeNodeId)?.knowledgeNodeId ?? null);
      } catch (e) {
        if (!cancelled) setError(apiMessage(e, "Could not load the class."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const loadKG = useCallback(
    async (root: string) => {
      setError(null);
      try {
        setKg(await api.teacherClassKnowledgeGraph(classId, root));
      } catch (err) {
        setError(apiMessage(err, "Could not load the class knowledge graph."));
        setKg(null);
      }
    },
    [classId],
  );

  useEffect(() => {
    if (rootId) void loadKG(rootId);
  }, [rootId, loadKG]);

  const host = useMemo(() => (kg ? classKnowledgeGraphHost(kg) : null), [kg]);
  const subject =
    subjects?.find((s) => s.knowledgeNodeId && s.knowledgeNodeId === rootId) ?? null;
  const archived = detail?.status === "archived";

  return (
    <div className="space-y-4">
      <TeacherNav />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/teacher/classes/${classId}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← {detail ? detail.name : "Class"}
            </Link>
            {archived ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                archived · read-only
              </Badge>
            ) : null}
          </div>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
            <Network className="size-6 text-primary" aria-hidden />
            Class KG heatmap
            {subject ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                {subject.code}
              </Badge>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail ? `${detail.name} · ${detail.courseLabel}` : "Class"}
            {kg
              ? ` · ${kg.learnersEnrolled} enrolled member${kg.learnersEnrolled === 1 ? "" : "s"}`
              : ""}
            {" · "}
            <span className="text-xs">
              only this class&apos;s enrolled students count — independent students never
              enter these numbers
            </span>
          </p>
        </div>
      </div>

      {/* the ring legend — the §13.4 semantics, stated where the teacher reads */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {RING_LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle
                cx="7"
                cy="7"
                r="4.5"
                fill="none"
                stroke={l.color}
                strokeWidth="2"
                strokeDasharray={l.dashed ? "2 3" : undefined}
              />
            </svg>
            {l.label}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-[560px] w-full rounded-xl" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" aria-hidden />
          <AlertTitle>Could not load the heatmap</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : rootId == null ? (
        <Alert>
          <TriangleAlert className="size-4" aria-hidden />
          <AlertTitle>No subject knowledge graph available</AlertTitle>
          <AlertDescription>
            The backend has no subject with a knowledge-graph root yet — the heatmap
            renders once the curriculum exists.
          </AlertDescription>
        </Alert>
      ) : host ? (
        <KGExplorer
          key={`${rootId}:${kg?.learnersEnrolled ?? 0}`}
          host={host}
          height={640}
          title={`${kg?.rootCode ?? ""} — ${detail?.name ?? "class"} heatmap`}
          subtitle="teaching coverage × class understanding · enrolled members only"
        />
      ) : null}
    </div>
  );
}
