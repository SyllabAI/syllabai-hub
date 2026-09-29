"use client";

/**
 * CLA panel form preference — SME chat-widget parity (HUB-CLA-POPUP).
 *
 * SME's assistant opens as a floating popup (fixed bottom-right, 410×640,
 * rounded, shadowed, no backdrop) and can be expanded into a docked
 * full-height right sidebar; the choice persists. This module is the hub's
 * shared preference for that choice across the CLA panels (the note island
 * and the question overlay ride ONE preference, like SME's single widget).
 *
 * Hydration-safe by construction (the wave-3c lesson: a pref read during
 * first render SSRs a value the client may not agree with → React #418).
 * useSyncExternalStore's server snapshot is the default ("popup"); the
 * client snapshot reads localStorage only after hydration, and cross-tab
 * changes arrive via the storage event.
 */

import { useSyncExternalStore } from "react";

export type ClaPanelForm = "popup" | "sidebar";

/** SME's circle header-button anatomy (ButtonIcon_circle, extra-small) —
 *  shared by both CLA panels' shells. */
export const claHeaderCircleBtn =
  "flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

const KEY = "syllabai.cla.panel";
export const DEFAULT_CLA_PANEL_FORM: ClaPanelForm = "popup";

function readForm(): ClaPanelForm {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === "sidebar" ? "sidebar" : "popup";
  } catch {
    return DEFAULT_CLA_PANEL_FORM;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

/** The stored form, live across tabs; "popup" on the server. */
export function useClaPanelForm(): [ClaPanelForm, (next: ClaPanelForm) => void] {
  const form = useSyncExternalStore(
    subscribe,
    readForm,
    () => DEFAULT_CLA_PANEL_FORM,
  );
  const setForm = (next: ClaPanelForm) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* private mode — session-only */
    }
    // same-tab change: the storage event does not fire in the writing tab
    window.dispatchEvent(new Event("storage"));
  };
  return [form, setForm];
}

/**
 * Desktop gate for the popup form — below lg the panels always render the
 * Sheet's full-height overlay (SME's mobile behaviour: a page wash under a
 * fullscreen-ish chat, never a 410px floating window on a phone).
 */
const QUERY = "(min-width: 1024px)";

function subscribeMedia(cb: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeMedia,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
