"use client";

/**
 * My Progress — the real learner model viewer (ADR-029 tranche 4.1).
 *
 * Renders the same derivation that paints the Knowledge Graph and feeds its
 * drawer (lib/kg-learner-state.ts — one pass, one UI): stat tiles, topic
 * mastery (core granularity), the decay-derived review queue, the spec-point
 * mastery table and the attempt-history stream, reusing the drawer's tab
 * components so the surfaces can never disagree.
 *
 * Provenance rules (the honesty contract):
 *   - CORE model (4CH1 pilot + signed in + core reachable): CORE_MEASURED —
 *     real attempt evidence, backend-computed decay and review scheduling.
 *   - Anything else: SIMULATED — the browser-local progress overlay, never
 *     written to course data, labelled on every section.
 *   - Bridge failure: an honest unavailable panel — no fabricated numbers.
 */
import { User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProvenanceBadge } from "@/components/provenance";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLearnerState } from "@/lib/kg-learner-state";
import { PILOT_COURSE_SLUG } from "@/lib/attempt-bridge";
import { HistoryTab, StateTab } from "../knowledge-graph/state-drawer";

export function LearnerClient() {
  // the 4CH1 pilot — the only course with a core-backed learner model today
  const { overlay, drawer, source } = useLearnerState(PILOT_COURSE_SLUG);
  const live = source === "core";

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
        </TabsList>
        <div className="mt-3">
          <TabsContent value="state" className="mt-0">
            <StateTab drawer={drawer} live={live} />
          </TabsContent>
          <TabsContent value="history" className="mt-0">
            <HistoryTab drawer={drawer} />
          </TabsContent>
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
