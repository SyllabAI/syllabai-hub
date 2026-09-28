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
