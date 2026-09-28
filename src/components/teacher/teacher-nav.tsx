"use client";

/**
 * Teacher sub-navigation (teacher-console tranche, 2026-09-28) — the teacher
 * workspace keeps the demo's no-global-sidebar chrome: one compact tab strip
 * shared by the teacher routes. The two LIVE console surfaces ported from
 * syllabai-web (Marking review, Class intelligence — real core data, RBAC on
 * every call) come first; the corpus-local tools follow, honestly labeled.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  LayoutDashboard,
  ListChecks,
  Network,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdentity } from "@/lib/identity";

const TABS = [
  { href: "/teacher", label: "Overview", icon: LayoutDashboard },
  { href: "/teacher/marking", label: "Marking review", icon: ClipboardCheck },
  { href: "/teacher/class", label: "Class intelligence", icon: Network },
  { href: "/teacher/test-builder", label: "Test Builder", icon: ClipboardList },
  { href: "/teacher/assignments", label: "Assignments", icon: ListChecks },
  { href: "/teacher/validation", label: "Validation", icon: FileCheck2 },
] as const;

export function TeacherNav() {
  const pathname = usePathname();
  const identity = useIdentity();

  return (
    <div className="space-y-3">
      <nav
        aria-label="Teacher workspace"
        className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1 print:hidden"
      >
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <tab.icon className="size-4" aria-hidden />
              {tab.label}
            </Link>
          );
        })}
        <span className="ml-auto flex items-center gap-2 pr-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden />
          {identity ? (
            <span>
              {identity.name} · <span className="font-medium">{identity.role}</span>
            </span>
          ) : (
            <Link href="/login" className="underline underline-offset-2 hover:text-foreground">
              Sign in as a teacher
            </Link>
          )}
        </span>
      </nav>
      {identity && identity.role !== "teacher" && (
        <p className="text-xs text-muted-foreground">
          You are signed in as a <strong>{identity.role}</strong> — these surfaces are the teacher
          mode.{" "}
          <Link href="/login" className="underline underline-offset-2">
            Switch role
          </Link>
        </p>
      )}
    </div>
  );
}
