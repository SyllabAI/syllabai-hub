"use client";

/**
 * attempt-bridge — client half of the 4CH1 question identity bridge
 * (ADR-029 tranche 4).
 *
 * The question player renders the SME-parity corpus and records honest local
 * progress (rings, self-scores — the "simulated" overlay). When the course is
 * the pilot AND the learner is signed in AND core is reachable, this hook
 * additionally resolves each corpus question to its syllabai-core identity
 * (server-side join in /api/core/questions), so every answer also becomes a
 * REAL attempt on the learner's core account — feeding Smart Mark, the
 * learner model, mastery decay, the review queue and attempt history.
 *
 * Honesty rules:
 *   - every negative (not pilot / signed out / core down / question skipped
 *     by the join) degrades to the local experience — nothing blocks, no
 *     spinner-trap, the player says what is and isn't being recorded;
 *   - a question the server join could not verify is NEVER submitted to core
 *     (a wrong-id submission would be fabricated evidence);
 *   - the hook refreshes when a successful submission anywhere in the app
 *     fires the `syllabai:core-evidence` event, so the KG / My State
 *     surfaces re-derive from core promptly.
 */
import { useCallback, useEffect, useState } from "react";
import { getToken } from "./api";

export interface BridgeMcqPart {
  questionId: string;
  options: Record<string, string>;
}

export interface BridgeStructuredSubmission {
  questionId: string;
  parts: Record<string, string>;
}

export interface BridgeQuestion {
  familyKey: string;
  marks: number;
  mcq: Record<string, BridgeMcqPart>;
  structured: BridgeStructuredSubmission[];
}

export interface AttemptBridgeData {
  course: string;
  code: string;
  rootId: string;
  questions: Record<string, BridgeQuestion>;
  skipped: string[];
}

export type AttemptBridgeStatus =
  | { kind: "loading" }
  | { kind: "off" } // not the pilot course — nothing to say
  | { kind: "unauthenticated" }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; data: AttemptBridgeData };

interface RouteResponse {
  available: boolean;
  reason?: string;
  course?: string;
  code?: string;
  rootId?: string;
  topicSlug?: string;
  questions?: Record<string, BridgeQuestion>;
  skipped?: string[];
}

// module-level memo: one fetch per (course, topicSlug) per session — the
// join is deploy-immutable, and repeat navigation between topic pages
// shouldn't re-pay it
const memo = new Map<string, Promise<RouteResponse>>();
/** session flag: this browser already knows the pilot course (avoids a
 *  per-topic round trip just to learn "not_pilot") */
let notPilotCourses = new Set<string>();

export function coreEvidenceChanged(): void {
  window.dispatchEvent(new CustomEvent("syllabai:core-evidence"));
}

/** Which hub course is the live pilot, resolved once per session (memoized —
 *  every core-wiring consumer asks the same question). */
const pilotInfoCache = new Map<string, Promise<{ rootId: string; code: string } | null>>();

export function fetchPilotInfo(
  course: string,
): Promise<{ rootId: string; code: string } | null> {
  const hit = pilotInfoCache.get(course);
  if (hit) return hit;
  const token = getToken();
  const promise = token
    ? fetch(`/api/core/questions?course=${encodeURIComponent(course)}`, {
        headers: { Authorization: `Bearer ${token}` } as Record<string, string>,
      })
        .then((r) => r.json() as Promise<RouteResponse>)
        .then((j) =>
          j.available && j.rootId && j.code ? { rootId: j.rootId, code: j.code } : null,
        )
        .catch(() => null)
    : Promise.resolve(null);
  pilotInfoCache.set(course, promise);
  return promise;
}

export function useAttemptBridge(course: string, topicSlug: string): AttemptBridgeStatus {
  const [status, setStatus] = useState<AttemptBridgeStatus>({ kind: "loading" });

  const load = useCallback(() => {
    if (notPilotCourses.has(course)) {
      setStatus({ kind: "off" });
      return;
    }
    const token = getToken();
    if (!token) {
      setStatus({ kind: "unauthenticated" });
      return;
    }
    const key = `${course}::${topicSlug}`;
    let promise = memo.get(key);
    if (!promise) {
      promise = fetch(
        `/api/core/questions?course=${encodeURIComponent(course)}&topicSlug=${encodeURIComponent(topicSlug)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
        .then((r) => r.json() as Promise<RouteResponse>)
        .catch((): RouteResponse => ({ available: false, reason: "network" }));
      memo.set(key, promise);
    }
    promise.then((j) => {
      if (!j.available) {
        if (j.reason === "not_pilot") {
          notPilotCourses.add(course);
          setStatus({ kind: "off" });
        } else if (j.reason === "unauthenticated") {
          setStatus({ kind: "unauthenticated" });
        } else {
          setStatus({ kind: "unavailable", reason: j.reason ?? "unknown" });
        }
        return;
      }
      setStatus({
        kind: "ready",
        data: {
          course,
          code: j.code ?? "",
          rootId: j.rootId ?? "",
          questions: j.questions ?? {},
          skipped: j.skipped ?? [],
        },
      });
    });
  }, [course, topicSlug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time short-circuits (signed-out / already-known non-pilot) read module state and settle synchronously by design; every network outcome lands in .then. Same class as the f041237 chat-boot disable.
    load();
  }, [load]);

  // a successful submission elsewhere (this tab) may flip availability state
  // (e.g. login) — re-evaluate on the core-evidence event
  useEffect(() => {
    const handler = () => load();
    window.addEventListener("syllabai:core-evidence", handler);
    window.addEventListener("syllabai:identity-changed", handler);
    window.addEventListener("syllabai:session-expired", handler);
    return () => {
      window.removeEventListener("syllabai:core-evidence", handler);
      window.removeEventListener("syllabai:identity-changed", handler);
      window.removeEventListener("syllabai:session-expired", handler);
    };
  }, [load]);

  return status;
}

/** Drop memoized joins + pilot info (e.g. after login/logout the token changed). */
export function resetAttemptBridge(): void {
  memo.clear();
  pilotInfoCache.clear();
  notPilotCourses = new Set();
}
