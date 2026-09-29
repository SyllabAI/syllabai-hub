"use client";

/**
 * useNow — a wall-clock value that stays honest on long-lived tabs
 * (HUB-DASH-CORE P1, operator trace 1a0ec29c8c8cfb71).
 *
 * Decay-derived surfaces (review-due counts, "overdue by N days" reasons)
 * frozen their clock at mount: a dashboard left open overnight kept ranking
 * against yesterday's numbers. This hook re-reads the clock when new core
 * evidence lands (the surfaces' own invalidation event) and when the tab
 * becomes visible again — the two moments a re-rank is actually observable.
 */
import { useEffect, useState } from "react";

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const bump = () => setNow(Date.now());
    const onVisibility = () => {
      if (document.visibilityState === "visible") bump();
    };
    window.addEventListener("syllabai:core-evidence", bump);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("syllabai:core-evidence", bump);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return now;
}
