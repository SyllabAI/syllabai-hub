/**
 * Paper Run store — IndexedDB persistence for exam-run drafts (client-only).
 *
 * Design §5.2: answers persist at every transition; the run NEVER depends on
 * the timer callback having executed. A record whose deadline has passed and
 * which was never marked submitted is deterministically recoverable as
 * `time-up-pending-submission` on next load. Runs are local to this browser
 * (same convention as all local learner progress) and GC'd after 30 days.
 */
"use client";

import type { PaperRunRecord, RunPhase } from "@/lib/paper-run/types";

const DB_NAME = "syllabai-paper-run";
const STORE = "runs";
const GC_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "runId" });
        os.createIndex("course", "course", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveRun(record: PaperRunRecord): Promise<void> {
  record.lastSavedAt = new Date().toISOString();
  await tx("readwrite", (s) => s.put(record) as unknown as IDBRequest<void>);
}

export async function loadRun(runId: string): Promise<PaperRunRecord | null> {
  return (await tx("readonly", (s) => s.get(runId) as IDBRequest<PaperRunRecord>)) ?? null;
}

export async function deleteRun(runId: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(runId) as unknown as IDBRequest<void>);
}

/** The most recent non-done run for a course+paper, if any (resume banner). */
export async function findResumableRun(
  course: string,
  corpusKey: string,
): Promise<PaperRunRecord | null> {
  const all = (await tx(
    "readonly",
    (s) => s.getAll() as IDBRequest<PaperRunRecord[]>,
  )) ?? [];
  return (
    all
      .filter(
        (r) =>
          r.course === course &&
          r.corpusKey === corpusKey &&
          (r.phase === "running" || r.phase === "time-up-pending-submission"),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
  );
}

/** Deterministic post-crash phase repair (design §5.2). */
export function recoverPhase(
  record: PaperRunRecord,
  now: Date = new Date(),
): { record: PaperRunRecord; recovered: boolean } {
  if (record.phase !== "running") return { record, recovered: false };
  const deadline =
    new Date(record.startedAt).getTime() + record.durationMin * 60_000;
  if (now.getTime() >= deadline) {
    // the timer callback never got to run — the deadline still did
    const recovered: PaperRunRecord = {
      ...record,
      phase: "time-up-pending-submission",
      timeUpAutoSubmitted: true,
      endedAt: new Date(deadline).toISOString(),
      timeUsedSec: record.durationMin * 60,
    };
    return { record: recovered, recovered: true };
  }
  return { record, recovered: false };
}

/** Set the durable phase (every transition persists — design §5.2). */
export async function transitionPhase(
  record: PaperRunRecord,
  phase: RunPhase,
  patch: Partial<PaperRunRecord> = {},
): Promise<PaperRunRecord> {
  const next: PaperRunRecord = { ...record, ...patch, phase };
  await saveRun(next);
  return next;
}

/** Remove runs older than the GC window (called on store open). */
export async function gcRuns(): Promise<void> {
  const all = (await tx(
    "readonly",
    (s) => s.getAll() as IDBRequest<PaperRunRecord[]>,
  )) ?? [];
  const cutoff = Date.now() - GC_AFTER_MS;
  for (const r of all) {
    if (new Date(r.lastSavedAt).getTime() < cutoff) await deleteRun(r.runId);
  }
}
