"use client";

/**
 * Set work card (T-C78, Spec §22 GET /api/v1/learners/me/agenda) — the
 * dashboard's slice of the server-composed learner agenda: the ASSIGNMENTS
 * block (teacher-set work with the learner's own append-only hand-in trail
 * beside each), ordered due-soonest-first by the server — an agenda, not a
 * newest-first feed.
 *
 * Surface note: this card lives on the PRODUCT frontend (syllabai-hub,
 * ADR-029). The T-C76 UI leg had merged its panel into syllabai-web — the
 * demoted internal console where product-surface development is frozen —
 * and T-C78 reverts that merge; this component is the corrected home.
 *
 * Composition, not duplication: the agenda's other blocks have their own
 * surfaces — due reviews headline in the ReviewDueStrip, next-best actions
 * in the NBA card (advice). The card calls the agenda WITHOUT a rootId, so
 * actions stay null and no second advice feed exists.
 *
 * Facts, not advice: every row is a real assignment row under the V51
 * visibility rule (class work only for members), and the hand-in state is
 * the learner's own trail — never mastery, never a prediction. Derived
 * "overdue" is client-side presentation over the server's dueAt (the server
 * keeps one vocabulary for the fact; due_at is NOT NULL per V49, so every
 * row is dated). Signed out renders nothing (this is account data); a core
 * failure degrades inside the card and never breaks the dashboard.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, ClipboardList, CloudCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, getToken } from "@/lib/api";
import { formatDue } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import type { AgendaView } from "@/lib/types";

export function SetWorkCard() {
  // Signed-out is captured once — the agenda is account data, so the card
  // is silently absent (the dashboard's signed-out posture: nothing blocks,
  // nothing pretends).
  const [signedOut] = useState(() => !getToken());
  const [agenda, setAgenda] = useState<AgendaView | null>(null);
  const [failed, setFailed] = useState(false);
  const now = useNow();

  useEffect(() => {
    if (signedOut) return;
    let alive = true;
    api
      .learnerAgenda()
      .then((a) => {
        if (alive) setAgenda(a);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [signedOut]);

  if (signedOut) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4 text-primary" aria-hidden="true" />
          Set work
        </CardTitle>
        <CardDescription>
          Assigned by your teacher, due-soonest first — with where your hand-in stands.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed ? (
          <p className="text-sm text-muted-foreground">
            Set work is unavailable right now — your account still holds it; try again later.
          </p>
        ) : agenda === null ? (
          <div className="space-y-1.5" aria-hidden>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : agenda.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No set work yet — assignments your teacher sets will appear here.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {agenda.assignments.map(({ assignment, mySubmission }) => {
                const overdue =
                  assignment.status === "open" && Date.parse(assignment.dueAt) < now;
                return (
                  <li
                    key={assignment.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/courses/${assignment.courseSlug}/exam-questions`}
                        className="block truncate text-sm font-medium hover:text-primary hover:underline"
                      >
                        {assignment.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {assignment.courseLabel} · {formatDue(assignment.dueAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {assignment.status === "closed" && (
                        <Badge variant="outline" className="text-xs">
                          Closed
                        </Badge>
                      )}
                      {overdue && !mySubmission && (
                        <Badge
                          variant="outline"
                          className="text-xs text-rose-600 dark:text-rose-400"
                        >
                          Overdue
                        </Badge>
                      )}
                      {mySubmission ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <CircleCheck className="size-3.5" aria-hidden="true" />
                          Handed in
                          {mySubmission.score !== null
                            ? ` · ${mySubmission.score}/${assignment.marksTotal}`
                            : ""}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CloudCheck className="size-3 shrink-0" aria-hidden="true" />
              From your SyllabAI account — set by your teacher, follows you across devices.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
