"use client";

/**
 * AppShell — global chrome, SaveMyExams-style (research §4, flow crawl
 * 2026-09-19): a single header (logo · "Study tools" menu · data-mode
 * badges) and NO global sidebar. SME keeps all global navigation in the
 * header; course surfaces add exactly one course sidebar (course-shell) and
 * resource detail pages add the topic panel (resource-panel). Demo-discipline
 * disclosures and provider badges live in the footer, out of the learner's
 * reading path.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Atom,
  BookOpen,
  BookOpenCheck,

  ChevronDown,
  CircleHelp,
  Database,
  FileQuestion,
  FlaskConical,
  GraduationCap,
  Layers,
  LayoutDashboard,
  LogIn,
  LogOut,
  Network,
  Sparkles,
  User,
  Waypoints,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { clearIdentity, useIdentity } from "@/lib/identity";
import { isImmersiveRoute } from "@/lib/focus-routes";
import { cn } from "@/lib/utils";
import type { PublicConfig } from "@/lib/config";

const TOOLS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, desc: "My subjects" },
  { href: "/courses", label: "Courses", icon: GraduationCap, desc: "All Learning Hubs" },
  { href: "/revision-notes", label: "Revision Notes", icon: BookOpen },
  { href: "/exam-questions", label: "Exam Questions", icon: FileQuestion },
  { href: "/flashcards", label: "Flashcards", icon: CircleHelp },
] as const;

const MORE_TOOLS = [
  { href: "/tutor", label: "AI Tutor", icon: Sparkles },
  { href: "/assistant", label: "Assistant", icon: BookOpenCheck },
  { href: "/practice", label: "Practice", icon: Zap },
  { href: "/knowledge-graph", label: "Knowledge Graph", icon: Network },
  { href: "/graph-explorer", label: "Graph Explorer", icon: Waypoints },
  { href: "/learner", label: "My Progress", icon: User },
  { href: "/experiments", label: "Experiments", icon: FlaskConical },
] as const;

export function AppShell({
  children,
  config,
}: {
  children: React.ReactNode;
  config: PublicConfig;
}) {
  const pathname = usePathname();
  const identity = useIdentity();
  // course pages manage their own horizontal rhythm (course shell + resource
  // panel); the graph surfaces are full-bleed (the visualizer canvas wants
  // the whole viewport); the tutor workspace is an immersive app surface
  // (its own rail + header + composer, sized to the viewport); every other
  // page gets the centred content column
  const inCourse = pathname.startsWith("/courses/");
  const inExplorer =
    pathname.startsWith("/graph-explorer") || pathname.startsWith("/knowledge-graph");
  const inTutor = pathname.startsWith("/tutor");
  const bare = inCourse || inExplorer || inTutor;

  return (
    <div className="min-h-screen bg-background">
      {/* solid header (SME parity): a translucent bar lets large H1 text bleed
          through on scroll and reads as a rendering glitch (UX audit 2026-09-19) */}
      <header className="sticky top-0 z-40 border-b bg-background print:hidden">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Atom className="size-4" aria-hidden />
            </span>
            <span className="font-display font-semibold tracking-tight">
              SyllabAI<span className="text-muted-foreground"> Hub</span>
            </span>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
                "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Layers className="size-4 lg:hidden" aria-hidden />
              <span className="hidden lg:inline">Study tools</span>
              <span className="lg:hidden">Menu</span>
              <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Study tools</DropdownMenuLabel>
              {TOOLS.map((t) => (
                <DropdownMenuItem key={t.href} asChild>
                  <Link href={t.href} className="cursor-pointer">
                    <t.icon className="size-4" aria-hidden />
                    <span className="flex-1">{t.label}</span>
                    {"desc" in t && t.desc && (
                      <span className="text-[11px] text-muted-foreground">{t.desc}</span>
                    )}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>More tools</DropdownMenuLabel>
              {MORE_TOOLS.map((t) => (
                <DropdownMenuItem key={t.href} asChild>
                  <Link href={t.href} className="cursor-pointer">
                    <t.icon className="size-4" aria-hidden />
                    <span className="flex-1">{t.label}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="ml-1 hidden text-xs text-muted-foreground xl:inline">
            IGCSE &amp; IAL revision · 4CH1 pilot
          </span>

          {/* SME header parity: persistent primary CTA + session identity
              (core-auth-backed) + dual-theme toggle */}
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            {identity ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                    "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <User className="size-3.5" aria-hidden />
                  <span className="max-w-28 truncate">{identity.name}</span>
                  <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs">
                    {identity.email} · {identity.role === "teacher" ? "Teacher" : "Student"}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard" className="cursor-pointer">
                      <LayoutDashboard className="size-4" aria-hidden />
                      Dashboard
                    </Link>
                  </DropdownMenuItem>
                  {identity.role === "teacher" && (
                    <DropdownMenuItem asChild>
                      <Link href="/teacher" className="cursor-pointer">
                        <GraduationCap className="size-4" aria-hidden />
                        Teacher workspace
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => clearIdentity()} className="cursor-pointer">
                    <LogOut className="size-4" aria-hidden />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button asChild variant="outline" size="sm" className="hidden gap-1.5 sm:inline-flex">
                <Link href="/login">
                  <LogIn className="size-3.5" aria-hidden />
                  Sign in
                </Link>
              </Button>
            )}
            <Button asChild size="sm" className="hidden gap-1.5 sm:inline-flex">
              <Link href="/dashboard">
                <Zap className="size-3.5" aria-hidden />
                Start studying
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* content */}
      <main className={cn("min-w-0 flex-1", !bare && "px-4 py-6 sm:px-6 lg:px-8")}>
        {bare ? children : <div className="mx-auto w-full max-w-6xl">{children}</div>}
      </main>

      {/* footer — provenance lives here, not in the learner path. On
          document-focus routes (paper viewer / player) it is omitted
          entirely: the panes fill the viewport exactly, and a footer below the
          fold would create a pointless 200px page scroll. Immersive app
          surfaces (tutor) omit it for the same viewport reason. */}
      {!isImmersiveRoute(pathname) && (
      <footer className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6 lg:px-8 print:hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-4">
          <ThemeToggle variant="row" />
          <Badge variant="outline" className="gap-1 text-[10px] font-normal">
            <Database className="size-3" aria-hidden />
            {config.dataMode}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            canonical educational truth lives in{" "}
            <span className="font-mono">syllabai-core</span>; everything simulated on this
            surface is labelled <span className="font-mono">SIMULATED</span>; everything
            AI-suggested keeps its provenance.
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          SyllabAI Hub — the SyllabAI product frontend. Canonical semantics:
          <span className="font-mono"> syllabai/syllabai</span> · content:
          <span className="font-mono"> syllabai-resources</span> (pilot-licensed, SME attestation
          2026-09-17).
        </p>
      </footer>
      )}
    </div>
  );
}
