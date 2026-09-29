"use client";

/**
 * Learner Classroom tab (V51, TFA-02 — the classroom student capability
 * layer, TEACHER_ARCHITECTURE §4.2): announcements from the learner's live
 * classes with per-announcement read state, beside the class list.
 *
 * THE INDEPENDENT-STUDENT RULE (operator directive): this tab renders ONLY
 * when the learner holds at least one live class membership — a student with
 * no membership sees NOTHING here (the tab itself does not exist for them).
 * The classroom overlay adds capabilities; it never changes the independent
 * experience, and it is plain teacher communication — never an AI channel.
 *
 * Honesty rules: every read is live from core and membership-derived; a
 * failed load surfaces its error instead of pretending the classroom is
 * empty (an empty classroom is an honest state, a broken one is an error).
 */

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Check, Loader2, Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type { LearnerAnnouncementView, LearnerClassroomView } from "@/lib/types";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  general: "General",
  homework: "Homework",
  notice: "Notice",
  "exam-reminder": "Exam reminder",
  resource: "Resource",
};

export function ClassroomTab() {
  const [overview, setOverview] = useState<LearnerClassroomView | null>(null);
  const [feed, setFeed] = useState<LearnerAnnouncementView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, a] = await Promise.all([api.learnerClassroom(), api.learnerClassroomAnnouncements()]);
      setOverview(o);
      setFeed(a);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Your classroom is unavailable right now — core did not answer.",
      );
      setOverview({ classes: [], unreadAnnouncements: 0 });
      setFeed([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (id: string) => {
    setMarking(id);
    try {
      await api.markAnnouncementRead(id);
      setFeed((prev) => (prev ?? []).map((a) => (a.id === id ? { ...a, read: true } : a)));
      setOverview((prev) =>
        prev
          ? {
              ...prev,
              unreadAnnouncements: Math.max(0, prev.unreadAnnouncements - 1),
              classes: prev.classes.map((c) => ({
                ...c,
                unreadAnnouncements: Math.max(0, c.unreadAnnouncements - 1),
              })),
            }
          : prev,
      );
    } catch {
      // a failed receipt is non-fatal — the announcement stays unread
    } finally {
      setMarking(null);
    }
  };

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (overview === null || feed === null) {
    return (
      <div className="flex min-h-[20vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading classroom" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {overview.classes.length > 0 && (
        <section aria-label="My classes">
          <div className="flex flex-wrap items-center gap-2">
            {overview.classes.map((c) => (
              <Badge key={c.id} variant="outline" className="gap-1.5 py-1 text-xs">
                {c.name}
                <span className="text-muted-foreground">· {c.courseLabel}</span>
                {c.unreadAnnouncements > 0 ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                    {c.unreadAnnouncements} new
                  </span>
                ) : (
                  <BellOff className="size-3 text-muted-foreground" aria-hidden />
                )}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {feed.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="text-sm font-medium">No announcements yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Your teachers' notices for your classes appear here — homework, exam
            reminders and resources. Nothing else in your workspace changes.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {feed.map((a) => (
            <li
              key={a.id}
              className={cn(
                "rounded-lg border px-4 py-3",
                !a.read && "border-primary/30 bg-primary/[0.04]",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {!a.read && <Bell className="size-3.5 text-primary" aria-hidden />}
                  {a.title}
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {CATEGORY_LABEL[a.category] ?? a.category}
                  </Badge>
                  {!a.read && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void markRead(a.id)}
                      disabled={marking === a.id}
                      aria-label={`Mark "${a.title}" read`}
                    >
                      {marking === a.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <>
                          <Check className="size-3.5" aria-hidden /> Mark read
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                <Megaphone className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                {a.className} · {a.teacherName}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
