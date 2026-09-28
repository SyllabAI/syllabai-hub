"use client";

/**
 * RequireAuth — client-side route gate for session-bound surfaces
 * (promotion ADR-029: /tutor, /assistant, /learner and the /teacher
 * workspace are core-backed and need a signed-in learner).
 *
 * This is a UX affordance, never authorization: the core service enforces
 * authentication + RBAC server-side on every call (the JWT travels with
 * each request); nothing protected is rendered from data the browser
 * already holds. Signed-out visitors get a friendly sign-in prompt that
 * preserves where they were heading.
 */
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LogIn, Loader2, ShieldAlert, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIdentity } from "@/lib/identity";

const noopSubscribe = () => () => {};

/** Hydration flag without setState-in-effect: false on the server + first
 *  hydration render, true on every settled client render. */
function useSettled(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function RequireAuth({
  children,
  role,
}: {
  children: React.ReactNode;
  /** When set, the surface additionally requires this workspace role. */
  role?: "teacher";
}) {
  const identity = useIdentity();
  // settle after hydration: useIdentity hydrates with the server snapshot
  // (null), then flips to the real client value. Until then a quiet loader
  // avoids both the blank-forever bug and a sign-in flash for signed-in
  // users.
  if (!useSettled()) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" aria-hidden>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (identity === null) {
    return <SignInPrompt role={role} />;
  }

  if (role === "teacher" && identity.role !== "teacher") {
    return <TeacherRolePrompt />;
  }

  return <>{children}</>;
}

function SignInPrompt({ role }: { role?: "teacher" }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const loginParams = new URLSearchParams();
  if (role === "teacher") loginParams.set("mode", "teacher");
  // P2-4 (hub UI audit): preserve the full location (path + query). The old
  // query-only "next" never started with "/", so nextDestination() always
  // fell back to the dashboard and the docstring's "preserves where they
  // were heading" promise was dead code. nextDestination() decodes and
  // re-validates the value (must start with "/", not "//"), so encoding is
  // safe. SignInPrompt renders client-only (behind useSettled), so
  // usePathname is always the real location here.
  const qs = params.toString();
  loginParams.set("next", `${pathname}${qs ? `?${qs}` : ""}`);
  const suffix = loginParams.toString();
  const href = `/login${suffix ? `?${suffix}` : ""}`;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <LogIn className="size-5" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Sign in to continue</h1>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          {role === "teacher"
            ? "The teacher workspace needs a teacher account — it reads live cohort data from the SyllabAI backend."
            : "This surface talks to the SyllabAI backend — your tutor answers, assistant and progress are tied to your account."}
        </p>
      </div>
      <Button asChild className="gap-2">
        <Link href={href}>
          <LogIn className="size-4" aria-hidden />
          Sign in
        </Link>
      </Button>
      <p className="text-xs text-muted-foreground">
        Just browsing?{" "}
        <Link href="/courses" className="underline underline-offset-2">
          Explore the course hubs
        </Link>{" "}
        — notes, questions and flashcards stay open.
      </p>
    </div>
  );
}

function TeacherRolePrompt() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-muted">
        <ShieldAlert className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Teacher account required</h1>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          You are signed in as a student. Teacher tools are available on school accounts with the
          teacher role — ask your administrator if you need access.
        </p>
      </div>
      <Button asChild variant="outline" className="gap-2">
        <Link href="/dashboard">
          <GraduationCap className="size-4" aria-hidden />
          Back to my dashboard
        </Link>
      </Button>
    </div>
  );
}
