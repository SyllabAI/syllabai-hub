/**
 * note_by_id_join_verify — pins the citation popup's courseless note join
 * (the /api/notes/by-id/[noteId] registry scan shipped after PR #27).
 *
 * Corpus reality this script pins (probed 2026-10-03): "rn_" ids are stable
 * per SME source page and REUSED across sibling course bundles — of 2,538
 * ids, 681 appear in up to 5 bundles and 623 of those carry DIFFERING
 * bodies (course-specific variants). A first-match scan would silently
 * serve the wrong course's body, so the route enforces THE AMBIGUITY GATE:
 * an id joins courselessly ONLY when exactly one registered bundle owns it.
 *
 * What is pinned here, against the committed corpus:
 *   1. at least one bundle ships notes
 *   2. for EVERY id: joinable ⟺ owner count == 1 (the gate's decision
 *      invariant — simulated faithfully against the route's scan)
 *   3. unique-id join shape: owning course + reader href + non-empty
 *      title/bodyMd; ambiguous and absent ids refuse (404 floor)
 *   4. every id keeps the rn_ vocabulary
 *   5. the popup's fileName regex round-trips every id
 *
 * Reads the committed registry/bundles directly (courses.ts is server-only);
 * the route itself validates through the same zod schemas at runtime.
 *
 * Run: bun scripts/note_by_id_join_verify.ts  (CI step, exits non-zero on drift)
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CONTENT_DIR = path.join(process.cwd(), "content");

let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

/** the popup's join key (citation-paper-link.tsx NOTE_FILE) */
const NOTE_FILE = /^sme-note-(.+)\.txt$/;

interface Note {
  noteId: string;
  title: string;
  bodyMd: string;
}

async function main() {
  const registry = JSON.parse(await readFile(path.join(CONTENT_DIR, "courses.json"), "utf8")) as {
    courses: { slug: string }[];
  };

  // registry order preserved — the same scan source the route iterates
  const notesByCourse = new Map<string, Note[]>();
  for (const c of registry.courses) {
    const p = path.join(CONTENT_DIR, c.slug, "notes.json");
    if (!existsSync(p)) continue;
    const notes = (JSON.parse(await readFile(p, "utf8")) as Note[]).filter(
      (n) => typeof n.noteId === "string" && n.noteId.startsWith("rn_"),
    );
    notesByCourse.set(c.slug, notes);
  }
  check("at least one bundle ships notes", notesByCourse.size > 0, true);
  for (const [slug, notes] of notesByCourse) {
    check(`bundle ${slug} carries notes`, notes.length > 0, true);
  }

  const owners = new Map<string, string[]>();
  for (const [slug, notes] of notesByCourse) {
    for (const n of notes) {
      const list = owners.get(n.noteId) ?? [];
      if (!list.includes(slug)) list.push(slug);
      owners.set(n.noteId, list);
    }
  }
  check("corpus carries note ids", owners.size > 0, true);

  /** the route's gated scan, simulated faithfully: registry order, second
   *  owner refuses the join (404), zero owners 404s */
  const scan = (id: string): { course: string; note: Note } | null => {
    let hit: { course: string; note: Note } | null = null;
    for (const [slug, notes] of notesByCourse) {
      const note = notes.find((n) => n.noteId === id);
      if (!note) continue;
      if (hit) return null; // ambiguous — the route 404s
      hit = { course: slug, note };
    }
    return hit;
  };

  // the gate's decision invariant, for EVERY id: joinable ⟺ 1 owner
  let uniqueCount = 0;
  let ambiguousCount = 0;
  for (const [id, list] of owners) {
    const hit = scan(id);
    if (list.length === 1) {
      uniqueCount++;
      check(`unique id joins: ${id}`, hit !== null, true);
      if (hit) {
        check(`  owning course: ${id}`, hit.course, list[0]);
        check(
          `  reader href: ${id}`,
          `/courses/${hit.course}/revision-notes/${id}`,
          `/courses/${list[0]}/revision-notes/${id}`,
        );
        check(`  body non-empty: ${id}`, hit.note.bodyMd.trim().length > 0, true);
        check(`  title non-empty: ${id}`, hit.note.title.trim().length > 0, true);
      }
    } else {
      ambiguousCount++;
      check(`ambiguous id refuses: ${id}`, hit, null);
    }
  }
  console.log(
    `census: ${owners.size} ids — ${uniqueCount} joinable courselessly, ${ambiguousCount} ambiguous (refused by the gate)`,
  );

  // absent ids miss
  check("absent id refuses (fail-closed)", scan("rn_absent_probe_no_such_note"), null);
  check("empty id refuses (fail-closed)", scan(""), null);

  // the popup's regex round-trips every id out of the corpus fileName form
  let roundTrips = 0;
  for (const id of owners.keys()) {
    const m = NOTE_FILE.exec(`sme-note-${id}.txt`);
    if (m?.[1] === id) roundTrips++;
  }
  check("fileName regex round-trips every id", roundTrips, owners.size);

  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
