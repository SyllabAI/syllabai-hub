/**
 * Mock exam results — local SIMULATED overlay (demo discipline).
 *
 * Mocks are graded by the student against the official MS PDF; the tally is
 * stored in this browser only, exactly like the other simulated overlays.
 * Nothing here touches canonical learner state or any server.
 */
"use client";

export interface MockResult {
  /** unique id: `${course}:${sessionId}:${dir}:${startedAt}` */
  id: string;
  course: string;
  /** official paper reference, e.g. "4CH1/1C" */
  ref: string;
  title: string;
  sessionId: string;
  /** ISO date when the mock finished */
  finishedAt: string;
  /** duration the mock was set to (minutes) */
  durationMin: number;
  /** seconds actually used */
  timeUsedSec: number;
  marks: number;
  total: number;
  /** how it ended */
  ended: "time-up" | "self" | "exited";
  /**
   * Optional per-question tally (v2 additive field — older records lack it).
   * `max` is null when the student left the marks-available cell empty.
   */
  questions?: Array<{ label: string; marks: number; max: number | null }>;
  /**
   * Paper Run v3 additive fields (T-C70) — absent on plain mock records.
   * The strip and the storage tolerate both shapes (design §5.5).
   */
  mode?: "run";
  manifestVersion?: number;
  integrity?: "practice";
  durationPolicy?: "OFFICIAL" | "ACCOMMODATED";
  startedAt?: string;
  coverageState?: "full" | "partial";
  marked?: { auto: number; self: number; aiSuggested: number; paperOnly: number };
  perQuestion?: Array<{ number: string; marks: number; max: number; how: string }>;
  coreSubmissions?: { attempted: number; recorded: number; failed: number };
}

const KEY = "syllabai.mockResults.v1";
const MAX_PER_COURSE = 20;

export function loadMockResults(course?: string): MockResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const all: MockResult[] = raw ? (JSON.parse(raw) as MockResult[]) : [];
    return course ? all.filter((r) => r.course === course) : all;
  } catch {
    return [];
  }
}

export function saveMockResult(result: MockResult): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadMockResults();
    const next = [result, ...all.filter((r) => r.id !== result.id)]
      .filter((r) => r.course === result.course)
      .slice(0, MAX_PER_COURSE)
      .concat(loadMockResults().filter((r) => r.course !== result.course));
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full/unavailable — mock result is ephemeral, fine */
  }
}

export function clearMockResults(course: string): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadMockResults();
    window.localStorage.setItem(KEY, JSON.stringify(all.filter((r) => r.course !== course)));
  } catch {
    /* noop */
  }
}

/** "1h 23m" / "45m 12s" style duration label. */
export function formatSpent(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
