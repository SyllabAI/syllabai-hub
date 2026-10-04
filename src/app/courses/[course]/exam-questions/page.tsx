import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, FileQuestion, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getCourseBundle, loadHubCourse } from "@/lib/courses";
import { getDataProvider } from "@/lib/data";
import { CourseHeader } from "@/components/hub/course-header";
import { NumberedLabel } from "@/components/hub/chrome";
import { AddToTestLink } from "@/components/teacher/add-to-test-link";

export const dynamic = "force-dynamic";

/** "1C" → "Paper 1C"; full paper codes (4MA1/1F) pass through verbatim. */
function paperLabel(p: string): string {
  return p.length <= 4 ? `Paper ${p}` : p;
}

/**
 * Exam Questions bank index (SME pattern, research §6.1): question sets
 * grouped under their numbered topic, with count pills and a per-set link —
 * an exam-question analogue of the notes index, driven by the same tree.
 *
 * T-KG-17: `?paper=` scopes the bank to sets whose anchored spec points are
 * assessed in that paper (the canonical T-KG-16 applicability, joined via
 * the parts' specPointCodes) — revision scoped the way the exam is sat.
 */
export default async function ExamQuestionsIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ course: string }>;
  searchParams: Promise<{ spec?: string; paper?: string; q?: string }>;
}) {
  const { course: slug } = await params;
  const { spec, paper, q } = await searchParams;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();
  const { meta, stats } = hub;

  // UX audit 2026-10-02 #20: search results (lib/ai/retrieval.ts) emit
  // /exam-questions?q=<partId> deep links — the index ignored ?q= entirely,
  // landing every search hit on the unfiltered bank. Resolve the part to its
  // question set and redirect there; an unresolvable q renders the index.
  if (q) {
    const topicWithPart = hub.questionTopics.find((t) =>
      t.questions.some((x) => x.parts.some((p) => p.id === q)),
    );
    if (topicWithPart) {
      redirect(`/courses/${meta.slug}/exam-questions/${topicWithPart.slug}`);
    }
  }

  // spec-point → papers (+ coursework pseudo-tag) for the part-level join
  const bundle = await getCourseBundle(slug);
  const curriculum =
    bundle?.curriculum ?? (hub.viaProvider ? await getDataProvider().curriculum() : null);
  const appByCode = new Map(
    (curriculum?.nodes ?? [])
      .filter((n) => n.family === "SPEC_POINT" && n.applicability)
      .map((n) => [n.code, n.applicability!]),
  );
  const COURSEWORK = "__coursework__";
  const papersOfSet = (setSlug: string): Set<string> => {
    const out = new Set<string>();
    const set = hub.questionTopics.find((t) => t.slug === setSlug);
    for (const q of set?.questions ?? [])
      for (const p of q.parts) {
        for (const c of p.specPointCodes ?? []) {
          const a = appByCode.get(c);
          if (!a) continue;
          for (const x of a.papers ?? []) out.add(x);
          if ((a.papers ?? []).length === 0 && a.coursework) out.add(COURSEWORK);
        }
      }
    return out;
  };
  const setPapers = new Map(hub.questionTopics.map((t) => [t.slug, papersOfSet(t.slug)]));

  const paperOptions = [...new Set([...setPapers.values()].flatMap((s) => [...s]))].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  );
  const paperLabelOf = (p: string) => (p === COURSEWORK ? "Coursework" : paperLabel(p));
  const paperActive = paper ?? null;

  // legacy deep links used ?spec=4CH1-1.1 — jump straight to the set that
  // anchors that spec point when it has one canonical home
  const specSubtopic = spec ? hub.index.subtopicOfSpecPoint.get(spec) ?? null : null;
  const specSets = specSubtopic ? hub.setsBySubtopic[specSubtopic] ?? [] : [];
  if (spec && specSets.length > 0) {
    redirect(`/courses/${meta.slug}/exam-questions/${specSets[0]}`);
  }
  const base = `/courses/${meta.slug}`;

  const inScope = (setSlug: string) =>
    !paperActive || (setPapers.get(setSlug)?.has(paperActive) ?? false);

  const groups = hub.index.tree.topics
    .map((t) => ({
      topic: t,
      sets: hub.questionTopics.filter((set) => {
        // canonical home of the set is the sub-topic with the most anchored parts
        return hub.setsBySubtopic[
          t.subtopics.find((s) => hub.setsBySubtopic[s.code]?.includes(set.slug))?.code ?? ""
        ]?.includes(set.slug);
      }).filter((set) => inScope(set.slug)),
    }))
    .filter((g) => g.sets.length > 0);

  const unplaced = hub.questionTopics.filter(
    (set) => !groups.some((g) => g.sets.some((s) => s.slug === set.slug)),
  ).filter((set) => inScope(set.slug));

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <CourseHeader
        meta={meta}
        title={`Edexcel ${meta.level} ${meta.label} Exam Questions By Topic`}
        crumb="Exam Questions"
        description={`Exam-style questions organised by topic — ${stats.questions} questions across ${stats.questionSets} sets, with parts, command words, mark schemes and self-marking.`}
      />

      {paperOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card px-3 py-2.5">
          <span className="mr-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Filter className="size-3.5" aria-hidden />
            Assessed in
          </span>
          <Link
            href={`${base}/exam-questions`}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              paperActive === null
                ? "border-primary/40 bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            All papers
          </Link>
          {paperOptions.map((p) => (
            <Link
              key={p}
              href={`${base}/exam-questions?paper=${encodeURIComponent(p)}`}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                paperActive === p
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {paperLabelOf(p)}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-5">
        {groups.map(({ topic, sets }) => (
          <section key={topic.code} aria-label={`Topic ${topic.number}: ${topic.title}`}>
            <div className="mb-2 flex items-center gap-2">
              <span className="size-4 shrink-0 rounded-full border-2 border-muted-foreground/25" aria-hidden />
              <h2 className="text-[15px] font-semibold">
                <NumberedLabel number={topic.number} title={topic.title} />
              </h2>
              <span className="text-xs text-muted-foreground">
                ·{" "}
                {topic.subtopics.reduce((a, s) => a + (hub.counts[s.code]?.questions ?? 0), 0)}{" "}
                questions
              </span>
              <AddToTestLink
                courseSlug={meta.slug}
                codes={topic.subtopics.map((s) => s.code)}
              />
            </div>
            <div className="ml-4 grid gap-2 border-l pl-3 sm:grid-cols-2">
              {sets.map((set) => {
                const marks = set.questions.reduce((b, q) => b + q.totalMarks, 0);
                const diffs = {
                  easy: set.questions.filter((q) => q.difficulty === "easy").length,
                  medium: set.questions.filter((q) => q.difficulty === "medium").length,
                  hard: set.questions.filter((q) => q.difficulty === "hard").length,
                };
                return (
                  <Link
                    key={set.slug}
                    href={`${base}/exam-questions/${set.slug}`}
                    className="group flex items-start gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40"
                  >
                    <FileQuestion className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-snug group-hover:text-primary">
                        {set.name}
                        {set.setName ? ` — ${set.setName}` : ""}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">
                          {set.questions.length} questions
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {marks} marks
                        </Badge>
                        {(["easy", "medium", "hard"] as const)
                          .filter((d) => diffs[d] > 0)
                          .map((d) => (
                            <Badge key={d} variant="secondary" className="text-[10px] capitalize">
                              {diffs[d]} {d}
                            </Badge>
                          ))}
                      </span>
                    </span>
                    <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}

        {unplaced.length > 0 && (
          <section aria-label="Unplaced sets">
            <h2 className="mb-2 text-[15px] font-semibold">Other sets</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {unplaced.map((set) => (
                <Link
                  key={set.slug}
                  href={`${base}/exam-questions/${set.slug}`}
                  className="group flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40"
                >
                  <FileQuestion className="size-4 text-primary" aria-hidden />
                  <span className="text-sm font-semibold group-hover:text-primary">{set.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{set.questions.length} questions</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {groups.length === 0 && unplaced.length === 0 && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              {paperActive ? (
                <>
                  No imported question sets are anchored to spec points assessed in{" "}
                  <span className="font-medium text-foreground">{paperLabelOf(paperActive)}</span>{" "}
                  yet — the corpus currently covers other papers for this course.{" "}
                  <Link href={`${base}/exam-questions`} className="underline hover:text-foreground">
                    Clear the paper scope
                  </Link>
                  .
                </>
              ) : (
                "No question sets imported for this course yet."
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
