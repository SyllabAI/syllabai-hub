/**
 * Shared display formatters for the teacher console (ported from
 * syllabai-web's lib/format.ts, T-028). Pure presentation helpers — no
 * business rules; every value they render comes from a backend read model.
 */

/** Compact relative time: "just now", "4 min ago", "3 h ago", "2 d ago". */
export function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Humanize a backend enum-ish reason code: DECAY_CROSSED_THRESHOLD → "decay crossed threshold". */
export function humanizeCode(code: string): string {
  return code
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .join(" ");
}

/** Future-facing compact relative time (ported from syllabai-web's
 *  lib/format.ts): "due in 2 d" / "due in 3 h" / "due in 45 min", or
 *  "overdue · 2 d" once the instant has passed. */
export function formatDue(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const absDays = Math.abs(ms) / 86_400_000;
  const unit =
    absDays >= 1
      ? `${Math.floor(absDays)} d`
      : absDays * 24 >= 1
        ? `${Math.floor(absDays * 24)} h`
        : `${Math.max(1, Math.floor(absDays * 60))} min`;
  return ms < 0 ? `overdue · ${unit}` : `due in ${unit}`;
}

/**
 * Percent display helpers (UX audit 2026-10-02 #17).
 *
 * Before these the dashboard formatted sub-1% values with a decimal
 * ("0.4%") while progress-ring / strengths-panel Math.rounded the same
 * signal — a learner's first engagement read as "0%" everywhere but the
 * dashboard. Every percent display now goes through one function.
 */

/**
 * Percent for display: whole numbers round; fractions below 1% keep one
 * decimal so the first completed item is visible immediately instead of
 * reading as "0%".
 */
export function formatPercent(percent: number): string {
  if (percent <= 0) return "0%";
  return percent >= 1 ? `${Math.round(percent)}%` : `${percent.toFixed(1)}%`;
}

/**
 * Percent for storage/computation: one-decimal precision — enough for the
 * display contract above, immune to float drift (0.30000000000000004).
 */
export function roundPercent(percent: number): number {
  return Math.round(percent * 10) / 10;
}
