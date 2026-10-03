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
