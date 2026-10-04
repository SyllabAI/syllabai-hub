"use client";

/**
 * CourseSwitcher — SME's course dropdown on the hub page (Task 21-b,
 * dissected from the reference course page: "Course | Chemistry Edexcel"
 * picker listing the student's saved courses first).
 *
 * Order: the student's roster (localStorage, most relevant first) then the
 * rest of the registry. The current course is marked. Client island —
 * the roster lives in localStorage, so this cannot be a server component.
 */
import Link from "next/link";
import { Check, ChevronsUpDown, LayoutDashboard } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMySubjects } from "@/lib/my-subjects";
import { cn } from "@/lib/utils";

export interface SwitcherCourse {
  slug: string;
  label: string;
  subject: string;
  level: string;
}

export function CourseSwitcher({
  current,
  courses,
}: {
  current: string;
  courses: SwitcherCourse[];
}) {
  // UX audit 2026-10-02 #18: the hook exposes add() but nothing ever called
  // it — "pick from the registry below" was a promise the rows couldn't keep.
  const { slugs, add } = useMySubjects();
  const bySlug = new Map(courses.map((c) => [c.slug, c]));

  // roster order first (registry-validated), then the remaining registry
  const roster = slugs.map((s) => bySlug.get(s)).filter((c): c is SwitcherCourse => Boolean(c));
  const rest = courses.filter((c) => !slugs.includes(c.slug));
  const cur = bySlug.get(current);

  const row = (c: SwitcherCourse) => {
    const active = c.slug === current;
    return (
      <DropdownMenuItem key={c.slug} asChild>
        <Link
          href={`/courses/${c.slug}`}
          className={cn("cursor-pointer", active && "font-semibold text-primary")}
          aria-current={active ? "page" : undefined}
          // picking a subject from the registry adds it to My subjects
          // (audit #18 — the copy promised this; the row now delivers)
          onClick={() => add(c.slug)}
        >
          <Check className={cn("size-4", active ? "opacity-100" : "opacity-0")} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{c.label}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{c.level}</span>
        </Link>
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-9 max-w-full items-center gap-2 rounded-lg border bg-card px-3 text-sm shadow-sm transition-colors",
          "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label="Switch course"
      >
        <LayoutDashboard className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="truncate">
          <span className="text-muted-foreground">Course</span>
          <span className="mx-1.5 text-muted-foreground/50">|</span>
          <span className="font-semibold">{cur?.label ?? cur?.subject ?? "Course"}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>My subjects</DropdownMenuLabel>
        {roster.length > 0 ? roster.map(row) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No saved subjects yet — pick from the registry below.
          </p>
        )}
        {rest.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>All subjects</DropdownMenuLabel>
            <div className="max-h-72 overflow-y-auto">{rest.map(row)}</div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
