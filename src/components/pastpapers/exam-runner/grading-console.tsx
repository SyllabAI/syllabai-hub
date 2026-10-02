/**
 * GradingConsole — where Pearson stops and we don't (design §5.4).
 *
 * Per question: attested-key MCQs auto-mark (choice captured on the paper or
 * re-asked here); structured parts self-mark against the MS with an optional
 * ai-suggested probe; every mark carries its `how` provenance (display-honest,
 * N-5: v1 does not re-weight learner-model evidence). At finish, per-part
 * submissions ride the existing attempt-bridge (pilot, verified joins only)
 * and the PaperRunResult v3 lands in the local results strip.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Info, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { coreEvidenceChanged, useAttemptBridge } from "@/lib/attempt-bridge";
import { saveMockResult } from "@/lib/mock-results";
import {
  partKeyOf,
  BuiltinHeader,
  type ReconForRun,
} from "@/components/pastpapers/exam-runner/exam-runner";
import { PdfCanvas } from "@/components/pastpapers/exam-runner/pdf-canvas";
import type {
  MarkHow,
  PaperRunManifest,
  PaperRunRecord,
  PaperRunResult,
  PartMark,
} from "@/lib/paper-run/types";

// one availability probe per session (the route 501s until core-backed AI
// marking ships — the affordance stays hidden while it does)
let aiProbe: Promise<boolean> | null = null;
function aiMarkAvailable(): Promise<boolean> {
  aiProbe ??= fetch("/api/ai/mark")
    .then((r) => r.json())
    .then((j: { available?: boolean }) => !!j.available)
    .catch(() => false);
  return aiProbe;
}

interface GradingConsoleProps {
  course: string;
  manifest: PaperRunManifest;
  record: PaperRunRecord;
  msUrl: string;
  paperTitle: string;
  backHref: string;
  recon: ReconForRun | null;
  coverageState: "full" | "partial";
  result: PaperRunResult | null;
  onDone: (r: PaperRunResult) => void;
}

export function GradingConsole({
  course,
  manifest,
  record,
  msUrl,
  paperTitle,
  backHref,
  recon,
  coverageState,
  result,
  onDone,
}: GradingConsoleProps) {
  const [marks, setMarks] = useState<Record<string, PartMark>>({});
  const [msOpen, setMsOpen] = useState(false);
  const [msPage, setMsPage] = useState(1);
  const [aiOk, setAiOk] = useState(false);
  const [aiBusyFor, setAiBusyFor] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [coreMsg, setCoreMsg] = useState<string | null>(null);
  const submittedRef = useRef(false);

  const bridge = useAttemptBridge(
    course,
    manifest.paper.reconKey ?? "__none__",
  );

  useEffect(() => {
    aiMarkAvailable().then(setAiOk);
  }, []);

  const putMark = useCallback((key: string, mark: PartMark) => {
    setMarks((prev) => ({ ...prev, [key]: mark }));
  }, []);

  // seed auto-marks for attested-key MCQs whose choice was captured on paper
  useEffect(() => {
    const seed: Record<string, PartMark> = {};
    for (const q of manifest.questions) {
      for (const p of q.parts) {
        if (p.kind !== "mcq") continue;
        const key = partKeyOf(q.number, p.part);
        const chosen = record.answers[key]?.value;
        const mcq = p.mcq!;
        if (mcq.keyAttested && mcq.key && chosen) {
          seed[key] = {
            partKey: key,
            marks: chosen === mcq.key ? p.marks : 0,
            max: p.marks,
            how: "auto",
            chosen,
          };
        }
      }
    }
    if (Object.keys(seed).length > 0) {
      setMarks((prev) => ({ ...seed, ...prev }));
    }
  }, [manifest, record]);

  const chooseMcq = useCallback(
    (qn: string, p: PaperRunManifest["questions"][number]["parts"][number], option: string) => {
      const key = partKeyOf(qn, p.part);
      const mcq = p.mcq!;
      if (mcq.keyAttested && mcq.key) {
        // the key is already attested — this is the learner telling the
        // console what they chose on paper, not a key decision
        putMark(key, {
          partKey: key,
          marks: option === mcq.key ? p.marks : 0,
          max: p.marks,
          how: "auto",
          chosen: option,
        });
      } else {
        // unattested key: the grader supplies the correct option once,
        // looking at the MS — recorded as a CANDIDATE (R-6 gate), never
        // auto-applied to the manifest
        putMark(key, {
          partKey: key,
          marks: option === record.answers[key]?.value ? p.marks : 0,
          max: p.marks,
          how: "self",
          chosen: record.answers[key]?.value,
          keyCandidate: option,
        });
      }
    },
    [putMark, record],
  );

  const aiSuggest = useCallback(
    async (qn: string, p: PaperRunManifest["questions"][number]["parts"][number]) => {
      const key = partKeyOf(qn, p.part);
      const answer = record.answers[key]?.value?.trim();
      if (!answer) return;
      setAiBusyFor(key);
      setAiNote(null);
      try {
        const res = await fetch("/api/ai/mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            problemMd: `Question ${qn}${p.part}) (${p.marks} marks)`,
            solutionMd: `Mark scheme for ${manifest.paper.ref} Q${qn}${p.part}`,
            marks: p.marks,
            answer,
          }),
        });
        if (!res.ok) {
          setAiNote("AI marking is not available right now — self-mark against the MS.");
          return;
        }
        const j = (await res.json()) as { marksAwarded?: number; comment?: string };
        if (typeof j.marksAwarded !== "number") {
          setAiNote("AI marking returned no usable suggestion — self-mark against the MS.");
          return;
        }
        const clamped = Math.max(0, Math.min(p.marks, j.marksAwarded));
        putMark(key, {
          partKey: key,
          marks: clamped,
          max: p.marks,
          how: "ai-suggested",
        });
        if (j.comment) setAiNote(j.comment);
      } catch {
        setAiNote("AI marking failed — self-mark against the MS.");
      } finally {
        setAiBusyFor(null);
      }
    },
    [manifest, record, putMark],
  );

  // ── finish: totals + result + core submissions ───────────────────────────
  const totals = useMemo(() => {
    let m = 0;
    let max = 0;
    const marked = { auto: 0, self: 0, aiSuggested: 0, paperOnly: 0 };
    const perQuestion: PaperRunResult["perQuestion"] = [];
    const keyCandidates: NonNullable<PaperRunResult["keyCandidates"]> = [];
    for (const q of manifest.questions) {
      let qm = 0;
      let qmax = 0;
      const hows: MarkHow[] = [];
      for (const p of q.parts) {
        const mk = marks[partKeyOf(q.number, p.part)];
        qmax += p.marks;
        if (!mk) continue;
        qm += mk.marks;
        hows.push(mk.how);
        if (mk.how === "auto") marked.auto += 1;
        else if (mk.how === "ai-suggested") marked.aiSuggested += 1;
        else if (mk.how === "paper-only") marked.paperOnly += 1;
        else marked.self += 1;
        if (mk.keyCandidate)
          keyCandidates.push({ number: q.number, part: p.part, option: mk.keyCandidate });
      }
      const how: MarkHow =
        hows.length > 0 && hows.every((h) => h === "auto")
          ? "auto"
          : hows.includes("ai-suggested")
            ? "ai-suggested"
            : "self";
      m += qm;
      max += qmax;
      perQuestion.push({ number: q.number, marks: qm, max: qmax, how });
    }
    return { m, max, marked, perQuestion, keyCandidates };
  }, [manifest, marks]);

  const allMarked = manifest.questions.every((q) =>
    q.parts.every((p) => !!marks[partKeyOf(q.number, p.part)]),
  );

  const submitToCore = useCallback(async (): Promise<
    PaperRunResult["coreSubmissions"] | undefined
  > => {
    if (!recon || bridge.kind !== "ready") return undefined;
    const data = bridge.data;
    let attempted = 0;
    let recorded = 0;
    let failed = 0;
    const estPerPart = Math.max(
      1000,
      Math.round((record.timeUsedSec * 1000) / Math.max(1, manifest.questions.length)),
    );
    for (const mq of manifest.questions) {
      const idx = recon.questionNumbers.indexOf(Number(mq.number));
      if (idx < 0) continue;
      const rq = recon.questions[idx];
      if (!rq) continue;
      const joinQ = data.questions[rq.id];
      if (!joinQ) continue;
      for (let k = 0; k < mq.parts.length; k++) {
        const mp = mq.parts[k];
        const rp = rq.parts[k];
        if (!mp || !rp) continue;
        const kindOk =
          mp.kind === "mcq" ? rp.questionType === "multiple_choice" : rp.questionType !== "multiple_choice";
        if (!kindOk) continue; // never fabricate a join the kinds refuse
        const mk = marks[partKeyOf(mq.number, mp.part)];
        if (!mk) continue;
        const answer = record.answers[partKeyOf(mq.number, mp.part)];
        if (mp.kind === "mcq") {
          const joinPart = joinQ.mcq[rp.id];
          const optionId = mk.chosen ? joinPart?.options[mk.chosen] : undefined;
          if (!joinPart || !optionId) continue;
          attempted += 1;
          try {
            await api.submitAttempt({
              questionId: joinPart.questionId,
              chosenOptionId: optionId,
              responseTimeMs: estPerPart,
              confidence: null,
              selfDoubtFlag: false,
              timedCondition: true,
            });
            recorded += 1;
          } catch {
            failed += 1;
          }
        } else {
          const sub = joinQ.structured.find((s) => s.parts[rp.id]);
          const corePartId = sub?.parts[rp.id];
          if (!sub || !corePartId) continue;
          const text =
            answer?.paperOnly && !answer.value
              ? "(answered on paper — self-marked against the mark scheme)"
              : answer?.value?.trim() || "(left blank on the paper)";
          attempted += 1;
          try {
            const res = await api.submitStructuredAttempt({
              questionId: sub.questionId,
              partAnswers: [{ partId: corePartId, answerText: text }],
              responseTimeMs: estPerPart,
              confidence: null,
              selfDoubtFlag: false,
              timedCondition: true,
            });
            try {
              await api.selfMarkAttempt(res.attemptId, [
                { partId: corePartId, marksAwarded: mk.marks },
              ]);
            } catch {
              /* the attempt stands; the self-mark is best-effort */
            }
            recorded += 1;
          } catch {
            failed += 1;
          }
        }
      }
    }
    return { attempted, recorded, failed };
  }, [bridge, manifest, marks, record, recon]);

  const finish = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setCoreMsg(null);
    // core submissions ride the existing bridge contract — grading-time only
    const core = await submitToCore();
    void core;
    if (core && core.attempted > 0) coreEvidenceChanged();
    const r: PaperRunResult = {
      id: record.runId,
      mode: "run",
      course,
      ref: manifest.paper.ref,
      title: paperTitle,
      sessionId: manifest.paper.session,
      manifestVersion: manifest.version,
      integrity: "practice",
      durationPolicy: record.durationPolicy,
      startedAt: record.startedAt,
      finishedAt: new Date().toISOString(),
      durationMin: record.durationMin,
      timeUsedSec: record.timeUsedSec,
      ended: record.timeUpAutoSubmitted ? "time-up" : "self",
      timeUpAutoSubmitted: record.timeUpAutoSubmitted,
      marks: totals.m,
      total: manifest.paper.totalMarks,
      coverageState,
      marked: totals.marked,
      perQuestion: totals.perQuestion,
      keyCandidates: totals.keyCandidates.length > 0 ? totals.keyCandidates : undefined,
      coreSubmissions: core,
    };
    saveMockResult(r);
    onDone(r);
    setSubmitting(false);
  }, [course, coverageState, manifest, paperTitle, record, submitToCore, totals, onDone]);

  // ── done ─────────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-10">
        <BuiltinHeader paperTitle={paperTitle} backHref={backHref} manifest={manifest} />
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-3xl font-bold tabular-nums">
                  {result.marks}
                  <span className="text-lg font-medium text-muted-foreground"> / {result.total}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {paperTitle} · Paper Run ·{" "}
                  {result.ended === "time-up" ? "auto-submitted at time-up" : "self-submitted"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="text-[10px]">
                  practice integrity
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {result.durationPolicy === "OFFICIAL" ? "official duration" : "accommodated duration"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  coverage: {result.coverageState}
                </Badge>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              <span className="rounded-md border px-2 py-1">
                {result.marked.auto} auto-marked
              </span>
              <span className="rounded-md border px-2 py-1">{result.marked.self} self-marked</span>
              {result.marked.aiSuggested > 0 && (
                <span className="rounded-md border px-2 py-1">
                  {result.marked.aiSuggested} ai-suggested
                </span>
              )}
              <span className="rounded-md border px-2 py-1">
                {result.marked.paperOnly} on paper
              </span>
            </div>
            {result.coreSubmissions && (
              <p className="rounded-lg border border-success/30 bg-success/5 p-2.5 text-xs text-muted-foreground">
                Core: {result.coreSubmissions.recorded}/{result.coreSubmissions.attempted} verified
                joins recorded as real attempts
                {result.coreSubmissions.failed > 0
                  ? ` · ${result.coreSubmissions.failed} failed (reportable, never fabricated)`
                  : ""}
                . The local result stays labeled SIMULATED-free only where the course is core-backed —
                this one is.
              </p>
            )}
            {!result.coreSubmissions && (
              <p className="rounded-lg border bg-muted/30 p-2.5 text-xs text-muted-foreground">
                Local SIMULATED result — this course is not core-backed yet, so the run feeds your
                local progress only (honest ladder, design §1).
              </p>
            )}
            {result.keyCandidates && result.keyCandidates.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {result.keyCandidates.length} MCQ key candidate
                {result.keyCandidates.length === 1 ? "" : "s"} recorded for curation review —
                future runs of this paper do not auto-mark from them until confirmed.
              </p>
            )}
            <div className="space-y-1.5">
              {result.perQuestion.map((pq) => (
                <div
                  key={pq.number}
                  className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                >
                  <span className="font-medium">Question {pq.number}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    <span className="text-xs text-muted-foreground">{pq.how}</span>
                    <span className="font-semibold">
                      {pq.marks}/{pq.max}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <Button asChild className="w-full">
              <a href={backHref}>Back to Past Papers</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── grading UI ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 pb-10">
      <BuiltinHeader paperTitle={paperTitle} backHref={backHref} manifest={manifest} />
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">Grading — {manifest.paper.ref}</h1>
          <Badge variant="outline" className="text-[10px]">
            practice integrity
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setMsOpen((v) => !v)}>
              {msOpen ? "Hide mark scheme" : "Show mark scheme"}
            </Button>
            <Button asChild size="sm" variant="ghost">
              <a href={msUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" aria-hidden /> open MS
              </a>
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Attested-key MCQs are auto-marked from your captured choices. Structured parts: compare
          with the mark scheme and enter the marks — every mark records how it was made.
        </p>

        {manifest.questions.map((q) => (
          <Card key={q.number}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Question {q.number}</span>
                <span className="text-xs text-muted-foreground">
                  {q.parts.reduce((a, p) => a + p.marks, 0)} marks
                </span>
                {record.flags[q.number] && (
                  <Badge variant="outline" className="text-[10px] text-warn">
                    was flagged
                  </Badge>
                )}
              </div>
              <div className={msOpen ? "grid gap-4 lg:grid-cols-2" : ""}>
                <div className="space-y-3">
                  {q.parts.map((p) => {
                    const key = partKeyOf(q.number, p.part);
                    const mk = marks[key];
                    const answer = record.answers[key];
                    return (
                      <div key={key} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium">
                            ({p.part}) · {p.marks} mark{p.marks === 1 ? "" : "s"}
                          </span>
                          {p.kind === "mcq" ? (
                            p.mcq?.keyAttested ? (
                              <Badge variant="outline" className="text-[10px]">
                                auto · key: {p.mcq.keyProvenance}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                key not attested — supply once
                              </Badge>
                            )
                          ) : p.answerKind === "text" ? (
                            <Badge variant="outline" className="text-[10px]">
                              typed answer
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              answered on paper
                            </Badge>
                          )}
                          {mk && (
                            <span className="ml-auto text-sm font-bold tabular-nums">
                              {mk.marks}/{mk.max}
                            </span>
                          )}
                        </div>

                        {p.kind === "mcq" ? (
                          <div className="mt-2 space-y-1.5">
                            {!mk && (
                              <p className="text-xs text-muted-foreground">
                                {p.mcq?.keyAttested
                                  ? "Which option did you choose on the paper?"
                                  : "Click the correct option once, looking at the mark scheme — it becomes a reviewable key candidate."}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              {(p.mcq?.options ?? []).map((opt) => (
                                <button
                                  key={opt}
                                  disabled={!!mk && mk.how === "auto" && !!mk.chosen}
                                  onClick={() => chooseMcq(q.number, p, opt)}
                                  className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold ${
                                    mk?.chosen === opt
                                      ? "border-primary bg-primary/10"
                                      : "bg-background"
                                  } ${mk?.how === "auto" && mk?.chosen && mk.chosen !== opt ? "opacity-40" : ""}`}
                                >
                                  {opt}
                                  {p.mcq?.keyAttested && mk?.chosen === opt && mk.marks > 0 && (
                                    <Check className="size-3 text-success" aria-hidden />
                                  )}
                                </button>
                              ))}
                            </div>
                            {p.mcq?.keyAttested && mk?.chosen && (
                              <p className="text-[11px] text-muted-foreground">
                                your choice {mk.chosen} · correct {p.mcq.key} — auto-marked
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {p.answerKind === "text" && (
                              <p className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs leading-snug">
                                {answer?.value?.trim() || "(left blank on the paper)"}
                              </p>
                            )}
                            {p.note && (
                              <p className="text-[11px] text-muted-foreground">{p.note}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-muted-foreground">your mark:</span>
                              <div className="flex items-center gap-1">
                                {Array.from({ length: p.marks + 1 }, (_, v) => (
                                  <button
                                    key={v}
                                    onClick={() =>
                                      putMark(key, {
                                        partKey: key,
                                        marks: v,
                                        max: p.marks,
                                        how: mk?.how === "ai-suggested" ? "ai-suggested" : "self",
                                      })
                                    }
                                    className={`size-7 rounded-md border text-xs font-semibold ${
                                      (mk?.marks ?? -1) === v
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "bg-background"
                                    }`}
                                    aria-label={`${v} of ${p.marks}`}
                                  >
                                    {v}
                                  </button>
                                ))}
                              </div>
                              {aiOk && p.answerKind === "text" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 text-[11px]"
                                  disabled={aiBusyFor === key || !answer?.value?.trim()}
                                  onClick={() => aiSuggest(q.number, p)}
                                >
                                  <Sparkles className="size-3" aria-hidden />
                                  check with AI
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {msOpen && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={msPage <= 1}
                        onClick={() => setMsPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="size-3.5" aria-hidden /> MS
                      </Button>
                      <span className="text-xs text-muted-foreground">MS page {msPage}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => setMsPage((p) => p + 1)}
                      >
                        <ChevronRight className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                    <div className="max-h-[520px] overflow-y-auto rounded-lg border">
                      <PdfCanvas url={msUrl} pageNo={msPage} />
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {aiNote && (
          <p className="flex items-start gap-1.5 rounded-lg border bg-muted/30 p-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {aiNote}
          </p>
        )}

        <Card className="sticky bottom-4 border-primary/40 bg-background">
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="text-sm">
              <span className="font-bold tabular-nums">{totals.m}</span>
              <span className="text-muted-foreground"> / {manifest.paper.totalMarks}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {allMarked
                  ? "every part marked"
                  : `${manifest.questions.length * 0 + Object.keys(marks).length}/${countParts(manifest)} parts marked`}
              </span>
            </div>
            <Button
              className="ml-auto"
              disabled={!allMarked || submitting}
              onClick={() => void finish()}
            >
              {submitting ? "Recording…" : "Finish & save result"}
            </Button>
          </CardContent>
        </Card>
        {bridge.kind === "off" && (
          <p className="pb-4 text-center text-[11px] text-muted-foreground">
            This course is not core-backed — the result stays a local SIMULATED record.
          </p>
        )}
      </div>
    </div>
  );
}

function countParts(manifest: PaperRunManifest): number {
  return manifest.questions.reduce((a, q) => a + q.parts.length, 0);
}
