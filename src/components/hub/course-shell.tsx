"use client";

/**
 * CourseShell — the persistent per-course chrome (SME model, research §4):
 *
 *   - ONE course sidebar (Course / Revision / Exam Practice groups with a
 *     "Hide menu" collapse) on every course surface — hub, indexes, details;
 *   - NO topic tree in the desktop sidebar: the numbered tree lives in the
 *     resource panel (see resource-panel.tsx) which resource DETAIL pages
 *     mount themselves, exactly like SaveMyExams' second column;
 *   - on mobile the tree is reachable from the course drawer instead.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Bookmark,
  CircleHelp,
  Compass,
  FileQuestion,
  Files,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Target,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CourseDataProvider,
  type SidebarData,
  type SidebarVariant,
} from "@/components/hub/course-data-context";
import { TopicTreeWithIndexAuto } from "@/components/hub/topic-tree";
import { isDocumentFocusRoute } from "@/lib/focus-routes";

export type { SidebarData, SidebarVariant } from "@/components/hub/course-data-context";

export function CourseShell({
  data,
  children,
}: {
  data: SidebarData;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const [open, setOpen] = useState(false); // mobile drawer
  const [hidden, setHidden] = useState(false); // desktop collapse ("Hide menu")
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const drawerPanelRef = useRef<HTMLDivElement>(null);

  // Document-focus routes (past-paper viewer / interactive player) collapse
  // the sidebar to the 44px rail automatically — on those screens the PDF is
  // the whole point (user-reported: "such a small viewport for the pdf").
  // Leaving the route restores the prior state, but ONLY if we collapsed it
  // (a manual "Hide menu" by the user is never undone).
  const focusRoute = isDocumentFocusRoute(pathname);
  const autoCollapsedRef = useRef(false);
  useEffect(() => {
    if (focusRoute) {
      if (!autoCollapsedRef.current) {
        autoCollapsedRef.current = true;
        // one-time init sync with the route (auto-collapse on document-focus
        // routes) — ported pattern from the demo; restructure in the
        // hardening tranche if the rule fires on new code
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHidden(true);
      }
    } else if (autoCollapsedRef.current) {
      autoCollapsedRef.current = false;
      setHidden(false);
    }
  }, [focusRoute]);

  // Mobile drawer focus management (UX audit 2026-10-02, P2-8): the dialog
  // had role/aria-modal but keyboard users could Tab straight through into
  // the page behind it, Escape did nothing, and focus never moved in or back
  // out. While open: focus lands on the panel, Tab cycles inside it, Escape
  // closes, background scroll locks; on close, focus returns to the trigger.
  useEffect(() => {
    if (!open) return;
    const panel = drawerPanelRef.current;
    // capture the trigger element now — reading menuBtnRef.current inside the
    // cleanup would race React's ref reassignment (exhaustive-deps rule)
    const menuBtn = menuBtnRef.current;
    if (!panel) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === panel) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      menuBtn?.focus();
    };
  }, [open]);

  const variant: SidebarVariant = useMemo(() => {
    if (pathname.includes("/revision-notes")) return "notes";
    if (pathname.includes("/exam-questions")) return "questions";
    if (pathname.includes("/past-papers") || pathname.includes("/practice-papers")) return "questions";
    if (pathname.includes("/flashcards")) return "flashcards";
    return "hub";
  }, [pathname]);

  const base = `/courses/${data.course.slug}`;

  const navGroups: {
    label: string;
    items: { href: string; label: string; icon: typeof BookOpen; disabled?: boolean; badge?: string; exact?: boolean }[];
  }[] = [
    {
      label: "Course",
      items: [
        { href: base, label: "Course Resources", icon: LayoutDashboard, exact: pathname === base },
        { href: `${base}/strengths`, label: "Strengths & Weaknesses", icon: Compass, exact: pathname === `${base}/strengths` },
      ],
    },
    {
      label: "Revision",
      items: [
        { href: `${base}/revision-notes`, label: "Revision Notes", icon: BookOpen },
        { href: `${base}/flashcards`, label: "Flashcards", icon: CircleHelp },
      ],
    },
    {
      label: "Exam Practice",
      items: [
        { href: `${base}/exam-questions`, label: "Exam Questions", icon: FileQuestion },
        { href: `${base}/exam-questions/saved`, label: "Saved questions", icon: Bookmark, exact: pathname.endsWith("/saved") },
        { href: `${base}/past-papers`, label: "Past Papers", icon: ScrollText, disabled: !data.hasPastPapers && !data.hasCorpusPapers, badge: data.hasPastPapers || data.hasCorpusPapers ? undefined : "roadmap" },
        { href: `${base}/practice-papers`, label: "Practice Papers", icon: Files },
        { href: "#", label: "Target Test", icon: Target, disabled: true, badge: "roadmap" },
      ],
    },
  ];

  // NOTE: the collapsed state renders a dedicated 44px rail (same pattern as
  // resource-panel.tsx) — the "Show menu" affordance must live OUTSIDE the
  // collapsed column; the previous w-0/overflow-hidden collapse swallowed its
  // own re-open button, so the sidebar could never be toggled back open.
  const rail = (
    <aside
      className="sticky top-14 hidden h-[calc(100dvh-3.5rem-1px)] w-11 shrink-0 flex-col items-center border-r bg-background pt-3 lg:flex"
      aria-label="Course navigation"
    >
      <Button
        variant="outline"
        size="icon"
        className="size-9 shadow-xs"
        onClick={() => setHidden(false)}
        aria-label="Show menu"
        title="Show menu"
      >
        <PanelLeftOpen className="size-4" aria-hidden />
      </Button>
    </aside>
  );

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tracking-tight">{data.course.label ?? data.course.subject}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() => setHidden(true)}
        >
          <PanelLeftClose className="size-4" aria-hidden /> Hide menu
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          <nav aria-label="Course sections" className="space-y-4">
            {navGroups.map((g) => (
              <div key={g.label}>
                <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </p>
                <ul className="space-y-0.5">
                  {g.items.map((item) => {
                    const active = item.disabled
                      ? false
                      : (item.exact ?? pathname.startsWith(item.href));
                    const inner = (
                      <>
                        <item.icon className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">{item.label}</span>
                        {item.badge && (
                          <Badge variant="outline" className="ml-auto shrink-0 px-1 text-[10.5px] uppercase text-foreground/70">
                            {item.badge}
                          </Badge>
                        )}
                      </>
                    );
                    return (
                      <li key={item.label}>
                        {item.disabled ? (
                          <span
                            aria-disabled
                            title="Not part of the pilot corpus yet"
                            className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground"
                          >
                            {inner}
                          </span>
                        ) : (
                          <Link
                            href={item.href}
                            onClick={() => setOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              // course-nav-item: QG theme hooks its fern-spine
                              // active treatment on this class (globals.css)
                              "course-nav-item flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                              active
                                ? "bg-primary/10 font-medium text-primary"
                                : "text-foreground/80 hover:bg-muted hover:text-foreground",
                            )}
                          >
                            {inner}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
      </div>
    </div>
  );

  return (
    <CourseDataProvider data={data}>
      {/* course-shell-row: the CLA dock's physical-reflow hook (globals.css,
          HUB-CLA-SIDEBAR) — while a CLA panel is docked open on ≥1400px this
          row cedes 400px on the right, SME's expanded-chat behaviour */}
      <div className="course-shell-row flex min-h-[calc(100dvh-3.5rem-1px)]">
        {/* mobile drawer: nav groups + the resource topic tree */}
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Course menu">
            <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
            <div
              ref={drawerPanelRef}
              tabIndex={-1}
              className="absolute inset-y-14 left-0 w-80 max-w-[85vw] border-r bg-background outline-none"
            >
              <MobileDrawerInner
                data={data}
                variant={variant}
                pathname={pathname}
                onNavigate={() => setOpen(false)}
                navGroups={navGroups}
              />
            </div>
          </div>
        )}

        {/* desktop sidebar — the one and only course sidebar; collapses to a
            slim rail whose "Show menu" button stays reachable */}
        {hidden ? (
          rail
        ) : (
          <aside
            className="sticky top-14 hidden h-[calc(100dvh-3.5rem-1px)] w-64 shrink-0 border-r bg-background lg:block"
            aria-label="Course navigation"
          >
            {sidebar}
          </aside>
        )}

        {/* content column */}
        <div className="min-w-0 flex-1">
          {/* mobile-only drawer trigger bar; the desktop sidebar is toggled
              by the rail icon when collapsed */}
          <div className="sticky top-14 z-30 flex items-center gap-2 border-b bg-background px-3 py-2 lg:hidden">
            <Button
              ref={menuBtnRef}
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2.5"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu className="size-4" aria-hidden /> Menu
            </Button>
            <span className="truncate text-sm font-medium">{data.course.label ?? data.course.subject}</span>
          </div>
          {children}
        </div>
      </div>
    </CourseDataProvider>
  );
}

function MobileDrawerInner({
  data,
  variant,
  pathname,
  onNavigate,
  navGroups,
}: {
  data: SidebarData;
  variant: SidebarVariant;
  pathname: string;
  onNavigate: () => void;
  navGroups: {
    label: string;
    items: { href: string; label: string; icon: typeof BookOpen; disabled?: boolean; badge?: string; exact?: boolean }[];
  }[];
}) {
  const base = `/courses/${data.course.slug}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tracking-tight">{data.course.label ?? data.course.subject}</span>
        <Button variant="ghost" size="icon" className="size-9" onClick={onNavigate} aria-label="Close menu">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <nav aria-label="Course sections" className="space-y-4">
          {navGroups.map((g) => (
            <div key={g.label}>
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {g.label}
              </p>
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const active = item.disabled ? false : (item.exact ?? pathname.startsWith(item.href));
                  const inner = (
                    <>
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <Badge variant="outline" className="ml-auto shrink-0 px-1 text-[10.5px] uppercase text-foreground/70">
                          {item.badge}
                        </Badge>
                      )}
                    </>
                  );
                  return (
                    <li key={item.label}>
                      {item.disabled ? (
                        <span
                          aria-disabled
                          title="Not part of the pilot corpus yet"
                          className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground"
                        >
                          {inner}
                        </span>
                      ) : (
                        <Link
                          href={item.href}
                          onClick={onNavigate}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "course-nav-item flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                            active
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-foreground/80 hover:bg-muted hover:text-foreground",
                          )}
                        >
                          {inner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* resource-flavoured topic tree (mobile navigation). Papers are
            linear documents — the Exam-Questions spec tree is noise on
            past-paper routes, same reasoning as the desktop ResourcePanel. */}
        {!pathname.includes("/past-papers") && (
          <div className="mt-5 border-t pt-4">
            <p className="sr-only">Topics</p>
            {/* Mobile UX audit (2026-09-28) P1: close ONLY on real navigation
                (leaf links / "View all topics"). The old onClickCapture fired
                on the expand/collapse <button>s too — the drawer unmounted,
                TopicTree's expanded state reset on remount, and no topic
                beyond the auto-expanded one could ever be browsed on mobile. */}
            <div
              role="presentation"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) onNavigate();
              }}
            >
              <TopicTreeWithIndexAuto variant={variant} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
