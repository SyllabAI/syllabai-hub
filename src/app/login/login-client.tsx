"use client";

/**
 * Sign-in / registration — real core auth (promotion ADR-029).
 *
 * The split-screen card keeps the demo's role-story panel (Student /
 * Teacher marketing stories); credentials now hit syllabai-core's
 * AuthController via the api client (login + register). In LOGIN mode the
 * role selector is a story switcher only — the actual role arrives from
 * the server on the user record, and routing follows it: TEACHER/ADMIN →
 * /teacher, everyone else → /dashboard. In REGISTER mode the teacher
 * story is a REAL request: core honours role=TEACHER only with the
 * platform's teacher join code (fail-closed — a wrong code and an unset
 * code are the same 403), so the field below only appears there.
 *
 * Browsing without an account stays possible: every resource surface
 * (notes, questions, flashcards, past papers) is public; only the
 * core-backed surfaces (tutor, assistant, progress, teacher tools) need
 * a session.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Atom,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  FileQuestion,
  GraduationCap,
  Loader2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api, setSession, wakeBackend } from "@/lib/api";
import { announceSessionChange, useIdentity, type Role } from "@/lib/identity";

const ROLE_STORY: Record<
  Role,
  { heading: string; sub: string; bullets: { icon: typeof BookOpen; text: string }[] }
> = {
  student: {
    heading: "Revision that knows the spec.",
    sub: "Every note, question and hint is grounded in the Edexcel syllabus.",
    bullets: [
      { icon: BookOpen, text: "Spec-grounded revision notes for 49 courses" },
      { icon: FileQuestion, text: "Exam-style questions with self-marking" },
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

function nextDestination(search: URLSearchParams, isTeacher: boolean): string {
  const next = search.get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return isTeacher ? "/teacher" : "/dashboard";
}

export function LoginClient() {
  const router = useRouter();
  const search = useSearchParams();
  const identity = useIdentity();
  const initialRole: Role = search.get("mode") === "teacher" ? "teacher" : "student";
  const [roleOverride, setRoleOverride] = useState<Role | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const [typedPassword, setTypedPassword] = useState("");
  const [typedName, setTypedName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const role: Role = roleOverride ?? identity?.role ?? initialRole;
  const email = typedEmail ?? identity?.email ?? "";
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // wake the Render-hosted core while the human types — one unauthenticated
  // health request per browser session (see api.ts for the ToS rationale)
  useEffect(() => {
    wakeBackend();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    if (typedPassword.length < 8) {
      setError(mode === "register" ? "Choose a password of at least 8 characters." : "Enter your password.");
      return;
    }
    if (mode === "register" && typedName.trim().length < 2) {
      setError("Tell us your name — it personalises your dashboard.");
      return;
    }
    if (mode === "register" && role === "teacher" && !joinCode.trim()) {
      setError("Teacher accounts need the join code — ask your school's SyllabAI administrator.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const auth =
        mode === "login"
          ? await api.login(trimmed, typedPassword)
          : await api.register(
              trimmed,
              typedPassword,
              typedName.trim(),
              role === "teacher"
                ? { role: "TEACHER", joinCode: joinCode.trim() }
                : undefined,
            );
      setSession(auth);
      announceSessionChange();
      const isTeacher = auth.user.roles.some((r) => r === "TEACHER" || r === "ADMIN");
      router.push(nextDestination(search, isTeacher));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sign-in failed";
      setError(
        /401|credentials|password|unauthor/i.test(message)
          ? mode === "login"
            ? "That email and password combination didn't match. Check both and try again."
            : message
          : message,
      );
    } finally {
      setSubmitting(false);
    }
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
          <span className="font-display font-semibold tracking-tight">SyllabAI Hub</span>
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
          <p>Grounded AI, honest citations, spec-anchored everything.</p>
        </div>
      </div>

      {/* form panel */}
      <div className="flex flex-col justify-center p-6 sm:p-10">
        {/* mobile-only brand row (the desktop brand panel is hidden) */}
        <div className="mb-6 flex items-center gap-2 lg:hidden">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Atom className="size-4" aria-hidden />
          </span>
          <span className="font-display font-semibold tracking-tight">SyllabAI Hub</span>
        </div>

        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {mode === "login" ? "Sign in" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "login"
            ? "Your tutor, assistant and progress live on your account."
            : role === "teacher"
              ? "A teacher account opens the workspace — assignments, cohort mastery and content validation."
              : "A student account gets you the tutor, assistant and progress tracking."}
        </p>

        {/* P3-7 (hub UI audit): say so explicitly — the pre-filled email and
            the header identity chip were the only signals that a session
            already exists. Renders after hydration (useIdentity's server
            snapshot is null), so there is no mismatch. */}
        {identity && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <p className="min-w-0 text-muted-foreground">
              Signed in as{" "}
              <span className="font-medium text-foreground">{identity.email}</span>.
            </p>
            <Link
              href={identity.role === "teacher" ? "/teacher" : "/dashboard"}
              className="text-xs font-medium underline underline-offset-2"
            >
              {identity.role === "teacher" ? "Open the teacher workspace" : "Go to my dashboard"}
            </Link>
          </div>
        )}

        {/* role story split (student / teacher views) */}
        <div
          role="group"
          aria-label="Preview your mode"
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
          {mode === "register" && (
            <div className="space-y-2">
              <Label htmlFor="login-name">Name</Label>
              <Input
                id="login-name"
                type="text"
                autoComplete="name"
                placeholder="Ayesha Rahman"
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder={role === "teacher" ? "you@school.edu" : "you@student.school.edu"}
              value={email}
              onChange={(event) => setTypedEmail(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-password">Password</Label>
              <span
                className="cursor-not-allowed text-xs text-muted-foreground/60"
                aria-disabled="true"
                tabIndex={0}
                title="Self-service password reset isn't available in the pilot — ask your teacher or administrator to reset it."
              >
                Forgot password?
              </span>
            </div>
            <Input
              id="login-password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="••••••••"
              value={typedPassword}
              onChange={(event) => setTypedPassword(event.target.value)}
            />
          </div>

          {mode === "register" && role === "teacher" && (
            <div className="space-y-2">
              <Label htmlFor="login-join-code">Teacher join code</Label>
              <Input
                id="login-join-code"
                type="password"
                autoComplete="off"
                placeholder="From your school's SyllabAI administrator"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Teacher self-registration is gated by a shared join code — the
                server refuses a wrong one with the same answer as a missing one.
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting} className="w-full gap-2">
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {mode === "login" ? "Signing in…" : "Creating account…"}
              </>
            ) : (
              <>{mode === "login" ? "Sign in" : "Create account"}</>
            )}
          </Button>
        </form>

        <p className="mt-5 text-sm text-muted-foreground">
          {mode === "login" ? "New to SyllabAI? " : "Already registered? "}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-2"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login"
              ? role === "teacher"
                ? "Create a teacher account"
                : "Create a student account"
              : "Sign in"}
          </button>
        </p>

        <p className="mt-4 text-sm text-muted-foreground">
          Just exploring?{" "}
          <Link
            href="/dashboard"
            className="inline-block whitespace-nowrap font-medium text-foreground underline underline-offset-2"
          >
            Browse without an account →
          </Link>
        </p>
      </div>
    </div>
  );
}
