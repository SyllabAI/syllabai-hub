"use client";

/**
 * Teacher class intelligence — ported from syllabai-web's
 * ClassIntelligenceView (productization sprint 2 §2–§5) onto the hub
 * (teacher-console tranche, 2026-09-28): the smallest real production
 * version of student attempts → learning evidence → learner state →
 * class-level aggregation → teacher insight → intervention, reading live
 * core data.
 *
 * Evidence semantics (§4, non-negotiable): mastery comes ONLY from graded
 * evidence (BKT); misconceptions are BDT estimates; asking the Tutor is
 * engagement — interest or doubt, never weakness. Unmeasured reads as
 * unmeasured: null means, "—" cells, no fabricated values anywhere.
 *
 * Hub adaptation: the subject list is loaded from core here (web received it
 * as a prop from the workbench); the default subject is the first one with a
 * knowledge-graph root.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Activity,
  BrainCircuit,
  ClipboardCheck,
  Eye,
  GraduationCap,
  Layers,
  Network,
  Radar,
  TriangleAlert,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { TeacherNav } from "@/components/teacher/teacher-nav";
import { formatRelative, humanizeCode } from "@/lib/format";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KGExplorer } from "@/components/kg-explorer/KGExplorer";
import { classGraphHost } from "@/components/kg-explorer/adapters";
import type {
  ClassLearnerRow,
  ClassOverviewView,
  ClassTopicAggregate,
  ClassTopicDrillDown,
  SubjectView,
  TestPreviewView,
} from "@/lib/types";

export function ClassIntelligenceClient() {
  // subject list loaded from core (hub adaptation — web got it as a prop)
  const [subjects, setSubjects] = useState<SubjectView[] | null>(null);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);

  const [rootId, setRootId] = useState<string | null>(null);
  const [overview, setOverview] = useState<ClassOverviewView | null>(null);
  const [learners, setLearners] = useState<ClassLearnerRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // drill-down state (§5): class → topic → learners → evidence → intervention
  const [drillTopic, setDrillTopic] = useState<ClassTopicAggregate | null>(null);
  const [drill, setDrill] = useState<ClassTopicDrillDown | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  // intervention leg (§3): assemble a validated remediation test for the topic
  const [remediation, setRemediation] = useState<TestPreviewView | null>(null);
  const [remediationBusy, setRemediationBusy] = useState(false);
  const [remediationError, setRemediationError] = useState<string | null>(null);
  // heatmap ordering: curriculum order (default) or weakest-first
  const [weakestFirst, setWeakestFirst] = useState(false);
  // class graph: the v75 explorer over the same aggregates (session-129 port)
  const [showGraph, setShowGraph] = useState(false);

  // load the subject list once; default to the first subject with a KG root
  useEffect(() => {
    let cancelled = false;
    api
      .subjects()
      .then((list) => {
        if (cancelled) return;
        setSubjects(list);
        setRootId((current) => current ?? list.find((s) => s.knowledgeNodeId)?.knowledgeNodeId ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setSubjectsError(e instanceof ApiError ? e.message : "Could not load the subject list.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async (root: string) => {
    setLoading(true);
    setError(null);
    setOverview(null);
    setLearners(null);
    setDrillTopic(null);
    setDrill(null);
    setRemediation(null);
    try {
      const [o, l] = await Promise.all([api.classOverview(root), api.classLearners(root)]);
      setOverview(o);
      setLearners(l);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load class analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (rootId) void load(rootId);
  }, [rootId, load]);

  const openDrillDown = useCallback(async (topic: ClassTopicAggregate) => {
    if (!rootId) return;
    setDrillTopic(topic);
    setDrill(null);
    setDrillError(null);
    setRemediation(null);
    setRemediationError(null);
    setDrillLoading(true);
    try {
      setDrill(await api.classTopicDrillDown(rootId, topic.nodeId));
    } catch (err) {
      setDrillError(err instanceof ApiError ? err.message : "Failed to load topic drill-down");
    } finally {
      setDrillLoading(false);
    }
  }, [rootId]);

  const assembleRemediation = useCallback(async () => {
    if (!rootId || !drillTopic) return;
    setRemediationBusy(true);
    setRemediationError(null);
    setRemediation(null);
    try {
      setRemediation(
        await api.testBuilderPreview(rootId, [drillTopic.nodeId], 20, undefined, true),
      );
    } catch (err) {
      setRemediationError(
        err instanceof ApiError ? err.message : "Failed to assemble remediation test",
      );
    } finally {
      setRemediationBusy(false);
    }
  }, [rootId, drillTopic]);

  /** heatmap rows: curriculum order, or measured-weakest first */
  const topicRows = useMemo(() => {
    if (!overview) return [];
    if (!weakestFirst) return overview.topics;
    const bandRank: Record<string, number> = { LOW: 0, DEVELOPING: 1, SECURE: 2, UNMEASURED: 3 };
    return [...overview.topics].sort(
      (a, b) =>
        (bandRank[a.masteryBand] ?? 3) - (bandRank[b.masteryBand] ?? 3) ||
        (a.meanMastery ?? 1) - (b.meanMastery ?? 1) ||
        a.code.localeCompare(b.code),
    );
  }, [overview, weakestFirst]);

  const subjectOptions = useMemo(
    () =>
      (subjects ?? []).filter((s): s is SubjectView & { knowledgeNodeId: string } =>
        Boolean(s.knowledgeNodeId)),
    [subjects],
  );

  if (subjectsError) {
    return (
      <div className="space-y-6">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Class insights
          </h1>
        </div>
        <TeacherNav />
        <Alert variant="destructive">
          <AlertTitle>Could not load subjects</AlertTitle>
          <AlertDescription>{subjectsError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (subjects !== null && subjects.length === 0) {
    return (
      <div className="space-y-6">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Class insights
          </h1>
        </div>
        <TeacherNav />
        <Alert>
          <AlertTitle>No subjects available</AlertTitle>
          <AlertDescription>The curriculum has not been initialised yet.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Class insights
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Live from the SyllabAI backend — class-level facts over the whole pilot cohort, separated
          by evidence kind.
        </p>
      </div>

      <TeacherNav />

      {/* ── evidence semantics banner (§4) ───────────────────────────── */}
      <Alert>
        <Radar className="size-4" aria-hidden="true" />
        <AlertTitle>Class insights — evidence, separated by kind</AlertTitle>
        <AlertDescription>
          Mastery means graded practice (BKT); misconception signals are BDT estimates; asking the
          Tutor is engagement — interest or doubt, <strong>never</strong> weakness. Topics and
          learners without evidence read <em>unmeasured</em>, never zero. Read-only: nothing here
          changes learner state.
        </AlertDescription>
      </Alert>

      {/* ── subject + refresh ────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="min-w-56 space-y-1.5">
            <label htmlFor="ci-subject" className="text-sm font-medium">
              Subject
            </label>
            {subjects === null ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <select
                id="ci-subject"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={rootId ?? ""}
                onChange={(e) => setRootId(e.target.value || null)}
              >
                <option value="" disabled>
                  Select subject…
                </option>
                {subjectOptions.map((s) => (
                  <option key={s.id} value={s.knowledgeNodeId}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            )}
          </div>
          {overview && (
            <Button variant="outline" size="sm" className="h-9" onClick={() => rootId && void load(rootId)}>
              <Activity className="size-4" aria-hidden="true" />
              Refresh
            </Button>
          )}
          {overview && (
            <p className="ml-auto text-xs text-muted-foreground">
              policy {overview.policy} · window since {formatRelative(overview.recentActivity.windowStart)}
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load class analytics</AlertTitle>
          <AlertDescription>
            {error}
            {rootId && (
              <Button variant="outline" size="sm" className="h-9" onClick={() => void load(rootId)}>
                <Activity className="size-4" aria-hidden="true" />
                Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {loading && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {overview && learners && (
        <>
          {/* ── class graph explorer toggle (v75 port) ───────────── */}
          <div className="flex justify-end">
            <ToggleGroup
              type="single"
              value={showGraph ? "graph" : "tables"}
              onValueChange={(v) => setShowGraph(v === "graph")}
              aria-label="Class insights view"
            >
              <ToggleGroupItem value="tables" className="gap-1.5 text-xs">
                <ClipboardCheck className="size-3.5" aria-hidden="true" />
                Tables
              </ToggleGroupItem>
              <ToggleGroupItem value="graph" className="gap-1.5 text-xs">
                <Network className="size-3.5" aria-hidden="true" />
                Class graph
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {showGraph && (
            <KGExplorer
              key={overview.rootId + overview.measuredTopics}
              height={620}
              title={`${overview.rootCode} — class graph`}
              subtitle="class mean mastery · misconception signals · reviews due · engagement"
              host={classGraphHost(
                overview,
                drill ? { topicNodeId: drill.topic.nodeId, affectedLearners: drill.affectedLearners } : null,
                {
                  onOpenDrillDown: (t) => void openDrillDown(t),
                },
              )}
            />
          )}

          {!showGraph && (
          <>
          {/* ── overview stats (§2 class overview) ────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              icon={<Users className="size-4 text-primary" aria-hidden="true" />}
              label="Cohort"
              value={`${overview.learnersWithEvidence} / ${overview.enrolledLearners}`}
              hint="learners with subject evidence · enabled learner accounts"
            />
            <StatCard
              icon={<Activity className="size-4 text-primary" aria-hidden="true" />}
              label="Recently active"
              value={String(overview.recentActivity.learnersActive)}
              hint={`${overview.recentActivity.recentAttempts} attempts in the last 14 days`}
            />
            <StatCard
              icon={<Layers className="size-4 text-primary" aria-hidden="true" />}
              label="Topic coverage"
              value={`${overview.measuredTopics} / ${overview.totalTopics}`}
              hint="curriculum nodes with any measured learner"
            />
            <StatCard
              icon={<BrainCircuit className="size-4 text-primary" aria-hidden="true" />}
              label="Tutor engagement"
              value={String(overview.recentActivity.tutorAsks)}
              hint="topic asks (interest/doubt — not mastery)"
            />
            <StatCard
              icon={<ClipboardCheck className="size-4 text-primary" aria-hidden="true" />}
              label="Marking queue"
              value={String(overview.recentActivity.structuredAnswersPendingMarking)}
              hint="structured answers pending human marking"
            />
            <StatCard
              icon={<GraduationCap className="size-4 text-primary" aria-hidden="true" />}
              label="Servable questions"
              value={String(
                overview.topics.reduce((sum, t) => sum + t.servableQuestions, 0),
              )}
              hint="validated questions topic-mapped in this subject"
            />
          </div>

          {/* ── weak prerequisites (§2 prerequisite intelligence) ─────── */}
          {overview.weakPrerequisites.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TriangleAlert className="size-4 text-primary" aria-hidden="true" />
                  Weak prerequisite areas
                  <Badge variant="secondary" className="ml-1">
                    {overview.weakPrerequisites.length}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Prerequisites the class measures weak (below the same LOW ceiling the learner
                  surfaces use), with the dependents that build on them — remediate here first.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {overview.weakPrerequisites.map((w) => (
                  <div
                    key={w.prerequisiteNodeId}
                    className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {w.prerequisiteCode}
                    </span>
                    <span className="text-sm font-medium">{w.prerequisiteTitle}</span>
                    <MasteryBadge band={w.masteryBand} mastery={w.meanMastery} />
                    <span className="text-xs text-muted-foreground">
                      {w.learnersMeasured} measured
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      blocks:{" "}
                      {w.dependents.map((d) => (
                        <Badge key={d.nodeId} variant="outline" className="ml-1 font-mono">
                          {d.code}
                        </Badge>
                      ))}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ── topic heatmap (§2) + drill-down entry (§5) ────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="size-4 text-primary" aria-hidden="true" />
                Topic heatmap
                <Badge variant="secondary" className="ml-1">
                  {overview.measuredTopics}/{overview.totalTopics} measured
                </Badge>
              </CardTitle>
              <CardDescription>
                Class mastery and evidence per curriculum node. Open a topic — click its name, or
                focus it and press Enter — to drill into affected learners, evidence and
                remediation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Order:</span>
                <Button
                  variant={weakestFirst ? "outline" : "secondary"}
                  size="sm"
                  className="h-9"
                  onClick={() => setWeakestFirst(false)}
                >
                  Curriculum
                </Button>
                <Button
                  variant={weakestFirst ? "secondary" : "outline"}
                  size="sm"
                  className="h-9"
                  onClick={() => setWeakestFirst(true)}
                >
                  Weakest first
                </Button>
              </div>
              {topicRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No curriculum topics are mapped to this subject yet — the heatmap appears once
                  the curriculum and its evidence exist.
                </p>
              ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Topic</th>
                      <th className="px-3 py-2 font-medium">Class mastery</th>
                      <th className="px-3 py-2 font-medium">Measured</th>
                      <th className="px-3 py-2 font-medium">Attempts</th>
                      <th className="px-3 py-2 font-medium">Misconceptions</th>
                      <th className="px-3 py-2 font-medium">Tutor asks</th>
                      <th className="px-3 py-2 font-medium">Servable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topicRows.map((t) => (
                      <tr
                        key={t.nodeId}
                        className={`group cursor-pointer border-t hover:bg-muted/40 ${
                          drillTopic?.nodeId === t.nodeId ? "bg-muted/60" : ""
                        }`}
                        onClick={(e) => {
                          // P2-2: keyboard access lives in the topic-name button
                          // below — skip it here so a button click doesn't
                          // double-fire the drill-down (same guard shape as the
                          // course drawer's closest("a")).
                          if ((e.target as HTMLElement).closest("button")) return;
                          void openDrillDown(t);
                        }}
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => void openDrillDown(t)}
                            className="rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="block font-mono text-xs text-muted-foreground">
                              {t.parentCode ? `${t.parentCode} › ` : ""}
                              {t.code}
                            </span>
                            <span className="block font-medium underline-offset-2 group-hover:underline">
                              {t.title}
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <MasteryBadge band={t.masteryBand} mastery={t.meanMastery} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{t.learnersMeasured}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {t.evidenceBackedAttempts}
                        </td>
                        <td className="px-3 py-2">
                          {t.activeMisconceptionSignals > 0 ? (
                            <Badge variant="destructive">
                              {t.activeMisconceptionSignals} · {t.learnersWithActiveMisconception}{" "}
                              learners
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {t.tutorEngagements > 0 ? t.tutorEngagements : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {t.servableQuestions > 0 ? t.servableQuestions : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </CardContent>
          </Card>

          {/* ── drill-down (§5) ───────────────────────────────────────── */}
          {drillTopic && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Eye className="size-4 text-primary" aria-hidden="true" />
                  Drill-down: {drillTopic.code} — {drillTopic.title}
                </CardTitle>
                <CardDescription>
                  Class → topic → affected learners → evidence → intervention.
                  {drillTopic.parentTitle && ` Part of ${drillTopic.parentTitle}.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {drillError && (
                  <Alert variant="destructive">
                    <AlertTitle>Could not load the drill-down</AlertTitle>
                    <AlertDescription>
                      {drillError}
                      {drillTopic && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9"
                          onClick={() => void openDrillDown(drillTopic)}
                        >
                          <Eye className="size-4" aria-hidden="true" />
                          Retry
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {drillLoading && <Skeleton className="h-32 w-full" />}

                {drill && (
                  <>
                    {/* prerequisite chain */}
                    <section className="space-y-1.5">
                      <h4 className="text-sm font-semibold">Prerequisite chain</h4>
                      {drill.prerequisiteChain.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No prerequisite edges from this topic in the validated graph.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {drill.prerequisiteChain.map((p) => (
                            <div
                              key={p.nodeId}
                              className="flex items-center gap-2 rounded-md border px-2 py-1"
                              style={{ marginLeft: `${(p.depth - 1) * 12}px` }}
                            >
                              <span className="font-mono text-xs text-muted-foreground">
                                {p.code}
                              </span>
                              <span className="text-xs">{p.title}</span>
                              <MasteryBadge band={p.masteryBand} mastery={p.meanMastery} />
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* affected learners */}
                    <section className="space-y-1.5">
                      <h4 className="text-sm font-semibold">
                        Learners needing attention
                        <Badge variant="secondary" className="ml-2">
                          {drill.affectedLearners.length}
                        </Badge>
                      </h4>
                      {drill.affectedLearners.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No learner measures weak here (weakness needs at least 2 graded attempts;
                          misconceptions need an active BDT estimate).
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {drill.affectedLearners.map((a) => (
                            <div
                              key={a.learnerId}
                              className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
                            >
                              <span className="text-sm font-medium">{a.displayName}</span>
                              <Badge variant="outline">{humanizeCode(a.reason)}</Badge>
                              {a.mastery != null && <MasteryBadge band="" mastery={a.mastery} />}
                              {a.misconceptions.map((m) => (
                                <Badge key={m.misconceptionNodeId} variant="destructive">
                                  {m.code} · p={m.probability.toFixed(2)} · {m.evidenceCount}{" "}
                                  evidence
                                </Badge>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* representative evidence */}
                    <section className="space-y-1.5">
                      <h4 className="text-sm font-semibold">
                        Representative evidence
                        <Badge variant="secondary" className="ml-2">
                          {drill.representativeEvidence.length}
                        </Badge>
                      </h4>
                      {drill.representativeEvidence.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No attempts mapped to this topic yet.
                        </p>
                      ) : (
                        <div className="overflow-x-auto rounded-md border">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50 text-left">
                              <tr>
                                <th className="px-3 py-2 font-medium">Learner</th>
                                <th className="px-3 py-2 font-medium">Question</th>
                                <th className="px-3 py-2 font-medium">Result</th>
                                <th className="px-3 py-2 font-medium">Marking</th>
                                <th className="px-3 py-2 font-medium">When</th>
                              </tr>
                            </thead>
                            <tbody>
                              {drill.representativeEvidence.map((e) => (
                                <tr key={e.attemptId} className="border-t">
                                  <td className="px-3 py-2">{e.learnerDisplayName}</td>
                                  <td className="px-3 py-2 font-mono text-xs">
                                    {e.questionRef ?? "?"}
                                  </td>
                                  <td className="px-3 py-2">
                                    {e.correct ? (
                                      <Badge
                                        variant="secondary"
                                        className="text-success"
                                      >
                                        correct
                                      </Badge>
                                    ) : (
                                      <Badge variant="destructive">
                                        {e.marksAwarded != null
                                          ? `${e.marksAwarded}/${e.questionMarks}`
                                          : "incorrect"}
                                      </Badge>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-muted-foreground">
                                    {humanizeCode(e.markingState)}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-muted-foreground">
                                    {formatRelative(e.createdAt)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    {/* intervention (§3): validated questions + test assembly */}
                    <section className="space-y-1.5">
                      <h4 className="text-sm font-semibold">
                        Intervene
                        <Badge variant="secondary" className="ml-2">
                          {drill.servableQuestions.length} validated questions
                        </Badge>
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        Assemble a remediation test from validated questions mapped to this topic
                        (the same serving boundary learners practice through — unvalidated content
                        can never enter).
                      </p>
                      {drill.servableQuestions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No validated questions mapped to this topic yet — the content lane is
                          still growing coverage here.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <Button
                            size="sm"
                            className="h-9"
                            onClick={() => void assembleRemediation()}
                            disabled={remediationBusy}
                          >
                            <ClipboardCheck className="size-4" aria-hidden="true" />
                            {remediationBusy
                              ? "Assembling…"
                              : "Assemble remediation test for this topic"}
                          </Button>
                          {remediationError && (
                            <Alert variant="destructive">
                              <AlertTitle>Could not assemble the test</AlertTitle>
                              <AlertDescription>
                                {remediationError}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-9"
                                  onClick={() => void assembleRemediation()}
                                >
                                  <ClipboardCheck className="size-4" aria-hidden="true" />
                                  Retry
                                </Button>
                              </AlertDescription>
                            </Alert>
                          )}
                          {remediation && (
                            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                              <p>
                                <strong>{remediation.questionCount} questions</strong> ·{" "}
                                <strong>{remediation.totalMarks} marks</strong> · answer key
                                included
                              </p>
                              <p className="mt-1 font-mono text-xs text-muted-foreground">
                                {remediation.questions.map((q) => q.topicCode).join(", ")}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Open the Test Builder for the printable layout and mark scheme.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── learner list (§2) ─────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4 text-primary" aria-hidden="true" />
                Learners
                <Badge variant="secondary" className="ml-1">
                  {learners.length}
                </Badge>
              </CardTitle>
              <CardDescription>
                Attention order: measured-weakest first, unmeasured last. Weakest topics need at
                least 2 graded attempts; Tutor asks are engagement, not mastery.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Learner</th>
                      <th className="px-3 py-2 font-medium">Mean mastery</th>
                      <th className="px-3 py-2 font-medium">Weakest topics</th>
                      <th className="px-3 py-2 font-medium">Misconception signals</th>
                      <th className="px-3 py-2 font-medium">Recent</th>
                      <th className="px-3 py-2 font-medium">Tutor</th>
                      <th className="px-3 py-2 font-medium">Due reviews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {learners.map((l) => (
                      <tr key={l.learnerId} className="border-t align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.displayName}</div>
                          <div className="text-xs text-muted-foreground">
                            {l.evidenceState === "UNMEASURED"
                              ? "no evidence in this subject yet"
                              : `${l.topicsMeasured} topics measured`}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {l.meanMastery != null ? (
                            <span className="font-medium">{l.meanMastery.toFixed(2)}</span>
                          ) : (
                            <span className="text-muted-foreground">unmeasured</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {l.weakestTopics.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {l.weakestTopics.map((t) => (
                                <Badge
                                  key={t.nodeId}
                                  variant="outline"
                                  className="font-mono"
                                  title={`${t.title} · ${t.mastery.toFixed(2)} · ${t.attempts} attempts`}
                                >
                                  {t.code}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {l.misconceptionSignals.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {l.misconceptionSignals.map((m) => (
                                <Badge
                                  key={m.misconceptionNodeId}
                                  variant="destructive"
                                  title={`${m.title} (under ${m.parentTopicCode ?? "?"})`}
                                >
                                  {m.code} · {m.probability.toFixed(2)}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {l.recentAttempts > 0 ? (
                            <span>
                              {l.recentCorrect}/{l.recentAttempts} correct
                              <div className="text-muted-foreground">
                                {l.lastActivityAt ? formatRelative(l.lastActivityAt) : ""}
                              </div>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {l.tutorEngagements > 0 ? (
                            <span>
                              {l.tutorEngagements} asks
                              <div className="text-muted-foreground">
                                {l.lastTutorEngagementAt
                                  ? formatRelative(l.lastTutorEngagementAt)
                                  : ""}
                              </div>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {l.dueReviews > 0 ? (
                            <Badge variant="outline">{l.dueReviews}</Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          </>
          )}
        </>
      )}
    </div>
  );
}

/** mastery chip with the SAME band vocabulary as the learner surfaces */
function MasteryBadge({ band, mastery }: { band: string; mastery: number | null }) {
  if (mastery == null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        unmeasured
      </Badge>
    );
  }
  if (band === "LOW") {
    return <Badge variant="destructive">{(mastery * 100).toFixed(0)}% · low</Badge>;
  }
  if (band === "SECURE") {
    return (
      <Badge variant="secondary" className="text-success">
        {(mastery * 100).toFixed(0)}% · secure
      </Badge>
    );
  }
  if (band === "DEVELOPING") {
    return (
      <Badge variant="secondary" className="text-warn">
        {(mastery * 100).toFixed(0)}% · developing
      </Badge>
    );
  }
  return <Badge variant="secondary">{(mastery * 100).toFixed(0)}%</Badge>;
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
