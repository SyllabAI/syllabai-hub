import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Validation-status badge with the canonical enum's semantics (never "promoted"). */
export function ValidationBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const map: Record<string, string> = {
    VALIDATED: "border-success/30 bg-success/10 text-success",
    SUGGESTED: "border-warn/30 bg-warn/10 text-warn",
    FLAGGED: "border-destructive/30 bg-destructive/10 text-destructive",
    REJECTED: "border-destructive/30 bg-destructive/10 text-destructive",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px]", map[status])}>
      {status}
    </Badge>
  );
}

/** Provenance-tier badge — AI_SUGGESTED is never displayed as truth. */
export function ProvenanceBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null;
  const map: Record<string, string> = {
    RULE_DERIVED: "border-info/30 bg-info/10 text-info",
    AI_SUGGESTED: "border-warn/30 bg-warn/10 text-warn",
    HUMAN_VALIDATED: "border-success/30 bg-success/10 text-success",
    DEMO_DERIVED: "border-cat/30 bg-cat/10 text-cat",
    SIMULATED: "border-sim/30 bg-sim/10 text-sim",
    /** measured facts read live from the learner's syllabai-core account */
    CORE_MEASURED: "border-success/30 bg-success/10 text-success",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px]", map[tier] ?? "text-muted-foreground")}>
      {tier}
    </Badge>
  );
}

/** Canonical spec-point anchor chip (e.g. 4CH1-1.25). */
export function SpecChip({ code }: { code: string }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">
      {code}
    </code>
  );
}

/** Persistent banner for simulated (non-governed) surfaces. */
export function SimulatedBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-sim/30 bg-sim/10 px-3 py-2 text-xs text-sim">
      <Badge variant="outline" className="shrink-0 border-sim/40 text-[10px] text-sim">
        SIMULATED
      </Badge>
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}
