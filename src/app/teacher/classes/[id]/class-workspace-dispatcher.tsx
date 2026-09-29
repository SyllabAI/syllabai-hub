"use client";

/**
 * Class id dispatcher (HUB-TEACHER-DASH wave 1) — /teacher/classes/[id]
 * serves TWO honest class concepts, and this client picks without ever
 * blurring them:
 *
 *   - a hub-local class container (lib/teacher/my-classes.ts, browser-local
 *     like the student's subject roster) renders LocalClassWorkspace — the
 *     operator's directive made physical: all the tools and course
 *     resources for the class's selected subjects, per-subject sections;
 *   - anything else is a CORE class id (the RBAC-backed roster workspace)
 *     and falls through to the existing ClassDetailClient untouched.
 */

import { ClassDetailClient } from "./class-detail-client";
import { LocalClassMissing, LocalClassWorkspace } from "./class-workspace-local";
import { useMyClasses } from "@/lib/teacher/my-classes";
import type { TeacherCourseLite } from "../../teacher-client";

export function ClassWorkspaceDispatcher({
  classId,
  courses,
}: {
  classId: string;
  courses: TeacherCourseLite[];
}) {
  const { has } = useMyClasses();
  // hydration note: useSyncExternalStore renders the SERVER snapshot (empty
  // roster) through hydration and re-renders with the client snapshot after
  // mount — a core class id resolves identically on both passes (never in
  // the local store), and a local id swaps in after hydration, no mismatch.
  // A "local-" id that the store does not know is a removed/expired container
  // — it must NEVER fall through to the core client (a core fetch for a
  // browser-local id would be a category error); it gets the honest
  // missing-class card instead.
  if (classId.startsWith("local-")) {
    return has(classId) ? (
      <LocalClassWorkspace classId={classId} courses={courses} />
    ) : (
      <LocalClassMissing />
    );
  }
  return <ClassDetailClient classId={classId} />;
}
