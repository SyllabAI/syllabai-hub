"use client";

/**
 * TFA-07 drill-down panel (TEACHER_ARCHITECTURE §13.5 + §14): the class-KG
 * heatmap node becomes an affected-students panel, and each student opens
 * their individual subject graph — the SAME F-034 read model the student
 * themselves sees, rendered by the SAME KGExplorer engine (no second graph
 * implementation), behind the backend's roster gate (a non-member is a 404
 * before the UI ever decides anything).
 *
 * Data honesty: only this class's enabled members can appear (the
 * independent-student rule); an unmeasured student reads "No evidence yet"
 * with null mastery — never zero, never a fabricated band; the distribution
 * line restates the heatmap cell so the panel cannot disagree with the
 * graph it opened from; grey/dashed coverage stays a teaching-coverage
 * state, NOT a mastery state.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpenCheck,
  ClipboardList,
  GraduationCap,
  TriangleAlert,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { KGExplorer } from "@/components/kg-explorer/KGExplorer";
import { learnerKnowledgeGraphHost } from "@/components/kg-explorer/adapters";
import { formatRelative } from "@/lib/kg-learner-state";
import type {
  ClassNodeStudentView,
  ClassNodeStudentsView,
  LearnerKnowledgeGraphView,
} from "@/lib/types";

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** the ISO instants core serves → the shared relative-time formatter */
function relative(iso: string): string {
  return formatRelative(new Date(iso).getTime(), Date.now());
}

const BAND_BADGE: Record<string, { label: string; className: string }> = {
  LOW: { label: "Weak", className: "bg-rose-100 text-rose-800 border-rose-200" },
  DEVELOPING: {
    label: "Developing",
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
  SECURE: { label: "Secure", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
};

const COVERAGE_LABEL: Record<string, string> = {
  taught: "Taught",
  "not-taught": "Not taught yet",
  unrecorded: "No coverage recorded",
};

function bandBadge(band: string | null) {
  if (!band) return <span className="text-xs text-muted-foreground">No evidence yet</span>;
  const b = BAND_BADGE[band] ?? { label: band, className: "" };
  return (
    <Badge variant="outline" className={`text-[10px] ${b.className}`}>
      {b.label}
    </Badge>
  );
}

export function NodeDrillDown({
  classId,
  rootId,
  nodeId,
  onClose,
}: {
  classId: string;
  rootId: string;
  nodeId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<ClassNodeStudentsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the §14 leg: the selected student's individual graph
  const [student, setStudent] = useState<ClassNodeStudentView | null>(null);
  const [learnerKg, setLearnerKg] = useState<LearnerKnowledgeGraphView | null>(null);
  const [kgLoading, setKgLoading] = useState(false);
  const [kgError, setKgError] = useState<string | null>(null);

  // the §13.5 leg: one fetch per opened node (state lands in async callbacks
  // only — the house data-fetching pattern)
  useEffect(() => {
    if (nodeId == null) {
      setData(null);
      setStudent(null);
      setLearnerKg(null);
      setError(null);
      setKgError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStudent(null);
    setLearnerKg(null);
    setKgError(null);
    api
      .teacherClassNodeStudents(classId, rootId, nodeId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(apiMessage(e, "Could not load the node detail."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, rootId, nodeId]);

  const openStudent = async (s: ClassNodeStudentView) => {
    setStudent(s);
    setLearnerKg(null);
    setKgError(null);
    setKgLoading(true);
    try {
      setLearnerKg(
        await api.teacherClassLearnerKnowledgeGraph(classId, s.learnerId, rootId),
      );
    } catch (e) {
      setKgError(apiMessage(e, "Could not load this student's graph."));
    } finally {
      setKgLoading(false);
    }
  };

  const learnerHost = useMemo(
    () => (learnerKg ? learnerKnowledgeGraphHost(learnerKg) : null),
    [learnerKg],
  );

  const unmeasured =
    data == null
      ? 0
      : Math.max(
          0,
          data.learnersEnrolled -
            (data.strugglingCount + data.developingCount + data.proficientCount),
        );

  return (
    <Dialog
      open={nodeId != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        {student == null ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-lg">
                <Users className="size-5 text-primary" aria-hidden />
                {data ? data.nodeTitle : "Node detail"}
                {data?.nodeCode ? (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {data.nodeCode}
                  </Badge>
                ) : null}
                {data ? (
                  <Badge variant="outline" className="text-[10px]">
                    {COVERAGE_LABEL[data.coverageState] ?? data.coverageState}
                  </Badge>
                ) : null}
              </DialogTitle>
              <DialogDescription>
                §13.5 drill-down: which of this class&apos;s enrolled students need
                this node, and the evidence behind every number — the raw
                attempts included.
              </DialogDescription>
            </DialogHeader>

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-72" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : error ? (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" aria-hidden />
                <AlertTitle>Could not load the node detail</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : data ? (
              <div className="space-y-3">
                {/* the §13.3 distribution, restated — never disagreeing with the cell */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    <span className="font-medium text-rose-700">
                      {data.strugglingCount}
                    </span>{" "}
                    struggling
                  </span>
                  <span>
                    <span className="font-medium text-amber-700">
                      {data.developingCount}
                    </span>{" "}
                    developing
                  </span>
                  <span>
                    <span className="font-medium text-emerald-700">
                      {data.proficientCount}
                    </span>{" "}
                    proficient
                  </span>
                  <span>
                    <span className="font-medium">{unmeasured}</span> unmeasured
                  </span>
                  <span>
                    · {data.learnersEnrolled} enrolled member
                    {data.learnersEnrolled === 1 ? "" : "s"} — independent
                    students never appear here
                  </span>
                </div>

                {data.students.length === 0 ? (
                  <Alert>
                    <Users className="size-4" aria-hidden />
                    <AlertTitle>Nobody enrolled yet</AlertTitle>
                    <AlertDescription>
                      The panel fills in as students join the class — an empty
                      roster is the honest state, not an error.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Student</th>
                          <th className="px-3 py-2 font-medium">After decay</th>
                          <th className="px-3 py-2 font-medium">Attempts</th>
                          <th className="px-3 py-2 font-medium">Last practiced</th>
                          <th className="px-3 py-2 font-medium">Evidence</th>
                          <th className="px-3 py-2" aria-label="open graph" />
                        </tr>
                      </thead>
                      <tbody>
                        {data.students.map((s) => {
                          const activeMisco = s.misconceptions.filter((m) => m.active);
                          const accuracy =
                            s.attempts == null || s.attempts === 0
                              ? null
                              : Math.round(((s.correctCount ?? 0) / s.attempts) * 100);
                          return (
                            <tr key={s.learnerId} className="border-t align-middle">
                              <td className="px-3 py-2">
                                <div className="font-medium">{s.displayName}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                  {bandBadge(s.band)}
                                  {activeMisco.map((m) => (
                                    <Badge
                                      key={m.misconceptionNodeId}
                                      variant="outline"
                                      className="border-red-200 bg-red-50 text-[10px] text-red-800"
                                    >
                                      <TriangleAlert className="mr-1 size-3" aria-hidden />
                                      {m.title}
                                    </Badge>
                                  ))}
                                </div>
                              </td>
                              <td className="px-3 py-2 tabular-nums">
                                {s.effectiveMastery == null
                                  ? "—"
                                  : `${Math.round(s.effectiveMastery * 100)}%`}
                              </td>
                              <td className="px-3 py-2 tabular-nums">
                                {s.attempts == null
                                  ? "—"
                                  : `${s.attempts}${accuracy == null ? "" : ` · ${accuracy}%`}`}
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {s.lastPracticedAt == null
                                  ? "never"
                                  : relative(s.lastPracticedAt)}
                              </td>
                              <td className="px-3 py-2">
                                {s.recentAttempts.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">
                                    no attempts on this node
                                  </span>
                                ) : (
                                  <span className="flex flex-wrap gap-1">
                                    {s.recentAttempts.map((a) => (
                                      <Badge
                                        key={a.attemptId}
                                        variant="outline"
                                        className={`font-mono text-[10px] ${
                                          a.correct
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                            : "border-rose-200 bg-rose-50 text-rose-800"
                                        }`}
                                      >
                                        {a.questionRef ?? a.questionId.slice(0, 8)}
                                        {a.correct ? " ✓" : " ✗"}
                                      </Badge>
                                    ))}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void openStudent(s)}
                                >
                                  <GraduationCap className="mr-1 size-4" aria-hidden />
                                  Graph
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Member-only rows: only this class&apos;s enrolled students appear —
                  independent students never enter this panel, the distribution, or
                  the evidence list. &quot;No evidence yet&quot; is an honest absence,
                  never zero.
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-lg">
                <GraduationCap className="size-5 text-primary" aria-hidden />
                {student.displayName} — individual subject graph
                <Badge variant="outline" className="text-[10px]">
                  teacher view
                </Badge>
              </DialogTitle>
              <DialogDescription>
                The same graph {student.displayName.split(" ")[0]} sees in their own
                workspace — same read model, same state semantics; the teacher lens
                adds gates, not a second graph.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setStudent(null)}>
                <ArrowLeft className="mr-1 size-4" aria-hidden />
                Back to affected students
              </Button>
              {/* the §16 action loop — links to the real teacher surfaces */}
              <Button size="sm" variant="outline" asChild>
                <Link href="/teacher/test-builder">
                  <ClipboardList className="mr-1 size-4" aria-hidden />
                  Build a test
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/teacher/class">
                  <BookOpenCheck className="mr-1 size-4" aria-hidden />
                  Topic drill-down
                </Link>
              </Button>
            </div>

            {kgLoading ? (
              <Skeleton className="h-[520px] w-full" />
            ) : kgError ? (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" aria-hidden />
                <AlertTitle>Could not load this student&apos;s graph</AlertTitle>
                <AlertDescription>{kgError}</AlertDescription>
              </Alert>
            ) : learnerHost ? (
              <KGExplorer
                key={student.learnerId}
                host={learnerHost}
                height={520}
                title={`${
                  learnerKg?.rootCode ?? ""
                } — ${student.displayName} (teacher view)`}
                subtitle="the student's own subject graph — mastery, decay, review and misconception states as they see them"
              />
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
