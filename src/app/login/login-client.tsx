"use client";

/**
 * Login mockup — the teacher/student mode split (TEACHER-1).
 *
 * A split-screen auth card: brand panel (left) tells a role-specific story,
 * the form panel (right) carries a Student/Teacher segmented control. There
 * is NO real authentication (docs/TEACHER_MODE_PLAN.md) — submitting any
 * credentials writes a local mock identity (src/lib/identity.ts) and routes
 * to the role's home: student → /dashboard, teacher → /teacher.
 *
 * Demo discipline: the mock nature is disclosed on the card, not hidden.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Atom,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  FileQuestion,
  GraduationCap,
  Info,
  Loader2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { setIdentity, useIdentity, type Role } from "@/lib/identity";

const ROLE_STORY: Record<
  Role,
  { heading: string; sub: string; bullets: { icon: typeof BookOpen; text: string }[] }
> = {
  student: {
    heading: "Revision that knows the spec.",
    sub: "Every note, question and hint is grounded in the Edexcel syllabus.",
    bullets: [
      { icon: BookOpen, text: "Spec-grounded revision notes for 49 courses" },
      { icon: FileQuestion, text: "Exam-style questions with AI marking" },
      { icon: Sparkles, text: "A tutor that cites the syllabus, not vibes" },
    ],
  },
  teacher: {
    heading: "See every learner's gaps.",
    sub: "Cohort mastery, assignments and content validation in one workspace.",
    bullets: [
      { icon: Users, text: "Cohort mastery at a glance — spec-point heatmap" },
      { icon: ClipboardCheck, text: "Assignments and Target Tests in two clicks" },
      { icon: ShieldCheck, text: "Validate AI-generated content before it ships" },
    ],
  },
};

export function LoginClient() {
  const router = useRouter();
  const identity = useIdentity();
  // role/email derive from the mock identity until the user overrides them —
  // the derive-during-render pattern (no setState-in-effect prefill cascade)
  const [roleOverride, setRoleOverride] = useState<Role | null>(null);
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const [typedPassword, setTypedPassword] = useState("");
  const role: Role = roleOverride ?? identity?.role ?? "student";
  const email = typedEmail ?? identity?.email ?? "";
  const setEmail = setTypedEmail;
  const password = typedPassword;
  const setPassword = setTypedPassword;
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function signIn(asRole: Role, asEmail: string) {
    setSubmitting(true);
    setError(null);
    // simulate a network round-trip so the loading state is visible
    window.setTimeout(() => {
      setIdentity({ role: asRole, email: asEmail });
      router.push(asRole === "teacher" ? "/teacher" : "/dashboard");
    }, 500);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address — any address works in this mockup.");
      return;
    }
    if (password.length === 0) {
      setError("Enter a password — it is not checked in this mockup.");
      return;
    }
    signIn(role, trimmed);
  }

  const story = ROLE_STORY[role];

  return (
    <div className="grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel — solid primary so the split reads instantly; adapts to
          both themes because it uses tokens (SME blue / Quiet Green fern) */}
      <div className="relative hidden flex-col justify-between bg-primary p-8 text-primary-foreground lg:flex xl:p-10">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-white/15">
            <Atom className="size-4" aria-hidden />
          </span>
          <span className="font-display font-semibold tracking-tight">syllabai-demo</span>
        </div>

        {/* role-specific story; key triggers a subtle swap animation */}
        <div key={role} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
          <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
            {story.heading}
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-primary-foreground/80">
            {story.sub}
          </p>
          <ul className="mt-6 space-y-3">
            {story.bullets.map((bullet) => (
              <li key={bullet.text} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-white/15">
                  <bullet.icon className="size-3.5" aria-hidden />
                </span>
                <span className="leading-relaxed text-primary-foreground/90">{bullet.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-1 text-xs text-primary-foreground/70">
          <p className="font-medium">Edexcel IGCSE &amp; IAL · 4CH1 pilot corpus · 49 courses</p>
          <p>Teacher surfaces are planned — see the teacher workspace mockup after signing in.</p>
        </div>
      </div>

      {/* form panel */}
      <div className="flex flex-col justify-center p-6 sm:p-10">
        {/* mobile-only brand row (the desktop brand panel is hidden) */}
        <div className="mb-6 flex items-center gap-2 lg:hidden">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Atom className="size-4" aria-hidden />
          </span>
          <span className="font-display font-semibold tracking-tight">syllabai-demo</span>
        </div>

        <h1 className="font-display text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose your mode, then continue — mockup, no server involved.
        </p>

        {/* role split */}
        <div
          role="group"
          aria-label="Choose your mode"
          className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
        >
          {(
            [
              { id: "student", label: "Student", icon: GraduationCap },
              { id: "teacher", label: "Teacher", icon: ClipboardList },
            ] as const
          ).map((option) => {
            const active = role === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => setRoleOverride(option.id)}
                className={cn(
                  "flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <option.icon className="size-4" aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder={role === "teacher" ? "you@school.edu" : "you@student.school.edu"}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-password">Password</Label>
              <span className="cursor-not-allowed text-xs text-muted-foreground/60" aria-disabled>
                Forgot password?
              </span>
            </div>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting} className="w-full gap-2">
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Signing in…
              </>
            ) : (
              <>Continue as a {role}</>
            )}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          className="w-full gap-2"
          onClick={() => signIn(role, role === "teacher" ? "demo.teacher@syllabai.app" : "demo.student@syllabai.app")}
        >
          Continue with a demo {role} account
        </Button>

        <div className="mt-5 flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Mockup only — nothing is sent to a server and any credentials sign you in locally.
            Real authentication is planned (see the{" "}
            <Link
              href="https://github.com/SyllabAI/syllabai-hub/blob/main/docs/TEACHER_MODE_PLAN.md"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground underline underline-offset-2"
            >
              teacher mode plan
            </Link>
            ).
          </span>
        </div>

        <p className="mt-5 text-sm text-muted-foreground">
          Just exploring?{" "}
          <Link href="/dashboard" className="font-medium text-foreground underline underline-offset-2">
            Skip sign-in and browse the demo →
          </Link>
        </p>
      </div>
    </div>
  );
}
