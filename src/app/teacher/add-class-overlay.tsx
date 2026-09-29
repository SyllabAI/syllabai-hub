"use client";

/**
 * Add-class overlay — HUB-TEACHER-DASH wave 1 (operator trace
 * 1a0ec61d5612aa6d: "Teacher will add class, then select subjects").
 *
 * The student dashboard's AddCourseOverlay cascade (board → level →
 * subject), re-used verbatim where the registry is the same and changed
 * where the flow differs: step 1 is the CLASS NAME, step 3 MULTI-selects
 * subject lanes into a pending set (click toggles, nothing commits until
 * "Create class"), and the same dialog doubles as the EDIT flow for an
 * existing class (name pre-filled, current subjects pre-selected, footer
 * becomes "Save changes").
 *
 * Form seeding without effects: the inner form mounts FRESH each time the
 * dialog opens (Radix mounts DialogContent only while open, and the form
 * carries a key from the class being edited) — useState initializers seed
 * from props, no setState-in-effect cascade (the repo's react-hooks rule).
 *
 * Honesty: the created container is browser-local (the store's own copy
 * says so); the dialog's footer keeps that reminder one glance away.
 */
import { useMemo, useState } from "react";
import { Check, Plus, Users } from "lucide-react";
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
import type { TeacherCourseLite } from "./teacher-client";

/** The demo registry is Edexcel-only (same constant the student overlay prints). */
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

export interface AddClassTarget {
  id: string;
  name: string;
  subjectSlugs: string[];
}

/** The form — mounted fresh per open (see the header note). */
function AddClassForm({
  courses,
  editClass,
  onCommit,
  onCancel,
}: {
  courses: TeacherCourseLite[];
  editClass: AddClassTarget | null;
  onCommit: (name: string, subjectSlugs: string[]) => void;
  onCancel: () => void;
}) {
  // per-mount initializers — no reseed effects
  const [name, setName] = useState(editClass?.name ?? "");
  const [selected, setSelected] = useState<string[]>(editClass?.subjectSlugs ?? []);
  const [level, setLevel] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const subtitles = useMemo(() => duplicateVariants(courses), [courses]);

  const levels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of courses) counts.set(c.level, (counts.get(c.level) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [courses]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return courses
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
  }, [courses, level, q]);

  const toggle = (slug: string) =>
    setSelected((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]));

  const canCommit = name.trim().length > 0 && selected.length > 0;
  const commit = () => {
    if (!canCommit) return;
    onCommit(name.trim(), selected);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Users className="size-4 text-primary" aria-hidden />
          {editClass ? "Edit class" : "Add a class"}
        </DialogTitle>
        <DialogDescription>
          Name the class, then pick every subject it covers. The class workspace gathers the tools
          and course resources for all of them in one place.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* step 1 — class name */}
        <div className="space-y-2">
          <StepLabel n={1} title="Class name" hint="required" />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 10A · retake cohort"
            maxLength={120}
            aria-label="Class name"
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
        </div>

        {/* step 2 — board (the registry's single honest value) */}
        <div className="space-y-2">
          <StepLabel n={2} title="Board" />
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

        {/* step 3 — subject lanes, multi-select */}
        <div className="space-y-2">
          <StepLabel
            n={3}
            title="Subjects"
            hint={selected.length > 0 ? `${selected.length} selected` : "pick at least one"}
          />
          <div className="flex flex-wrap gap-2">
            {levels.map(([lname, count]) => (
              <Button
                key={lname}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={level === lname}
                onClick={() => setLevel(level === lname ? null : lname)}
                className={
                  "gap-1.5 " + (level === lname ? "border-primary/60 bg-primary/5 font-medium" : "")
                }
              >
                {lname}
                <Badge variant="secondary" className="px-1.5 text-[10px]">
                  {count}
                </Badge>
              </Button>
            ))}
          </div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by subject or exam code…"
            aria-label="Filter subjects"
            disabled={!level}
          />
          <div
            className="max-h-[38dvh] space-y-1.5 overflow-y-auto pr-1"
            aria-live="polite"
          >
            {!level ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Pick a level to see its subjects.
              </p>
            ) : list.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No {level} course matches “{q}”.
              </p>
            ) : (
              list.map((c) => {
                const picked = selected.includes(c.slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => toggle(c.slug)}
                    aria-pressed={picked}
                    className={
                      "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors " +
                      (picked
                        ? "border-primary/60 bg-primary/5"
                        : "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")
                    }
                  >
                    <span
                      className={
                        "flex size-5 shrink-0 items-center justify-center rounded border " +
                        (picked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background")
                      }
                      aria-hidden
                    >
                      {picked && <Check className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{c.label}</span>
                      {subtitles.get(c.slug) && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {subtitles.get(c.slug)}
                        </span>
                      )}
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                        {c.code || "code pending"}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {/* selected lanes outside the current filter stay visible and
              removable — the pending set must never be a hidden state */}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t pt-2">
              {selected.map((slug) => {
                const c = courses.find((x) => x.slug === slug);
                if (!c) return null;
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => toggle(slug)}
                    className="group inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-medium transition-colors hover:border-destructive/50 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Remove ${c.label} from the class`}
                  >
                    {c.label}
                    <span aria-hidden className="text-muted-foreground group-hover:text-destructive">
                      ×
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="items-center gap-2 sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {canCommit
            ? editClass
              ? "Saves to this browser."
              : "Saved to this browser — a live core roster is a separate surface."
            : "A class needs a name and at least one subject."}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={commit} disabled={!canCommit}>
            <Plus className="size-3.5" aria-hidden />
            {editClass ? "Save changes" : "Create class"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

export function AddClassOverlay({
  open,
  onOpenChange,
  courses,
  editClass,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: TeacherCourseLite[];
  editClass?: AddClassTarget | null;
  onCreate: (name: string, subjectSlugs: string[]) => void;
  onUpdate: (id: string, patch: { name: string; subjectSlugs: string[] }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* the form mounts fresh per open — Radix keeps DialogContent
            unmounted while closed, and the key distinguishes create from
            each distinct edit target */}
        <AddClassForm
          key={editClass ? `edit-${editClass.id}` : "create"}
          courses={courses}
          editClass={editClass ?? null}
          onCommit={(name, subjectSlugs) => {
            if (editClass) onUpdate(editClass.id, { name, subjectSlugs });
            else onCreate(name, subjectSlugs);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
