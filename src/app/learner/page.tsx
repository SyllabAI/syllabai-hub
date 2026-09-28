import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { LearnerClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * My Progress — the real learner model (ADR-029 tranche 4.1).
 *
 * Rewired from the old simulated-overlay viewer: the page now renders the
 * SAME derivation that paints the Knowledge Graph and feeds its My State /
 * History drawer (lib/kg-learner-state.ts — one pass, so the page, the graph
 * and the drawer can never disagree). On the 4CH1 pilot with a signed-in
 * learner that is the CORE model — real attempts, real Ebbinghaus decay,
 * real review queue — labelled CORE_MEASURED; anything else degrades to the
 * honest browser-local simulation, labelled as such. The old fabricated
 * skill-state numbers are gone.
 */
export default function LearnerPage() {
  return (
    <Suspense fallback={null}>
      <RequireAuth>
        <LearnerClient />
      </RequireAuth>
    </Suspense>
  );
}
