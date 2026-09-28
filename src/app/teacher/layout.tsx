import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/require-auth";

/**
 * Teacher workspace layout — the RBAC affordance for every teacher surface.
 * Core enforces TEACHER/ADMIN server-side on each call; this gate keeps the
 * signed-out / student experience honest instead of rendering shells that
 * would 403 on first interaction.
 */
export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
          Loading workspace…
        </div>
      }
    >
      <RequireAuth role="teacher">{children}</RequireAuth>
    </Suspense>
  );
}
