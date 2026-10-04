"use client";

/**
 * Teacher sub-navigation (teacher-console tranche, 2026-09-28) — the teacher
 * workspace keeps the demo's no-global-sidebar chrome: one compact tab strip
 * shared by the teacher routes. The two LIVE console surfaces ported from
 * syllabai-web (Marking review, Class insights — real core data, RBAC on
 * every call) come first; the corpus-local tools follow, honestly labeled.
 */
import { useEffect, useRef, useState } from "react";
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
  Users,
  Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdentity } from "@/lib/identity";

const TABS = [
  { href: "/teacher", label: "Overview", icon: LayoutDashboard },
  { href: "/teacher/marking", label: "Marking review", icon: ClipboardCheck },
  { href: "/teacher/classes", label: "Classes", icon: Users },
  // UX audit 2026-10-02 #19: "Classes" / "Class intelligence" / "Class graph
  // (sim)" read as three near-identical tabs over two data models — distinct
  // names now: the roster, its evidence views, and the demo-cohort lens.
  { href: "/teacher/class", label: "Class insights", icon: Network },
  // demo-lens port from the demo shell — SAMPLE cohort, disclosed on-page
  { href: "/teacher/class-graph", label: "Class graph (demo)", icon: Waypoints },
  { href: "/teacher/test-builder", label: "Test Builder", icon: ClipboardList },
  { href: "/teacher/assignments", label: "Assignments", icon: ListChecks },
  { href: "/teacher/validation", label: "Validation", icon: FileCheck2 },
] as const;

export function TeacherNav() {
  const pathname = usePathname();
  const identity = useIdentity();
  const navRef = useRef<HTMLElement | null>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // P3-9 (hub UI audit): the strip scrolls horizontally on narrow screens and
  // used to truncate mid-word ("Clas…") with no hint. The trailing fade
  // renders only while there is actually more to scroll — re-checked on
  // scroll and on resize (ResizeObserver covers viewport changes).
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () =>
      setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative">
        <nav
          ref={navRef}
          aria-label="Teacher workspace"
          className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1 print:hidden"
        >
        {TABS.map((tab) => {
          // exact match for most tabs; the Classes workspace keeps its detail
          // routes (/teacher/classes/[id]) highlighted under the same tab
          const active =
            pathname === tab.href ||
            (tab.href === "/teacher/classes" && pathname.startsWith("/teacher/classes/"));
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
        {/* trailing scroll affordance (P3-9): invisible once fully scrolled */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-1 right-1 w-8 rounded-md bg-gradient-to-l from-card to-transparent transition-opacity duration-200",
            canScrollRight ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
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
