/**
 * Learning Hub chrome — breadcrumb trail, exam-code pill, and framework tags.
 * Presentational only (server-safe); mirrors the SME header anatomy
 * (research §4): breadcrumb + exam-code pill + bold qualification title.
 */
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex flex-wrap items-center gap-1 text-[13px]", className)}>
      <Link
        href="/"
        className="-ml-1 inline-flex min-h-9 min-w-9 items-center justify-center gap-1 rounded-md px-1 py-2 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Home className="size-4" aria-hidden />
        <span className="sr-only sm:not-sr-only">Home</span>
      </Link>
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="inline-flex items-center gap-1">
          {/* /80: /50 measured 1.96:1 (P3-13) — decorative but needlessly faint */}
          <span aria-hidden className="text-muted-foreground/80">/</span>
          {c.href && i < items.length - 1 ? (
            <Link
              href={c.href}
              className="inline-flex min-h-9 items-center py-2 text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              {c.label}
            </Link>
          ) : (
            <span className={i === items.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"}>
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** "Exam code: 4CH1" pill (SME anatomy, research §4). */
export function ExamCodePill({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border bg-muted/50 px-3 py-1.5 text-[13px]",
        className,
      )}
    >
      <span className="font-semibold text-foreground">Exam code:</span>
      <span className="font-mono text-muted-foreground">{code}</span>
    </span>
  );
}

/** Framework tags on hub resource cards (Edexcel / IGCSE / 4CH1). */
export function FrameworkTags({ tags }: { tags: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="rounded border border-primary/25 bg-primary/5 px-1.5 py-0.5 text-[10.5px] font-medium text-primary"
        >
          {t}
        </span>
      ))}
    </span>
  );
}

/**
 * Framework tag chip — SME's Study / Practice / Diagnose pills (Task 21-b,
 * dissected from the reference course page). Colors live in globals.css
 * (chip-study / chip-practice / chip-diagnose).
 */
export function TagChip({ tag }: { tag: "Study" | "Practice" | "Diagnose" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-none",
        `chip-${tag.toLowerCase()}`,
      )}
    >
      {tag}
    </span>
  );
}

/** Numbered syllabus label, e.g. topic "1. Principles of chemistry". */
export function NumberedLabel({ number, title }: { number: number; title: string }) {
  return (
    <span>
      <span className="font-semibold">{number}.</span> {title}
    </span>
  );
}

export function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <ChevronRight
      aria-hidden
      className={cn(
        "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
        open && "rotate-90",
      )}
    />
  );
}
