/**
 * Retrieval-lite for the demo Tutor.
 *
 * The demo can experiment with retrieval UX, but respects the SyllabAI
 * retrieval architecture (brief §26) in simplified form:
 *
 *   learner query
 *     → intent-lite (question vs concept vs "which spec point")
 *     → curriculum/concept resolution (spec-code mentions win)
 *     → lexical candidate generation over the BUNDLED corpus (BM25-lite)
 *     → SyllabAI-aware reranking (spec-point anchor hits, provenance tiers)
 *     → evidence selection + sufficiency threshold
 *     → grounded downstream generation (or an honest refusal)
 *
 * This is a demo-grade lexical retriever — NOT the production KA-RAG path
 * (syllabai-core's hybrid retrieval + fusion + validation remains
 * authoritative). It exists so tutor experiments work offline.
 */
import type { ExamQuestionTopic, RevisionNote, TutorCitation } from "@/lib/contracts";
import type { ConceptGraph } from "@/lib/contracts";

const STOP = new Set([
  "the", "a", "an", "is", "are", "of", "and", "or", "to", "in", "on", "for",
  "what", "which", "how", "why", "when", "does", "do", "can", "with", "this",
  "that", "it", "as", "at", "by", "from", "be", "explain", "describe", "me",
  "about", "between", "into", "during", "their", "they", "its",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface IndexedSegment {
  kind: "REVISION_NOTE" | "QUESTION_PART" | "SPEC_POINT" | "CONCEPT";
  ref: string;
  title: string;
  specPointCode: string | null;
  text: string;
  tokens: Map<string, number>;
  url: string | null;
}

export interface CorpusIndex {
  segments: IndexedSegment[];
  idf: Map<string, number>;
}

export function buildCorpusIndex(
  notes: RevisionNote[],
  topics: ExamQuestionTopic[],
  graph: ConceptGraph,
  /** the owning course slug — threaded into graph citations so they open the
   *  RIGHT course's graph (the KG page never silently substitutes the pilot) */
  course?: string,
): CorpusIndex {
  const segments: IndexedSegment[] = [];

  for (const n of notes) {
    const specCode = n.specPointCodes[0] ?? null;
    // chunk the note body by markdown headings — keeps segments focused
    const chunks = n.bodyMd.split(/\n(?=#{2,4}\s)/g).slice(0, 12);
    for (const [i, chunk] of chunks.entries()) {
      segments.push({
        kind: "REVISION_NOTE",
        ref: n.noteId,
        title: chunks.length > 1 ? `${n.title} · §${i + 1}` : n.title,
        specPointCode: specCode,
        text: chunk.slice(0, 1500),
        tokens: new Map(),
        url: `/revision-notes/${n.noteId}`,
      });
    }
  }

  for (const t of topics) {
    for (const q of t.questions) {
      for (const p of q.parts) {
        segments.push({
          kind: "QUESTION_PART",
          ref: p.id,
          title: `${t.name} · ${p.marks}-mark ${p.commandWord ?? "question"}`,
          specPointCode: p.specPointCodes[0] ?? null,
          text: `${p.problemMd ?? ""}\n---\nmark scheme / solution:\n${p.solutionMd ?? ""}`.slice(0, 1800),
          tokens: new Map(),
          url: `/exam-questions?q=${p.id}`,
        });
      }
    }
  }

  for (const sp of graph.nodes) {
    if (sp.family === "CONCEPT" || sp.family === "MISCONCEPTION") {
      segments.push({
        kind: "CONCEPT",
        ref: sp.code,
        title: sp.title,
        specPointCode: sp.specPoints[0] ?? null,
        text: [sp.summary ?? "", ...sp.aliases].filter(Boolean).join(" · "),
        tokens: new Map(),
        url: `/knowledge-graph?${course ? `course=${encodeURIComponent(course)}&` : ""}node=${encodeURIComponent(sp.code)}`,
      });
    }
  }

  // df for idf
  const df = new Map<string, number>();
  for (const s of segments) {
    const seen = new Set<string>();
    for (const tok of tokenize(`${s.title} ${s.text}`)) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      df.set(tok, (df.get(tok) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [tok, count] of df) {
    idf.set(tok, Math.log(1 + segments.length / count));
  }
  for (const s of segments) {
    for (const tok of tokenize(`${s.title} ${s.text}`)) {
      s.tokens.set(tok, (s.tokens.get(tok) ?? 0) + 1);
    }
  }
  return { segments, idf };
}

export interface RetrievalResult {
  citations: TutorCitation[];
  sufficient: boolean;
  bestScore: number;
}

const SUFFICIENCY_THRESHOLD = 1.15; // demo-grade honest refusal gate

export function retrieve(
  index: CorpusIndex,
  query: string,
  limit = 6,
): RetrievalResult {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) {
    return { citations: [], sufficient: false, bestScore: 0 };
  }
  const scored = index.segments.map((s) => {
    let score = 0;
    for (const tok of qTokens) {
      const tf = s.tokens.get(tok);
      if (tf) score += (1 + Math.log(tf)) * (index.idf.get(tok) ?? 0);
    }
    // SyllabAI-aware reranking lite:
    //  - explicit spec-code mention in the segment text is a strong anchor
    //  - title hits matter more than body hits
    //  - validated/derived skeletons (RULE_DERIVED spec points) nudge up
    const lower = `${s.title} ${s.text}`.toLowerCase();
    for (const tok of qTokens) {
      if (s.specPointCode && s.specPointCode.toLowerCase().includes(tok) && tok.length > 2) {
        score += 1.2;
      }
      if (s.title.toLowerCase().includes(tok)) score += 0.35;
      if (lower.includes(`${tok}`) && tok.length > 5) score += 0.05;
    }
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).filter((r) => r.score > 0.4);
  const citations: TutorCitation[] = top.map((r, i) => ({
    index: i + 1,
    label: `${r.s.title}${r.s.specPointCode ? ` · ${r.s.specPointCode}` : ""}`,
    kind: r.s.kind,
    ref: r.s.ref,
    specPointCode: r.s.specPointCode,
    url: r.s.url,
    score: Math.round(r.score * 100) / 100,
  }));
  return {
    citations,
    sufficient: (top[0]?.score ?? 0) >= SUFFICIENCY_THRESHOLD,
    bestScore: top[0]?.score ?? 0,
  };
}
