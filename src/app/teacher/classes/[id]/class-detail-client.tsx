"use client";

/**
 * One class's workspace (V51, TFA-01/02): the live roster (enroll by email,
 * remove), the announcement board (publish with §9 categories, per-
 * announcement read counts over the real roster), and the lifecycle switch.
 *
 * Honesty rules: everything is live from core; the read count states what it
 * counts ("read by N of M"); a failed action surfaces its real message and
 * changes nothing locally.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Loader2,
  Megaphone,
  Network,
  Send,
  Trash2,
  UserPlus,
} from "lucide-react";
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
import type { TeacherAnnouncementView, TeacherClassDetailView } from "@/lib/types";
import { cn } from "@/lib/utils";

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

const CATEGORY_LABEL: Record<string, string> = {
  general: "General",
  homework: "Homework",
  notice: "Notice",
  "exam-reminder": "Exam reminder",
  resource: "Resource",
};

export function ClassDetailClient({ classId }: { classId: string }) {
  const [detail, setDetail] = useState<TeacherClassDetailView | null>(null);
  const [announcements, setAnnouncements] = useState<TeacherAnnouncementView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // enroll form
  const [email, setEmail] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [enrollNote, setEnrollNote] = useState<string | null>(null);

  // announcement composer
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, a] = await Promise.all([api.teacherClassDetail(classId), api.teacherClassAnnouncements(classId)]);
      setDetail(d);
      setAnnouncements(a);
    } catch (err) {
      setError(apiMessage(err, "This class is unavailable right now — core did not answer."));
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  const enroll = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setEnrolling(true);
    setEnrollNote(null);
    try {
      const d = await api.teacherClassEnroll(classId, { email: trimmed });
      setDetail(d);
      setEmail("");
      setEnrollNote(
        d.members.some((m) => m.email.toLowerCase() === trimmed.toLowerCase())
          ? `Enrolled: ${trimmed}`
          : null,
      );
    } catch (err) {
      setEnrollNote(apiMessage(err, "The enrollment did not reach core."));
    } finally {
      setEnrolling(false);
    }
  };

  const removeMember = async (studentId: string) => {
    try {
      setDetail(await api.teacherClassRemoveMember(classId, studentId));
    } catch (err) {
      setError(apiMessage(err, "The removal did not reach core."));
    }
  };

  const publish = async () => {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await api.teacherPublishAnnouncement(classId, { title: t, body: b, category });
      setTitle("");
      setBody("");
      setCategory("general");
      setAnnouncements(await api.teacherClassAnnouncements(classId));
    } catch (err) {
      setPublishError(apiMessage(err, "The announcement did not reach core."));
    } finally {
      setPublishing(false);
    }
  };

  const toggleStatus = async () => {
    if (!detail) return;
    try {
      await api.teacherSetClassStatus(classId, detail.status === "active" ? "archived" : "active");
      await load();
    } catch (err) {
      setError(apiMessage(err, "The status change did not reach core."));
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading class" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Link href="/teacher/classes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> All classes
        </Link>
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error ?? "Class not found."}
        </div>
      </div>
    );
  }

  const active = detail.status === "active";

  return (
    <div className="space-y-4">
      <Link
        href="/teacher/classes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> All classes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
            {detail.name}
            <Badge variant="outline" className="font-mono text-[10px]">
              {detail.status}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{detail.courseLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/teacher/classes/${detail.id}/knowledge-graph`}>
              <Network className="size-3.5" aria-hidden /> Class KG heatmap
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void toggleStatus()}>
            {active ? (
              <>
                <Archive className="size-3.5" aria-hidden /> Archive
              </>
            ) : (
              <>
                <ArchiveRestore className="size-3.5" aria-hidden /> Reopen
              </>
            )}
          </Button>
        </div>
      </div>

      {!active && (
        <div className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
          This class is archived — students no longer see it in their classroom, and
          enrollment/publishing are closed until you reopen it.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* roster */}
        <Card>
          <CardContent className="space-y-3 pt-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <UserPlus className="size-4 text-primary" aria-hidden />
              Roster · {detail.members.length} {detail.members.length === 1 ? "student" : "students"}
            </h2>
            <div className="flex gap-2">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@school.example — registered email"
                type="email"
                disabled={!active}
                aria-label="Student email to enroll"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void enroll();
                }}
              />
              <Button onClick={() => void enroll()} disabled={enrolling || !active || !email.trim()}>
                {enrolling ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "Enroll"}
              </Button>
            </div>
            {enrollNote && <p className="text-xs text-muted-foreground">{enrollNote}</p>}
            {detail.members.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                Nobody enrolled yet. Students register first (the join-code flow), then you
                enroll them here by email. Enrollment never touches their learning data.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {detail.members.map((m) => (
                  <li key={m.studentId} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{m.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    {active && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${m.displayName}`}
                        onClick={() => void removeMember(m.studentId)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* announcements */}
        <Card>
          <CardContent className="space-y-3 pt-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Megaphone className="size-4 text-primary" aria-hidden />
              Announcements
            </h2>
            {active && (
              <div className="space-y-2">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title — e.g. Test on Thursday"
                  maxLength={200}
                  aria-label="Announcement title"
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="What should the class know?"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Announcement body"
                />
                <div className="flex items-center gap-2">
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="w-40" aria-label="Announcement category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={() => void publish()} disabled={publishing || !title.trim() || !body.trim()}>
                    {publishing ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <>
                        <Send className="size-3.5" aria-hidden /> Publish
                      </>
                    )}
                  </Button>
                </div>
                {publishError && (
                  <p role="alert" className="text-xs text-destructive">
                    {publishError}
                  </p>
                )}
              </div>
            )}
            {announcements.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                Nothing published yet. Announcements reach exactly this class's members
                inside their subject workspace — never an AI channel, never anyone else.
              </p>
            ) : (
              <ul className="space-y-2">
                {announcements.map((a) => {
                  const pct = a.memberCount > 0 ? Math.round((a.readCount / a.memberCount) * 100) : 0;
                  return (
                    <li key={a.id} className="rounded-lg border px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{a.title}</p>
                        <Badge variant="outline" className="text-[10px]">
                          {CATEGORY_LABEL[a.category] ?? a.category}
                        </Badge>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{a.body}</p>
                      <p className={cn("mt-1.5 text-[10px] text-muted-foreground")} title={`${a.readCount} of ${a.memberCount} members read this`}>
                        read by {a.readCount} of {a.memberCount}
                      </p>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
