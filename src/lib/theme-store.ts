"use client";

/**
 * Quad-theme store — SME (default), Quiet Green, Candy Shop and Chat App
 * Plum, each light/dark/system.
 *
 * Persists to localStorage["syllabai-theme"] as
 *   { theme: "sme" | "quiet-green" | "candy-shop" | "chat-app-plum",
 *     mode: "light" | "dark" | "system" }
 * and applies the resolved state to <html> as data-theme + .dark, exactly
 * like the inline no-flash bootstrap in src/app/layout.tsx (same key, same
 * parsing — keep both in sync).
 *
 * Deliberately dependency-free: a module store + useSyncExternalStore in
 * the toggle component. No zustand/next-themes so the app shell stays lean.
 */

export type ThemeName = "sme" | "quiet-green" | "candy-shop" | "chat-app-plum";
export type ThemeMode = "light" | "dark" | "system";

/** Whitelist — unknown stored values fall back to the default theme. */
const THEME_NAMES: readonly ThemeName[] = [
  "sme",
  "quiet-green",
  "candy-shop",
  "chat-app-plum",
];

export interface ThemeState {
  theme: ThemeName;
  mode: ThemeMode;
}

export const THEME_STORAGE_KEY = "syllabai-theme";

const INITIAL: ThemeState = { theme: "sme", mode: "system" };

let state: ThemeState = INITIAL;
const listeners = new Set<() => void>();
let hydrated = false;
let mediaSubscribed = false;

function emit() {
  listeners.forEach((l) => l());
}

function resolveDark(mode: ThemeMode): boolean {
  if (typeof window === "undefined") return false;
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(next: ThemeState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", next.theme);
  const dark = resolveDark(next.mode);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

function persist(next: ThemeState) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode — theme just won't persist */
  }
}

function parseStored(): ThemeState {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return INITIAL;
    const t = JSON.parse(raw) as { theme?: string; mode?: string };
    return {
      theme: THEME_NAMES.includes(t.theme as ThemeName)
        ? (t.theme as ThemeName)
        : "sme",
      mode:
        t.mode === "light" || t.mode === "dark" || t.mode === "system"
          ? t.mode
          : "system",
    };
  } catch {
    return INITIAL;
  }
}

/**
 * Re-reads storage and re-applies after hydration. The inline bootstrap in
 * layout.tsx has already applied the right visuals pre-paint; this makes
 * the React-side store agree with it. Safe to call multiple times.
 */
export function hydrateTheme(): void {
  if (typeof window === "undefined") return;
  state = parseStored();
  apply(state);
  if (!mediaSubscribed) {
    mediaSubscribed = true;
    // live-follow the OS while mode === "system"
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (state.mode === "system") {
          apply(state);
          emit();
        }
      });
  }
  hydrated = true;
  emit();
}

/** React store contract (useSyncExternalStore). */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getThemeState(): ThemeState {
  return state;
}

export function getServerThemeState(): ThemeState {
  // server render + first client render agree on the default; hydration
  // then re-renders if storage says otherwise (no mismatch error)
  return hydrated ? state : INITIAL;
}

export function setTheme(partial: Partial<ThemeState>): void {
  state = { ...state, ...partial };
  persist(state);
  apply(state);
  emit();
}

export const THEME_LABEL: Record<ThemeName, string> = {
  sme: "SME",
  "quiet-green": "Quiet Green",
  "candy-shop": "Candy Shop",
  "chat-app-plum": "Chat App Plum",
};

export const MODE_LABEL: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};
