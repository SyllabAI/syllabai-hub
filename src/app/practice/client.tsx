"use client";

/**
 * Practice — part-level practice player over the real question corpus.
 *
 * Telemetry mirrors the production attempt shape (confidence 1..5,
 * selfDoubtFlag, timed) so a later CoreApiProvider can POST the same intent
 * to /api/v1/attempts/structured. In mock mode, marks feed the SIMULATED
 * learner overlay (session state only) — never canonical learner state.
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { AnswerTextarea, answerPlaceholder } from "@/components/answer-textarea";
import { Atom, CheckCircle2, ChevronRight } from "lucide-react";
import type { ExamQuestionTopic } from "@/lib/contracts";
import { Markdown } from "@/components/markdown";
import { PartProblem } from "@/components/part-problem";
import { SpecChip, SimulatedBanner } from "@/components/provenance";

interface Props {
  topics: ExamQuestionTopic[];
}

export function PracticeClient({ topics }: Props) {
  const flatParts = useMemo(
    () =>
      topics.flatMap((t) =>
        t.questions.flatMap((q) =>
          q.parts
            .filter((p) => p.questionType !== "mcq")
            .map((p) => ({
              topic: t.name,
              topicSlug: t.slug,
              questionId: q.id,
              difficulty: q.difficulty,
              part: p,
            })),
        ),
      ),
    [topics],
  );

  const [pos, setPos] = useState(0);
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState(3);
  const [selfDoubt, setSelfDoubt] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [selfMarks, setSelfMarks] = useState<number | null>(null);
  const [sessionLog, setSessionLog] = useState<
    { partId: string; marks: number; possible: number; confidence: number }[]
  >([]);

  const item = flatParts[pos];
  const totalMarks = sessionLog.reduce((a, l) => a + l.marks, 0);
  const possibleMarks = sessionLog.reduce((a, l) => a + l.possible, 0);

  const next = () => {
    setSessionLog((prev) => [
      ...prev,
      {
        partId: item.part.id,
        marks: selfMarks ?? 0,
        possible: item.part.marks,
        confidence,
      },
    ]);
    setPos((p) => (p + 1) % flatParts.length);
    setAnswer("");
    setConfidence(3);
    setSelfDoubt(false);
    setRevealed(false);
    setSelfMarks(null);
  };

  if (!item) {
    return <p className="text-sm text-muted-foreground">No practice parts available.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Atom className="size-5 text-primary" aria-hidden />
          Practice
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Real exam-question parts with production-shaped attempt telemetry (confidence,
          self-doubt). Marks self-assess against the mark scheme — the SIMULATED overlay updates
          from that, exactly as the governed pipeline would from server-marked evidence.
        </p>
      </div>

      <SimulatedBanner>
        Attempt results update a <strong>SIMULATED</strong> mastery overlay in this browser session.
        No canonical learner state is touched; with <span className="font-mono">core-api</span> mode
        the same payload shape targets <span className="font-mono">/api/v1/attempts/structured</span>.
      </SimulatedBanner>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{item.topic}</Badge>
              {item.difficulty && (
                <Badge variant="secondary" className="text-[10px]">
                  {item.difficulty}
                </Badge>
              )}
              {item.part.commandWord && (
                <Badge variant="outline" className="text-[10px] capitalize">
                  {item.part.commandWord}
                </Badge>
              )}
              {item.part.specPointCodes.map((c) => (
                <SpecChip key={c} code={c} />
              ))}
              {/* SME (figures 15/16): part marks right-aligned */}
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {item.part.marks} mark{item.part.marks === 1 ? "" : "s"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <PartProblem md={item.part.problemMd} />

            <div className="space-y-2">
              <Label htmlFor="answer" className="text-sm">
                Your answer
              </Label>
              <AnswerTextarea
                id="answer"
                value={answer}
                onChange={setAnswer}
                ariaLabel="Your practice answer"
                placeholder={answerPlaceholder(item.part.problemMd)}
                marks={item.part.marks}
                // mirrors the footer buttons exactly: reveal needs text
                // (no scheme peek without an attempt), Next needs a
                // self-mark (no 0-mark row slipping into the session log)
                onSubmitShortcut={() => {
                  if (!revealed) {
                    if (answer.trim()) setRevealed(true);
                  } else if (selfMarks !== null) {
                    next();
                  }
                }}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm">
                  Confidence: <span className="font-medium">{confidence}/5</span>
                </Label>
                <Slider
                  value={[confidence]}
                  onValueChange={([v]) => setConfidence(v)}
                  min={1}
                  max={5}
                  step={1}
                  aria-label="Confidence level"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Switch id="doubt" checked={selfDoubt} onCheckedChange={setSelfDoubt} />
                <Label htmlFor="doubt" className="text-sm">
                  Flag self-doubt
                </Label>
              </div>
            </div>

            {revealed && (
              <div className="rounded-md border-t pt-3">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Mark scheme / solution
                </p>
                <Markdown>{item.part.solutionMd ?? "No scheme bundled for this part."}</Markdown>
                <div className="mt-3 flex items-center gap-2">
                  <Label className="text-xs">Self-mark:</Label>
                  {Array.from({ length: item.part.marks + 1 }, (_, m) => (
                    <Button
                      key={m}
                      size="sm"
                      variant={selfMarks === m ? "default" : "outline"}
                      className="h-7 px-2.5"
                      onClick={() => setSelfMarks(m)}
                    >
                      {m}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              {!revealed ? (
                <Button onClick={() => setRevealed(true)} disabled={!answer.trim()}>
                  <CheckCircle2 className="size-4" aria-hidden /> Submit & reveal scheme
                </Button>
              ) : (
                <Button onClick={next} disabled={selfMarks === null}>
                  Next part <ChevronRight className="size-4" aria-hidden />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Session overlay (SIMULATED)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-2xl font-bold tabular-nums">
              {totalMarks}
              <span className="text-base font-normal text-muted-foreground">
                {" "}
                / {possibleMarks} marks
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {sessionLog.length} part{sessionLog.length === 1 ? "" : "s"} attempted · avg
              confidence{" "}
              {sessionLog.length
                ? (sessionLog.reduce((a, l) => a + l.confidence, 0) / sessionLog.length).toFixed(1)
                : "—"}
            </p>
            <div className="max-h-48 space-y-1 overflow-y-auto pt-1">
              {sessionLog
                .slice()
                .reverse()
                .map((l, i) => (
                  <div
                    key={`${l.partId}-${i}`}
                    className="flex items-center justify-between rounded border px-2 py-1 text-xs"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {l.partId.slice(0, 14)}…
                    </span>
                    <span className={l.marks / Math.max(l.possible, 1) >= 0.5 ? "text-success" : "text-destructive"}>
                      {l.marks}/{l.possible}
                    </span>
                  </div>
                ))}
              {sessionLog.length === 0 && (
                <p className="text-xs text-muted-foreground">Nothing attempted yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
