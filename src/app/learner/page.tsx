import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { getDataProvider } from "@/lib/data";
import { LearnerClient } from "./client";

export const dynamic = "force-dynamic";

export default async function LearnerPage() {
  const provider = getDataProvider();
  const state = await provider.simLearnerState();
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <RequireAuth>
        <LearnerClient state={state} />
      </RequireAuth>
    </Suspense>
  );
}
