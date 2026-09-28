import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * GET /api/kg-learner-bridge?course=<slug>
 *
 * Content-id → specification-point bridge for the knowledge-graph learner
 * overlay (KG phase 1). The renderer's learner-state engine is keyed by
 * spec-point id ("1.1", "105"), while the browser-local progress store
 * records events against content ids (notes "rn_*", questions "qstn_*",
 * question parts "qstnprt_*", flashcards "fl_*"). This route joins the two:
 *
 *   - notes.json          → noteId   → specPointCodes (verbatim)
 *   - questions.json      → partId   → specPointCodes,
 *                           questionId → union of its parts' codes,
 *                           partId → parent questionId (awaiting-marks join)
 *   - content-maps/*.json → flashcardId → mapped spine codes; cards the map
 *                           left unmapped fall back to the SUBTOPIC-ANCHOR
 *                           join (flashcards.json subtopicCode "4CH1-S1-a" →
 *                           pointSubtopics "1a" → spec points — exact shape
 *                           only, slug-style deck codes stay honestly
 *                           unmapped; tranche 4.4)
 *   - public/kg/data      → the exported spine's point ids (the overlay may
 *                           only reference points the renderer actually has)
 *                           + the curriculum code used as the "4CH1-" style
 *                           prefix on some bundles' specPointCodes
 *   - concept-graph.json  → KG phase 3: MISCONCEPTION nodes (SME/mark-scheme
 *                           provenance) joined to spec points via their
 *                           MISCONCEPTION_OF / WRONG_ANSWER_PATTERN edges into
 *                           CONCEPT nodes (which carry the specPoints)
 *   - learner-sim.json    → the seeded demo learner's misconception states
 *                           (probability / active / evidenceCount) — SIMULATED,
 *                           deterministic; only courses carrying BOTH a corpus
 *                           and sim states produce entries, everything else
 *                           gets an honest empty list
 *
 * Codes only — no question text, note bodies or answers cross this boundary.
 * Responses are cached in-process; the bundles are immutable between deploys.
 */
export const dynamic = "force-dynamic";

interface CodeRef {
  spineCode?: string | null;
  officialCode?: string | null;
}

interface MapItem {
  kind?: string;
  codes?: CodeRef[];
}

interface QuestionPart {
  id?: string;
  specPointCodes?: string[];
}

interface Question {
  id?: string;
  parts?: QuestionPart[];
}

interface QuestionSet {
  questions?: Question[];
}

/** One watched misconception — content from the corpus, state from the sim
 *  learner. `label` is the short overlay string the renderer glyph carries. */
interface BridgeMisconception {
  id: string;
  title: string;
  label: string;
  summary: string | null;
  /** raw spec-point codes the misconception maps onto (curriculum-prefixed) */
  points: string[];
  probability: number;
  active: boolean;
  evidenceCount: number;
}

interface LearnerBridgePayload {
  course: string;
  codePrefix: string | null;
  totalPoints: number;
  pointIds: string[];
  noteCodes: Record<string, string[]>;
  questionCodes: Record<string, string[]>;
  partParent: Record<string, string>;
  flashcardCodes: Record<string, string[]>;
  misconceptions: BridgeMisconception[];
  /** sim-learner disclaimer for drawer labelling — null when no states exist */
  misconceptionDisclaimer: string | null;
}

const cache = new Map<string, LearnerBridgePayload>();

const safeRead = <T,>(path: string): T | null => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
};

/** Flatten one content-map item's code refs to bare spine codes. */
function itemCodes(item: MapItem | undefined): string[] {
  const out: string[] = [];
  for (const ref of item?.codes ?? []) {
    const code = ref?.spineCode ?? ref?.officialCode;
    if (code) out.push(code);
  }
  return out;
}

export function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("course") ?? "";
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: "bad course slug" }, { status: 400 });
  }

  const cached = cache.get(slug);
  if (cached) return NextResponse.json(cached);

  const kg = safeRead<{
    points?: { id?: string }[];
    meta?: { code?: string };
    /** subtopic key → spec point ids (tranche 4.4 flashcard anchor join) */
    pointSubtopics?: Record<string, string[]>;
  }>(
    join(process.cwd(), "public", "kg", "data", `${slug}.json`),
  );
  if (!kg || !Array.isArray(kg.points)) {
    return NextResponse.json(
      { error: `no exported kg data for ${slug}` },
      { status: 404 },
    );
  }
  const pointIds = kg.points.map((p) => String(p?.id ?? "")).filter(Boolean);
  const codePrefix = kg.meta?.code ?? null;

  const noteCodes: Record<string, string[]> = {};
  interface NoteRef {
    noteId?: string;
    specPointCodes?: string[];
  }
  // notes.json is a top-level array in current bundles; accept {notes:[]} too
  const notesRaw = safeRead<NoteRef[] | { notes?: NoteRef[] }>(
    join(process.cwd(), "content", slug, "notes.json"),
  );
  const noteList: NoteRef[] = Array.isArray(notesRaw)
    ? notesRaw
    : (notesRaw?.notes ?? []);
  for (const note of noteList) {
    if (note.noteId && Array.isArray(note.specPointCodes)) {
      noteCodes[note.noteId] = note.specPointCodes.map(String);
    }
  }

  const questionCodes: Record<string, string[]> = {};
  const partParent: Record<string, string> = {};
  const sets = safeRead<QuestionSet[] | { questions?: QuestionSet[] }>(
    join(process.cwd(), "content", slug, "questions.json"),
  );
  const setList: QuestionSet[] = Array.isArray(sets)
    ? sets
    : (sets?.questions ?? []);
  for (const set of setList) {
    for (const question of set?.questions ?? []) {
      if (!question.id) continue;
      const union = new Set<string>();
      for (const part of question.parts ?? []) {
        if (!part.id) continue;
        const codes = (part.specPointCodes ?? []).map(String);
        partParent[part.id] = question.id;
        if (codes.length) questionCodes[part.id] = codes;
        codes.forEach((c) => union.add(c));
      }
      if (union.size) questionCodes[question.id] = [...union];
    }
  }

  const flashcardCodes: Record<string, string[]> = {};
  const map = safeRead<{ items?: Record<string, MapItem> }>(
    join(process.cwd(), "content-maps", `${slug}.json`),
  );
  const unmappedCards: string[] = [];
  for (const [id, item] of Object.entries(map?.items ?? {})) {
    if (item?.kind !== "flashcard") continue;
    const codes = itemCodes(item);
    if (codes.length) flashcardCodes[id] = codes;
    else unmappedCards.push(id);
  }

  // Subtopic-anchor fallback (tranche 4.4): the pilot's decks carry a spec
  // STATEMENT anchor per card ("4CH1-S1-a" — the same anchor that drives deck
  // placement), while the exported spine's pointSubtopics joins subtopic keys
  // ("1a") to their spec points. Resolve ONLY that exact shape — other
  // bundles' slug-style deck codes ("1-1-formulae-and-equations") carry no
  // statement anchor and stay honestly unmapped rather than guessed.
  if (unmappedCards.length && codePrefix) {
    const cardsRaw = safeRead<
      { id?: string; subtopicCode?: string | null }[] | { flashcards?: { id?: string; subtopicCode?: string | null }[] }
    >(join(process.cwd(), "content", slug, "flashcards.json"));
    const cardList = Array.isArray(cardsRaw)
      ? cardsRaw
      : (cardsRaw?.flashcards ?? []);
    const anchorRe = new RegExp(`^${codePrefix}-S(\\d+)-([a-z])$`);
    const pointsByAnchor = new Map<string, string[]>();
    const cardAnchor = new Map<string, string>();
    for (const card of cardList) {
      if (!card?.id || !card.subtopicCode) continue;
      const m = anchorRe.exec(card.subtopicCode);
      if (m) cardAnchor.set(card.id, `${m[1]}${m[2]}`);
    }
    if (cardAnchor.size) {
      for (const [key, pts] of Object.entries(kg.pointSubtopics ?? {})) {
        const valid = (pts ?? []).map(String).filter((p) => pointIds.includes(p));
        if (valid.length) pointsByAnchor.set(key, valid);
      }
      for (const id of unmappedCards) {
        const key = cardAnchor.get(id);
        const codes = key ? pointsByAnchor.get(key) : undefined;
        if (codes?.length) flashcardCodes[id] = codes;
      }
    }
  }

  // ── misconceptions (KG phase 3) — corpus content × sim-learner state ──
  interface GraphNode {
    code?: string;
    family?: string;
    title?: string;
    aliases?: string[];
    summary?: string | null;
    specPoints?: string[];
  }
  interface GraphEdge {
    source?: string;
    target?: string;
    relation?: string;
  }
  interface SimState {
    misconceptionNodeId?: string;
    probability?: number;
    active?: boolean;
    evidenceCount?: number;
  }
  interface SimLearner {
    disclaimer?: string;
    misconceptionStates?: SimState[];
  }
  const graph = safeRead<{ nodes?: GraphNode[]; edges?: GraphEdge[] }>(
    join(process.cwd(), "content", slug, "concept-graph.json"),
  );
  const sim = safeRead<SimLearner>(
    join(process.cwd(), "content", slug, "learner-sim.json"),
  );
  const misNodes = new Map<string, GraphNode>();
  const conceptPoints = new Map<string, string[]>();
  for (const node of graph?.nodes ?? []) {
    if (!node.code) continue;
    if (node.family === "MISCONCEPTION") misNodes.set(node.code, node);
    else if (node.family === "CONCEPT") conceptPoints.set(node.code, node.specPoints ?? []);
  }
  // MISCONCEPTION_OF / WRONG_ANSWER_PATTERN edges into concepts that carry
  // spec points — the corpus's own mapping, nothing inferred here
  const pointsByMis = new Map<string, Set<string>>();
  for (const edge of graph?.edges ?? []) {
    if (!edge.source || !misNodes.has(edge.source)) continue;
    if (edge.relation !== "MISCONCEPTION_OF" && edge.relation !== "WRONG_ANSWER_PATTERN") continue;
    const pts = edge.target ? conceptPoints.get(edge.target) : undefined;
    if (!pts?.length) continue;
    const set = pointsByMis.get(edge.source) ?? new Set<string>();
    pts.forEach((p) => set.add(p));
    pointsByMis.set(edge.source, set);
  }
  const misconceptions: BridgeMisconception[] = [];
  for (const state of sim?.misconceptionStates ?? []) {
    const id = state.misconceptionNodeId ?? "";
    const node = misNodes.get(id);
    const points = [...(pointsByMis.get(id) ?? [])];
    if (!node || !node.title || points.length === 0) continue;
    const rawLabel = node.aliases?.[0] ?? node.title;
    misconceptions.push({
      id,
      title: node.title,
      label: rawLabel.length > 64 ? `${rawLabel.slice(0, 63)}\u2026` : rawLabel,
      summary: node.summary ?? null,
      points,
      probability: Math.min(1, Math.max(0, state.probability ?? 0)),
      active: state.active ?? false,
      evidenceCount: Math.max(0, state.evidenceCount ?? 0),
    });
  }
  misconceptions.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      b.probability - a.probability ||
      a.id.localeCompare(b.id),
  );

  const payload: LearnerBridgePayload = {
    course: slug,
    codePrefix,
    totalPoints: pointIds.length,
    pointIds,
    noteCodes,
    questionCodes,
    partParent,
    flashcardCodes,
    misconceptions,
    misconceptionDisclaimer: misconceptions.length ? (sim?.disclaimer ?? null) : null,
  };
  cache.set(slug, payload);
  return NextResponse.json(payload);
}
