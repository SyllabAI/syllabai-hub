"use client";

/**
 * My Classes — the teacher's class containers (HUB-TEACHER-DASH wave 1,
 * operator trace 1a0ec61d5612aa6d: "the dashboard will look like student
 * one, but instead of subject it is a class card. Teacher will add class,
 * then select subjects. Then inside there, all the tools and course
 * resources will exist.").
 *
 * A class is a browser-local container: { id, name, subjectSlugs[],
 * createdAt } — the exact demo-truth class the student's subject roster is
 * (lib/my-subjects.ts, same useSyncExternalStore pattern, same honesty):
 * no auth in the demo, so the roster persists in localStorage under a
 * versioned key and the UI copy says so. The LIVE core class entity
 * (RBAC rosters, /teacher/classes) is a different, database-backed concept
 * — the two never blur: the local class workspace links to the live roster
 * surface, it never impersonates it.
 *
 * Slugs are validated against the course registry at read time by the
 * caller (the dashboard filters unknown slugs out), exactly like
 * my-subjects.
 */
import { useCallback, useSyncExternalStore } from "react";

export const KEY = "syllabai-hub:teacher-classes.v1";
export const MY_CLASSES_EVENT = "syllabai-hub:teacher-classes-changed";

export interface TeacherClass {
  id: string;
  name: string;
  /** registry course slugs, selection order preserved */
  subjectSlugs: string[];
  /** ISO timestamp — set at creation, display-only */
  createdAt: string;
}

const EMPTY: TeacherClass[] = [];

function readClasses(): TeacherClass[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed
      .filter(
        (c): c is TeacherClass =>
          !!c &&
          typeof c === "object" &&
          typeof (c as TeacherClass).id === "string" &&
          typeof (c as TeacherClass).name === "string" &&
          Array.isArray((c as TeacherClass).subjectSlugs),
      )
      .map((c) => ({
        ...c,
        name: c.name.trim() || "Untitled class",
        subjectSlugs: [...new Set(c.subjectSlugs.filter((s): s is string => typeof s === "string" && s.length > 0))],
      }));
  } catch {
    return EMPTY;
  }
}

// getSnapshot must return a referentially stable value between store changes
let snapshot: TeacherClass[] = EMPTY;
function getSnapshot(): TeacherClass[] {
  const next = readClasses();
  if (
    next.length !== snapshot.length ||
    next.some((c, i) => c.id !== snapshot[i].id || c.name !== snapshot[i].name || c.subjectSlugs.join() !== snapshot[i].subjectSlugs.join())
  ) {
    snapshot = next;
  }
  return snapshot;
}
function getServerSnapshot(): TeacherClass[] {
  return EMPTY;
}

function writeClasses(classes: TeacherClass[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(classes));
  } catch {
    // storage full / private mode — the roster just won't persist
  }
  window.dispatchEvent(new CustomEvent(MY_CLASSES_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(MY_CLASSES_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MY_CLASSES_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function makeId(): string {
  try {
    return `local-${crypto.randomUUID()}`;
  } catch {
    // older engines — a timestamp+random id is honest enough for a
    // browser-local container
    return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export interface MyClasses {
  /** classes in creation order */
  classes: TeacherClass[];
  has: (id: string) => boolean;
  get: (id: string) => TeacherClass | undefined;
  /** create a class from a name + selected subject slugs (≥1 subject) */
  add: (name: string, subjectSlugs: string[]) => TeacherClass | null;
  /** update name and/or subject selection of an existing class */
  update: (id: string, patch: { name?: string; subjectSlugs?: string[] }) => boolean;
  remove: (id: string) => void;
}

export function useMyClasses(): MyClasses {
  const classes = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const has = useCallback((id: string) => classes.some((c) => c.id === id), [classes]);
  const get = useCallback(
    (id: string) => classes.find((c) => c.id === id),
    [classes],
  );

  const add = useCallback((name: string, subjectSlugs: string[]) => {
    const trimmed = name.trim();
    const slugs = [...new Set(subjectSlugs)];
    if (!trimmed || slugs.length === 0) return null;
    const cls: TeacherClass = {
      id: makeId(),
      name: trimmed,
      subjectSlugs: slugs,
      createdAt: new Date().toISOString(),
    };
    writeClasses([...readClasses(), cls]);
    return cls;
  }, []);

  const update = useCallback((id: string, patch: { name?: string; subjectSlugs?: string[] }) => {
    const cur = readClasses();
    const idx = cur.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    const next = [...cur];
    const merged: TeacherClass = {
      ...next[idx],
      ...(patch.name !== undefined
        ? { name: patch.name.trim() || next[idx].name }
        : null),
      ...(patch.subjectSlugs !== undefined
        ? { subjectSlugs: [...new Set(patch.subjectSlugs)] }
        : null),
    };
    if (merged.subjectSlugs.length === 0) return false; // a class keeps ≥1 subject
    next[idx] = merged;
    writeClasses(next);
    return true;
  }, []);

  const remove = useCallback((id: string) => {
    writeClasses(readClasses().filter((c) => c.id !== id));
  }, []);

  return { classes, has, get, add, update, remove };
}
