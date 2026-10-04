"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CourseMeta } from "@/lib/courses";
import { duplicateVariants } from "@/lib/course-variant";

export function CourseDirectory({ courses }: { courses: CourseMeta[] }) {
  const [q, setQ] = useState("");
  // same subject+code lanes (e.g. Accounting 4AC1 ×2) — show the lane
  // qualifier from the slug so the cards are tellable apart (UX audit P2-7)
  const subtitles = useMemo(() => duplicateVariants(courses), [courses]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return courses;
    return courses.filter(
      (c) =>
        c.label.toLowerCase().includes(needle) ||
        c.subject.toLowerCase().includes(needle) ||
        c.code.toLowerCase().includes(needle) ||
        c.level.toLowerCase().includes(needle),
    );
  }, [courses, q]);

  const groups = useMemo(() => {
    const g = new Map<string, CourseMeta[]>();
    for (const c of filtered) g.set(c.level, [...(g.get(c.level) ?? []), c]);
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  return (
    <div className="space-y-6">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${courses.length} courses by subject or exam code…`}
        aria-label="Search courses"
        className="max-w-md"
      />
      {groups.map(([level, list]) => (
        <section key={level} aria-label={level}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {level} <span className="font-normal">· {list.length} course{list.length === 1 ? "" : "s"}</span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c) => (
              <Link key={c.slug} href={`/courses/${c.slug}`} className="group min-w-0 focus-visible:outline-none">
                <Card
                  className={
                    c.hasBundle
                      ? "h-full border-primary/30 transition-colors group-hover:border-primary/60 group-focus-visible:border-primary/60"
                      : "h-full transition-colors group-hover:border-primary/40 group-focus-visible:border-primary/60"
                  }
                >
                  <CardContent className="flex items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold group-hover:text-primary">{c.label}</p>
                      {subtitles.get(c.slug) && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitles.get(c.slug)}</p>
                      )}
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {c.code ? c.code : <span className="not-italic">code pending</span>}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.status === "pilot" ? (
                          <Badge className="text-[10.5px] uppercase">pilot corpus · official spec tree</Badge>
                        ) : c.status === "full" ? (
                          <Badge variant="outline" className="text-[10.5px] uppercase">
                            full corpus
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10.5px] uppercase text-muted-foreground">
                            import pending
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No courses match “{q}”.</p>
      )}
    </div>
  );
}
