"use client";

/**
 * Add-course overlay — the cascading board → level → subject picker that
 * replaced the dashboard's trailing catalogue section (user spec: the
 * dashboard lists only the learner's own subjects; discovery of everything
 * else lives behind the "Got another course?" slot card, the header button
 * and the empty-state CTA — all of which open this dialog).
 *
 * The cascade mirrors the registry's real shape rather than inventing a
 * taxonomy: every course in content/courses.json is a Pearson Edexcel lane
 * (same constant the subject cards' "Edexcel · {level}" eyebrow already
 * prints), levels are the distinct registry values, and the subject step
 * lists exact registry lanes (label, variant qualifier, exam code) — nothing
 * inferred. Adding is non-destructive to the dialog: several subjects can be
 * added in one pass before "Done".
 */
import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { duplicateVariants } from "@/lib/course-variant";
import type { CourseMeta } from "@/lib/courses";

/** The demo registry is Edexcel-only (see content/courses.json note). */
const BOARD = "Edexcel";

function StepLabel({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <p className="flex items-baseline gap-2 text-sm font-semibold">
      <span className="flex size-5 shrink-0 translate-y-0.5 items-center justify-center rounded-full border text-xs tabular-nums text-muted-foreground">
        {n}
      </span>
      {title}
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </p>
  );
}

export function AddCourseOverlay({
  open,
  onOpenChange,
  courses,
  has,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: CourseMeta[];
  has: (slug: string) => boolean;
  onAdd: (slug: string) => void;
}) {
  const [level, setLevel] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const subtitles = useMemo(() => duplicateVariants(courses), [courses]);

  // distinct registry levels, busiest first — the honest cascade step 2
  const levels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of courses) counts.set(c.level, (counts.get(c.level) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [courses]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return courses
      .filter((c) => !has(c.slug))
      .filter((c) => !level || c.level === level)
      .filter(
        (c) =>
          !needle ||
          c.label.toLowerCase().includes(needle) ||
          c.subject.toLowerCase().includes(needle) ||
          c.code.toLowerCase().includes(needle),
      )
      .sort(
        (a, b) =>
          a.subject.localeCompare(b.subject) ||
          a.label.localeCompare(b.label) ||
          a.slug.localeCompare(b.slug),
      );
  }, [courses, has, level, q]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setLevel(null);
      setQ("");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby="add-course-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4 text-primary" aria-hidden />
            Add a course
          </DialogTitle>
          <DialogDescription id="add-course-desc">
            Choose the exam board, then the level, then the subject lane. Added courses appear in
            My subjects instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* step 1 — board (the registry's single honest value) */}
          <div className="space-y-2">
            <StepLabel n={1} title="Board" />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-pressed
                className="border-primary/60 bg-primary/5 font-medium"
              >
                {BOARD}
              </Button>
              <span className="text-xs text-muted-foreground">
                The registry covers Pearson {BOARD} lanes only.
              </span>
            </div>
          </div>

          {/* step 2 — level */}
          <div className="space-y-2">
            <StepLabel n={2} title="Level" hint={level ? undefined : "pick one"} />
            <div className="flex flex-wrap gap-2">
              {levels.map(([name, count]) => (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={level === name}
                  onClick={() => setLevel(level === name ? null : name)}
                  className={
                    "gap-1.5 " + (level === name ? "border-primary/60 bg-primary/5 font-medium" : "")
                  }
                >
                  {name}
                  <Badge variant="secondary" className="px-1.5 text-[10px]">
                    {count}
                  </Badge>
                </Button>
              ))}
            </div>
          </div>

          {/* step 3 — subject lane */}
          <div className="space-y-2">
            <StepLabel n={3} title="Subject" hint={level ? undefined : "choose a level first"} />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by subject or exam code…"
              aria-label="Filter subjects"
              disabled={!level}
            />
            <div
              className="max-h-[42dvh] space-y-1.5 overflow-y-auto pr-1"
              aria-live="polite"
            >
              {!level ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Pick a level to see its subjects.
                </p>
              ) : list.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {q
                    ? `No ${level} course matches “${q}”.`
                    : `Every ${level} course is already in My subjects.`}
                </p>
              ) : (
                list.map((c) => {
                  const added = has(c.slug);
                  return (
                    <div
                      key={c.slug}
                      className="flex items-center gap-3 rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{c.label}</p>
                        {subtitles.get(c.slug) && (
                          <p className="truncate text-xs text-muted-foreground">
                            {subtitles.get(c.slug)}
                          </p>
                        )}
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {c.code || "code pending"}
                        </p>
                      </div>
                      {added ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                          <Check className="size-3.5" aria-hidden />
                          Added
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 gap-1.5"
                          onClick={() => onAdd(c.slug)}
                          aria-label={`Add ${c.label} to my subjects`}
                        >
                          <Plus className="size-3.5" aria-hidden />
                          Add
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {level
              ? `${list.length} ${list.length === 1 ? "lane" : "lanes"} not yet added`
              : "You can add several subjects before closing."}
          </p>
          <Button type="button" onClick={() => handleOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
