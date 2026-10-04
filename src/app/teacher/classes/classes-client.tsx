"use client";

/**
 * Teacher Classes (V51, TFA-01 — the explicit Class entity's hub surface,
 * TEACHER_ARCHITECTURE §8): create a class on one hub course, open its
 * roster/announcements workspace, archive or reopen it.
 *
 * Honesty rules carried over from the console surfaces:
 *   - Everything here is LIVE from core (RBAC on every call) — no SAMPLE
 *     cohort, no localStorage. A class one browser kept to itself would be
 *     a lie the student could never see.
 *   - Member counts are core-computed from the membership rows; nothing is
 *     derived on the client.
 *   - Errors surface inline — never a fake success.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Loader2, Plus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api } from "@/lib/api";
import type { TeacherClassView } from "@/lib/types";
import type { CourseMeta } from "@/lib/courses";
import { useMyClasses } from "@/lib/teacher/my-classes";
import { cn } from "@/lib/utils";

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function TeacherClassesClient({
  courses,
  pilotSlug,
}: {
  courses: CourseMeta[];
  pilotSlug: string | null;
}) {
  const [classes, setClasses] = useState<TeacherClassView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Audit P2-6: the Classes tab showed only core rosters while the dashboard
  // showed only browser-local containers — neither surface knew the other
  // existed. Local containers are listed here too, honestly badged as
  // this-device-only (never impersonating a live roster).
  const { classes: localClasses } = useMyClasses();

  // create form
  const [showCreate, setShowCreate] = useState(false);
  const [courseSlug, setCourseSlug] = useState<string>(pilotSlug ?? courses[0]?.slug ?? "");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setClasses(await api.teacherClasses());
    } catch (err) {
      setError(apiMessage(err, "Classes are unavailable right now — core did not answer."));
      setClasses([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const course = courses.find((c) => c.slug === courseSlug) ?? courses[0];
    if (!course) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.teacherCreateClass({
        courseSlug: course.slug,
        courseLabel: course.label,
        name: trimmed,
      });
      setName("");
      setShowCreate(false);
      await load();
    } catch (err) {
      setCreateError(apiMessage(err, "The class could not be created on core."));
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (id: string, status: "active" | "archived") => {
    try {
      await api.teacherSetClassStatus(id, status);
      await load();
    } catch (err) {
      setError(apiMessage(err, "The status change did not reach core."));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Users className="size-5 text-primary" aria-hidden />
            Classes
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Your classes per subject — rosters, announcements and class-targeted
            assignments. Live from the SyllabAI backend; members see the classroom
            overlay inside their subject workspace, and independent students are
            never touched by it.
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate}>
          <Plus className="size-4" aria-hidden /> New class
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="class-name">
                  Class name
                </label>
                <Input
                  id="class-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. 10A · retake cohort"
                  maxLength={120}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void create();
                  }}
                />
              </div>
              <div className="space-y-1.5 sm:w-72">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="class-course">
                  Subject (hub course)
                </label>
                <Select value={courseSlug} onValueChange={setCourseSlug}>
                  <SelectTrigger id="class-course" className="w-full">
                    <SelectValue placeholder="Pick the subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => (
                      <SelectItem key={c.slug} value={c.slug}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {createError && (
              <p role="alert" className="text-xs text-destructive">
                {createError}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button onClick={() => void create()} disabled={creating || !name.trim()}>
                {creating && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Create class
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {classes === null ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading classes" />
        </div>
      ) : classes.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="text-sm font-medium">
            {localClasses.length > 0 ? "No live classes yet" : "No classes yet"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            {localClasses.length > 0
              ? "Your browser-local class containers are listed below — they live in this device only. Live rosters, announcements and class-targeted assignments start here: create a class, enroll registered students by email."
              : "Create your first class, enroll registered students by email, and publish announcements. A class-targeted assignment is visible to exactly its members; assignments without a class still reach every student."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {classes.map((c) => (
            <Card key={c.id} className={cn(c.status === "archived" && "opacity-70")}>
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/teacher/classes/${c.id}`}
                      className="text-base font-semibold hover:underline"
                    >
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{c.courseLabel}</p>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {c.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {c.memberCount} {c.memberCount === 1 ? "student" : "students"} enrolled
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/teacher/classes/${c.id}`}>Open workspace</Link>
                  </Button>
                  {c.status === "active" ? (
                    <Button size="sm" variant="ghost" onClick={() => void setStatus(c.id, "archived")}>
                      <Archive className="size-3.5" aria-hidden /> Archive
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void setStatus(c.id, "active")}>
                      <ArchiveRestore className="size-3.5" aria-hidden /> Reopen
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Browser-local class containers (audit P2-6) — visible here, honestly
          labelled: they are device-local dashboards, NOT live rosters, and
          they render even when core is unreachable. */}
      {localClasses.length > 0 && (
        <section aria-labelledby="local-class-containers" className="space-y-2 border-t pt-5">
          <h2 id="local-class-containers" className="text-sm font-semibold">
            Browser-local class containers{" "}
            <span className="text-xs font-normal text-muted-foreground">
              · {localClasses.length} · this device only
            </span>
          </h2>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {localClasses.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/teacher/classes/${c.id}`}
                  className="flex items-center gap-2.5 rounded-lg border border-dashed px-3 py-2.5 transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="shrink-0 rounded-full border bg-background px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    This browser
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {c.subjectSlugs.length} {c.subjectSlugs.length === 1 ? "subject" : "subjects"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Created on the teacher dashboard and stored in this browser only — the tools and
            course resources inside them work from the local corpus, and enrolled-student rosters
            are a live-Classes-surface concept they never impersonate.
          </p>
        </section>
      )}
    </div>
  );
}
