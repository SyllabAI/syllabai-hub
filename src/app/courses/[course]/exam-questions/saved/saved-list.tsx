"use client";

/**
 * Saved questions list — reads the SIMULATED overlay's saved set (SME
 * "Saved questions", research §6.2) and resolves it against the corpus.
 */
import Link from "next/link";
import { Bookmark, BookmarkX, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toggleSavedQuestion, useCourseProgress, type Course } from "@/lib/progress";

export interface SavedQuestionMeta {
  questionId: string;
  topicSlug: string;
  topicName: string;
  marks: number;
  snippet: string;
  subtopicCode: string | null;
}

export function SavedQuestionsList({
  course,
  all,
}: {
  course: Course;
  all: SavedQuestionMeta[];
}) {
  const progress = useCourseProgress(course);
  const savedIds = Object.keys(progress.saved);
  const rows = all.filter((q) => savedIds.includes(q.questionId));

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm leading-relaxed text-muted-foreground">
          No saved questions yet. Use the{" "}
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <Bookmark className="size-3.5" aria-hidden /> Save
          </span>{" "}
          control on any question in a set — it lands here so you can come back to it.
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((q) => (
        <li key={q.questionId}>
          <Card>
            <CardContent className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/courses/${course}/exam-questions/${q.topicSlug}`}
                  className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
                >
                  {q.topicName}
                </Link>
                <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{q.snippet}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {q.marks} marks
                  </Badge>
                  {q.subtopicCode && (
                    <code className="rounded bg-muted px-1 text-[10px]">{q.subtopicCode}</code>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <Link
                  href={`/courses/${course}/exam-questions/${q.topicSlug}`}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  open set <ChevronRight className="size-3.5" aria-hidden />
                </Link>
                <button
                  className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 py-2 text-xs text-muted-foreground transition-colors hover:text-destructive"
                  onClick={() => toggleSavedQuestion(course, q.questionId, q.topicSlug, q.subtopicCode)}
                  aria-label="Remove from saved"
                >
                  <BookmarkX className="size-3.5" aria-hidden /> remove
                </button>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
