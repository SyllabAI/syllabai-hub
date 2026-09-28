import { Suspense } from "react";
import type { Metadata } from "next";
import { RequireAuth } from "@/components/auth/require-auth";
import { TutorChat } from "./chat";

export const metadata: Metadata = { title: "Tutor — SyllabAI" };

export default function TutorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center text-sm text-muted-foreground">
          Loading tutor…
        </div>
      }
    >
      <RequireAuth>
        <TutorChat />
      </RequireAuth>
    </Suspense>
  );
}
