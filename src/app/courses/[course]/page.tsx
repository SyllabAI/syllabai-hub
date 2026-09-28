import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  CircleHelp,
  FileQuestion,
  Files,
  GraduationCap,
  Lightbulb,
  ListTree,
  ScrollText,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listCourses, loadHubCourse, pilotCourseSlug } from "@/lib/courses";
import { publicConfig } from "@/lib/config";
import { collectPastPapers } from "@/lib/past-papers";
import { buildPracticePapers } from "@/lib/practice-papers";
import { CourseHeader } from "@/components/hub/course-header";
import { CourseSwitcher } from "@/components/hub/course-switcher";
import { TagChip } from "@/components/hub/chrome";
import { allCourseParams } from "@/lib/static-params";

type FrameworkTag = "Study" | "Practice" | "Diagnose";

interface ResourceItem {
  icon: typeof BookOpen;
  title: string;
  desc: string;
  tags: FrameworkTag[];
  href?: string;
  countLabel?: string;
  ready: boolean;
}

/**
 * The per-subject Learning Hub (SME "Course Resources"; Task 21-b matched
 * against the real savemyexams.com course reference page):
 *   hero (subject H1 + "Edexcel | IGCSE | 4CH1" line) · course switcher ·
 *   two labelled resource bands — Exam Practice and Revision — each card
 *   carrying SME's Study / Practice / Diagnose framework chips, then the
 *   revision-framework explainer. Corpus discipline kept: a card only
 *   links when the committed bundle actually has the content; roadmap
 *   surfaces stay explicitly marked.
 */

/** Prerendered at build (ADR-021 perf pass, tranche 4.12) — see static-params.ts. */
export async function generateStaticParams() {
  return allCourseParams();
}
export default async function CourseHubPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();
  const pilotSlug = await pilotCourseSlug();
  const allCourses = await listCourses();
  const cfg = publicConfig();
  const { meta, stats } = hub;
  const base = `/courses/${meta.slug}`;
  const qual = `Edexcel ${meta.level} ${meta.subject}`;
  // Task 22: real past-paper archive (sourcePaper provenance) + deterministic
  // practice papers assembled from the same banks
  const pastPapers = collectPastPapers(hub.questionTopics);
  const heldQuestions = pastPapers.reduce((a, p) => a + p.questions.length, 0);
  const practicePapers =
    stats.questionSets > 0 ? buildPracticePapers(meta.slug, hub.questionTopics) : [];
  // the 4CH1 pilot runs on the official Pearson tree; every other course runs
  // on the corpus's own (SME) tree until the official mapping lands upstream
  const officialTree = hub.treeKind !== "sme-native";

  const bands: { id: string; title: string; tagline: string; items: ResourceItem[] }[] = [
    {
      id: "exam-practice",
      title: "Exam Practice",
      tagline: "Test yourself with questions, tests and exam papers and identify areas for improvement.",
      items: [
        {
          icon: FileQuestion,
          title: "Exam Questions",
          desc: "Past paper, exam-style and quiz questions with mark schemes and self-marking, organised by topic.",
          tags: ["Practice", "Diagnose"],
          href: `${base}/exam-questions`,
          countLabel: `${stats.questions} question${stats.questions === 1 ? "" : "s"} · ${stats.questionSets} set${stats.questionSets === 1 ? "" : "s"}`,
          ready: stats.questions > 0,
        },
        {
          icon: Target,
          title: "Target Test",
          desc: "Custom exam practice to target your weak spots — Phase C of the build plan.",
          tags: ["Practice", "Diagnose"],
          ready: false,
        },
        {
          icon: ScrollText,
          title: "Past Papers",
          desc: "The questions we hold from real Edexcel past papers, grouped by session and played back in paper order — partial reconstructions, not the full official papers.",
          tags: ["Practice", "Diagnose"],
          ready: pastPapers.length > 0,
          href: pastPapers.length > 0 ? `${base}/past-papers` : undefined,
          countLabel:
            pastPapers.length > 0
              ? `${pastPapers.length} paper${pastPapers.length === 1 ? "" : "s"} · ${heldQuestions} question${heldQuestions === 1 ? "" : "s"} held`
              : undefined,
        },
        {
          icon: Files,
          title: "Practice Papers",
          desc: "Full-length mixed papers assembled from this course's question bank — our stand-in for official papers that can't be redistributed. Same questions, same mark schemes.",
          tags: ["Practice", "Diagnose"],
          ready: practicePapers.length > 0,
          href: practicePapers.length > 0 ? `${base}/practice-papers` : undefined,
          countLabel:
            practicePapers.length > 0
              ? `${practicePapers.length} papers · ${stats.questions} questions`
              : undefined,
        },
        {
          icon: Files,
          title: "Mock Exams",
          desc: "Expert-created full practice papers — not part of the pilot corpus yet.",
          tags: ["Practice", "Diagnose"],
          ready: false,
        },
      ],
    },
    {
      id: "revision",
      title: "Revision",
      tagline: "Comprehensive content covering your entire exam specification.",
      items: [
        {
          icon: BookOpen,
          title: "Revision Notes",
          desc: officialTree
            ? "Concise, high-quality notes to build your understanding of every topic in the official specification."
            : "Concise, high-quality notes anchored to corpus spec points (official-spec mapping pending upstream).",
          tags: ["Study"],
          href: `${base}/revision-notes`,
          countLabel: `${stats.notes} note${stats.notes === 1 ? "" : "s"}`,
          ready: stats.notes > 0,
        },
        {
          icon: CircleHelp,
          title: "Flashcards",
          desc: "Interactive digital flashcards that reinforce facts and definitions, imported per sub-topic.",
          tags: ["Study", "Practice"],
          href: `${base}/flashcards`,
          countLabel: `${stats.flashcards} card${stats.flashcards === 1 ? "" : "s"}`,
          ready: stats.flashcards > 0,
        },
        {
          icon: Lightbulb,
          title: "Smart Lesson",
          desc: "Adaptive study path that adjusts based on your performance — Phase C of the build plan.",
          tags: ["Study", "Practice", "Diagnose"],
          ready: false,
        },
      ],
    },
  ];

  const framework = [
    {
      tag: "Study" as FrameworkTag,
      desc: "Start with comprehensive revision material covering all specification content.",
    },
    {
      tag: "Practice" as FrameworkTag,
      desc: "Practise with exam-style questions and flashcards to build your confidence.",
    },
    {
      tag: "Diagnose" as FrameworkTag,
      desc: "Self-marking and strengths views expose your weak spots and guide you to improve.",
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <CourseHeader
        meta={meta}
        activeTab="resources"
        showTabs
        title={meta.subject}
        description={`Tools designed specifically for the ${qual} syllabus (${meta.code}): revision notes, exam-style questions and flashcards organised around the ${officialTree ? "official specification tree" : "corpus specification tree"} — with provenance kept visible on every item.`}
      >
        {/* SME hero anatomy: "Edexcel | IGCSE | 4CH1" + course switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Edexcel</span>
            <span className="mx-2 text-muted-foreground/50">|</span>
            {meta.level}
            <span className="mx-2 text-muted-foreground/50">|</span>
            <span className="font-mono">{meta.code}</span>
          </p>
          <CourseSwitcher current={meta.slug} courses={allCourses.map((c) => ({ slug: c.slug, label: c.label, subject: c.subject, level: c.level }))} />
        </div>
      </CourseHeader>

      {!hub.viaProvider && stats.notes + stats.questions === 0 ? (
        <Card className="mt-8">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="size-4 text-primary" aria-hidden />
              Content status: import pending
            </CardTitle>
            <CardDescription>
              This course is registered in the demo corpus (downloaded in{" "}
              <span className="font-mono text-xs">syllabai-resources</span>) but has no committed
              content bundle in this repository yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="leading-relaxed text-muted-foreground">
              The Learning Hub IA is live: when an import lands under{" "}
              <span className="font-mono text-xs">content/{meta.slug}/</span>, the topic tree,
              notes reader, question player and flashcard decks activate for this course with no
              further code changes. Nothing is simulated here — a hub with no corpus stays
              honestly empty.
            </p>
            <p>
              Explore the fully-loaded pilot course instead:{" "}
              <Link
                href={`/courses/${pilotSlug ?? ""}`}
                className="font-medium text-primary underline underline-offset-2"
              >
                Edexcel IGCSE Chemistry (4CH1)
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* specification card (SME: spec download; SyllabAI: parsed spec deep-link) */}
          <Card className="mt-6">
            <CardContent className="flex flex-wrap items-center gap-4 p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                  <GraduationCap className="size-4.5 text-primary" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold">Specification {meta.code}</p>
                  <p className="text-xs text-muted-foreground">
                    {officialTree
                      ? "Parsed specification points — the canonical tree powering this hub"
                      : "Corpus spec points (SME-native anchors) — the navigation tree powering this hub; official-code mapping is pending upstream"}
                  </p>
                </div>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {stats.specPoints} spec points
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px]">
                  data: {cfg.dataMode}
                </Badge>
                <Link
                  href={`/courses/${meta.slug}/specification`}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                >
                  <ListTree className="size-4" aria-hidden />
                  Specification tree
                </Link>
                <Link
                  href={`/knowledge-graph?course=${meta.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                >
                  View parsed spec <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* the two SME resource bands */}
          {bands.map((band) => (
            <section key={band.id} aria-label={band.title} className="mt-8 space-y-3">
              <div className="space-y-0.5">
                <h2 className="text-xl font-bold tracking-tight">{band.title}</h2>
                <p className="text-sm text-muted-foreground">{band.tagline}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {band.items.map((r) => {
                  const inner = (
                    <Card
                      className={
                        r.ready
                          ? "h-full transition-colors hover:border-primary/40"
                          : "h-full opacity-70"
                      }
                    >
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <r.icon className="size-4 text-primary" aria-hidden />
                          {r.title}
                        </CardTitle>
                        <CardDescription className="pt-1.5">
                          <span className="flex flex-wrap gap-1.5">
                            {r.tags.map((t) => (
                              <TagChip key={t} tag={t} />
                            ))}
                          </span>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2.5">
                        <CardDescription className="leading-relaxed">{r.desc}</CardDescription>
                        {r.ready ? (
                          <p className="text-xs font-medium text-foreground">
                            {r.countLabel}
                            <span className="ml-2 inline-flex items-center gap-1 text-primary">
                              All topics <ArrowRight className="size-3.5" aria-hidden />
                            </span>
                          </p>
                        ) : (
                          <p>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              roadmap
                            </span>
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                  return r.ready ? (
                    <Link key={r.title} href={r.href ?? base} className="group focus-visible:outline-none">
                      {inner}
                    </Link>
                  ) : (
                    <div key={r.title} aria-disabled title="Not part of the demo corpus yet">
                      {inner}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {/* SME's "Our revision framework" explainer */}
          <section aria-label="Our revision framework" className="mt-10 space-y-3">
            <h2 className="text-lg font-semibold">Our revision framework</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {framework.map((f) => (
                <Card key={f.tag} className="bg-muted/40">
                  <CardContent className="space-y-2 p-4">
                    <TagChip tag={f.tag} />
                    <p className="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
