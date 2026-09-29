"use client";

/**
 * My Progress page shell (ADR-029 tranche 4.1 + V51 classroom tab).
 *
 * The learner-model tabs reuse the drawer's tab components so the surfaces
 * can never disagree. A fourth tab — CLASSROOM — renders ONLY when the
 * learner holds at least one live class membership (TFA-02's
 * independent-student rule): a class-enrolled student gets announcements
 * beside their learning state; an independent student's page is byte-for-byte
 * what it was before classrooms existed.
 */

import { useEffect, useState } from "react";
import { GraduationCap, User } from "lucide-react";
import { ProvenanceBadge } from "@/components/provenance";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { PILOT_COURSE_SLUG } from "@/lib/attempt-bridge";
import { useLearnerState } from "@/lib/kg-learner-state";
import { HistoryTab, StateTab } from "../knowledge-graph/state-drawer";
import { AssignmentsTab } from "./assignments-tab";
import { ClassroomTab } from "./classroom-tab";

export function LearnerClient() {
  // the 4CH1 pilot — the only course with a core-backed learner model today
  const { overlay, drawer, source } = useLearnerState(PILOT_COURSE_SLUG);
  const live = source === "core";

  // the classroom overlay probe: null = still asking; [] = no membership
  // (the independent case — the tab disappears); non-empty = class-enrolled
  const [classNames, setClassNames] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .learnerClassroom()
      .then((v) => {
        if (!cancelled) setClassNames(v.classes.map((c) => c.name));
      })
      .catch(() => {
        // a backend that predates the classroom contract, or a failed call:
        // the honest default for THIS surface is the pre-classroom page
        if (!cancelled) setClassNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const classroomTab = classNames !== null && classNames.length > 0;

  if (overlay?.bridgeError) {
    return (
      <div className="space-y-4">
        <Header live={false} />
        <div className="rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="text-sm font-medium">Learner state unavailable right now</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            The bridge that maps your progress onto the 4CH1 specification could not be
            loaded, so nothing can be shown honestly. Your recorded answers are safe —
            retry in a moment.
          </p>
        </div>
      </div>
    );
  }

  if (!drawer) {
    return (
      <div className="space-y-4">
        <Header live={live} />
        <div className="flex min-h-[40vh] items-center justify-center">
          <div
            className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-primary"
            role="status"
            aria-label="Loading your learner model"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header live={live} />
      <Tabs defaultValue="state">
        <TabsList>
          <TabsTrigger value="state">My state</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          {classroomTab && (
            <TabsTrigger value="classroom" className="gap-1.5">
              <GraduationCap className="size-3.5" aria-hidden />
              Classroom
            </TabsTrigger>
          )}
        </TabsList>
        <div className="mt-3">
          <TabsContent value="state" className="mt-0">
            <StateTab drawer={drawer} live={live} course={PILOT_COURSE_SLUG} />
          </TabsContent>
          <TabsContent value="history" className="mt-0">
            <HistoryTab drawer={drawer} />
          </TabsContent>
          <TabsContent value="assignments" className="mt-0">
            <AssignmentsTab />
          </TabsContent>
          {classroomTab && (
            <TabsContent value="classroom" className="mt-0">
              <ClassroomTab />
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}

function Header({ live }: { live: boolean }) {
  return (
    <div>
      <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
        <User className="size-5 text-primary" aria-hidden />
        My Progress
        <ProvenanceBadge tier={live ? "CORE_MEASURED" : "SIMULATED"} />
        <Badge variant="outline" className="font-mono text-[10px]">
          4CH1 · pilot
        </Badge>
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        {live
          ? "Measured live from your SyllabAI account — real attempts, Smart Mark evidence, Ebbinghaus decay and review scheduling computed on the backend. The same model paints the Knowledge Graph."
          : "Derived from this browser's practice on the 4CH1 pilot — a simulated, browser-local overlay that never writes to course data. Sign in on the pilot course to switch to the measured model."}
      </p>
    </div>
  );
}
