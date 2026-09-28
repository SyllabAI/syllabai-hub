"use client";

/**
 * Session identity — core-auth-backed (promotion ADR-029).
 *
 * The Hub authenticates against syllabai-core's AuthController. `@/lib/api`
 * owns the session (localStorage "syllabai.token" + "syllabai.user", written
 * by setSession after login/register); this store derives the role-aware
 * identity surface from it so role-aware surfaces (dashboard greeting,
 * teacher workspace, app shell account menu) keep one simple API.
 *
 * Role mapping: core issues role strings on UserView.roles — TEACHER/ADMIN
 * map to the "teacher" workspace role, everything else is a student.
 *
 * Same store pattern as my-subjects.ts / theme-store.ts: module store +
 * useSyncExternalStore, referentially-stable snapshot, custom event for
 * same-tab reactivity + storage event for cross-tab. It also follows the
 * api client's `syllabai:session-expired` event so a 401 anywhere signs
 * the identity surface out in place.
 */
import { useSyncExternalStore } from "react";
import { clearSession, currentUser, getToken } from "@/lib/api";

export type Role = "student" | "teacher";

export interface Identity {
  role: Role;
  name: string;
  email: string;
  signedInAt: string;
}

const IDENTITY_EVENT = "syllabai:identity-changed";
const SESSION_EXPIRED_EVENT = "syllabai:session-expired";

export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local.replace(/[._\-+]+/g, " ").trim();
  if (!cleaned) return "there";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Signed-in identity derived from the core session; null when signed out. */
function readIdentity(): Identity | null {
  if (typeof window === "undefined") return null;
  const token = getToken();
  const user = currentUser();
  if (!token || !user) return null;
  return {
    role:
      user.roles.some((r) => r === "TEACHER" || r === "ADMIN") ? "teacher" : "student",
    email: user.email,
    name: user.displayName?.trim() ? user.displayName.trim() : nameFromEmail(user.email),
    signedInAt: new Date().toISOString(),
  };
}

// getSnapshot must return a referentially stable value between store changes
let snapshot: Identity | null = null;

function getSnapshot(): Identity | null {
  const next = readIdentity();
  const changed =
    (next === null) !== (snapshot === null) ||
    (next !== null &&
      snapshot !== null &&
      (next.email !== snapshot.email || next.role !== snapshot.role));
  if (changed) snapshot = next;
  return snapshot;
}

function getServerSnapshot(): Identity | null {
  return null;
}

function subscribe(onChange: () => void) {
  window.addEventListener(IDENTITY_EVENT, onChange);
  window.addEventListener("storage", onChange);
  // a 401 on any core call clears the session — mirror it on the identity
  // surface so the shell flips back to "Sign in" without a reload
  window.addEventListener(SESSION_EXPIRED_EVENT, onChange);
  return () => {
    window.removeEventListener(IDENTITY_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SESSION_EXPIRED_EVENT, onChange);
  };
}

/**
 * Announce a session change (same tab). Call after api.setSession(...) on
 * login/register — cross-tab updates arrive via the storage event.
 */
export function announceSessionChange(): void {
  window.dispatchEvent(new CustomEvent(IDENTITY_EVENT));
}

/** Sign out: clear the core session and notify every identity consumer. */
export function clearIdentity(): void {
  clearSession();
  snapshot = null;
  window.dispatchEvent(new CustomEvent(IDENTITY_EVENT));
}

/** Reactive identity for role-aware surfaces. `null` until hydration + when signed out. */
export function useIdentity(): Identity | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  teacher: "Teacher",
};
