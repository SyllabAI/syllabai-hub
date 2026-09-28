/**
 * SyllabAI Hub semantic contracts.
 *
 * Lightweight domain contracts (Zod + inferred TS types) for the objects the
 * demo actually needs. These ALIGN with SyllabAI's canonical semantics — they
 * do not redefine them:
 *
 *   - SpecificationPoint codes (e.g. "4CH1-1.25") are first-class canonical
 *     anchors. The demo never invents a second educational truth model.
 *   - validationStatus / provenanceTier travel with every educational object.
 *   - Learner state is an OVERLAY on curriculum truth. Everything simulated in
 *     this demo is flagged SIMULATED and kept separate from imported content.
 *   - Retrieval-derived structures (T-C11 concepts/edges) are shown with their
 *     real provenance (AI_SUGGESTED ≠ HUMAN_VALIDATED), never silently
 *     promoted to educational truth.
 *
 * Mirrors (simplified, read-only) of syllabai-core DTOs (Master Spec §22) and
 * the graph-as-code schemas (T-C09 relationships.yaml / T-C11 concepts.yaml).
 */
import { z } from "zod";

// ── validation & provenance vocabulary (canonical enum, Master Spec §7) ──
export const ValidationStatus = z.enum([
  "SUGGESTED",
  "VALIDATED",
  "REJECTED",
  "FLAGGED",
]);

export const ProvenanceTier = z.enum([
  "RULE_DERIVED",   // operator-governed skeleton (T-C09)
  "AI_SUGGESTED",   // T-C11 extraction — NOT validated, needs operator review
  "HUMAN_VALIDATED", // operator-reviewed
  "DEMO_DERIVED",   // generated inside the demo for prototyping only
  "SIMULATED",      // deterministic fiction (learner overlay)
]);

export const MasteryBand = z.enum(["LOW", "DEVELOPING", "SECURE", "UNMEASURED"]);

// ── curriculum: board/qualification/subject identity ─────────────────
export const CurriculumIdentity = z.object({
  board: z.string(),
  level: z.string(),
  subject: z.string(),
  code: z.string(), // e.g. "4CH1"
  syllabusVersion: z.string(),
});

// ── curriculum skeleton (from graph/relationships.yaml, RULE_DERIVED) ──
/**
 * Paper/unit applicability — the upstream canonical object copied verbatim
 * (T-KG-16 derivation; T-KG-17 propagation). Every field is optional because
 * coverage is per-row: rows with no printed home (SX front matter, the
 * geography cross-paper AO/skills rows) simply carry no object. `rule` is the
 * printed-spec provenance sentence — shown as tooltip text, never edited.
 */
export const SpecApplicability = z.object({
  papers: z.array(z.string()).optional(),
  unit_scope: z.string().nullish(),
  tier: z.string().nullish(),
  coursework: z.boolean().nullish(),
  double_award_shared: z.boolean().nullish(),
  rule: z.string().optional(),
});
export type SpecApplicability = z.infer<typeof SpecApplicability>;

export const CurriculumNode = z.object({
  code: z.string(), // "4CH1-1.1" | SME-native "spcpt_*" / section-topic slugs
  family: z.string(), // SUBJECT | TOPIC | SUBTOPIC | SPEC_POINT | PRACTICAL
  title: z.string(),
  description: z.string().nullable(),
  parents: z.array(z.string()),
  provenanceTier: ProvenanceTier,
  /** corpus-native ordering (SME-native trees); code-sorted when absent */
  order: z.number().optional(),
  /** paper/unit assessment home — official-spec trees only (T-KG-17) */
  applicability: SpecApplicability.optional(),
});

export const CurriculumEdge = z.object({
  source: z.string(),
  relation: z.string(), // PART_OF | REQUIRES_PREREQUISITE | RELATED_TO …
  target: z.string(),
  provenanceTier: ProvenanceTier,
});

export const Curriculum = z.object({
  board: z.string(),
  level: z.string(),
  subject: z.string(),
  code: z.string(),
  syllabusVersion: z.string(),
  nodes: z.array(CurriculumNode),
  edges: z.array(CurriculumEdge),
});
export type Curriculum = z.infer<typeof Curriculum>;
export type CurriculumNode = z.infer<typeof CurriculumNode>;

// ── T-C11 concept graph (retrieval-derived; provenance shown, never truth) ──
export const ConceptNode = z.object({
  code: z.string(), // "4CH1-CON-…" | "4CH1-MIS-…"
  family: z.string(), // CONCEPT | MISCONCEPTION
  title: z.string(),
  aliases: z.array(z.string()),
  summary: z.string().nullable(),
  specPoints: z.array(z.string()),
  provenanceTier: ProvenanceTier,
  extractionPass: z.string().nullable(),
});

export const ConceptEdge = z.object({
  source: z.string(),
  relation: z.string(), // PART_OF | REQUIRES_PREREQUISITE | RELATED_TO |
  // COMMONLY_CONFUSED_WITH | WRONG_ANSWER_PATTERN | MISCONCEPTION_OF | REMEDIATED_BY …
  target: z.string(),
  role: z.string().nullable(),
  evidenceQuote: z.string().nullable(),
  provenanceTier: ProvenanceTier,
  extractionPass: z.string().nullable(),
  derivationMethod: z.string().nullable(),
});

export const ConceptGraph = z.object({
  curriculumCode: z.string(),
  edgeVocabulary: z.string().nullable(),
  counts: z.record(z.string(), z.unknown()).nullable(),
  validationGate: z.string().nullable(),
  nodes: z.array(ConceptNode),
  edges: z.array(ConceptEdge),
});
export type ConceptGraph = z.infer<typeof ConceptGraph>;
export type ConceptNodeT = z.infer<typeof ConceptNode>;

// ── revision notes (SME corpus; syllabai.sme-revision-notes semantics) ──
export const RevisionNote = z.object({
  noteId: z.string(), // canonical "rn_*" id — preserved, never regenerated
  title: z.string(),
  sourceUrl: z.string().nullable(),
  specPointIds: z.array(z.string()), // upstream spcpt_* ids
  specPointCodes: z.array(z.string()), // official anchors (4CH1 pilot only)
  guidedStudy: z.boolean(),
  path: z.string().nullable(),
  updatedAt: z.string(),
  bodyMd: z.string(),
  // corpus-native placement (SME section/topic slugs) — set by the importer
  sectionSlug: z.string().optional(),
  topicSlug: z.string().optional(),
});
export type RevisionNote = z.infer<typeof RevisionNote>;

// ── exam questions (SME corpus; syllabai.sme-exam-questions/1.1 subset) ──
export const QuestionPart = z.object({
  id: z.string(), // canonical qstnprt_* id
  order: z.number(),
  questionType: z.string().nullable(),
  marks: z.number(),
  commandWord: z.string().nullable(),
  specPointIds: z.array(z.string()),
  specPointCodes: z.array(z.string()),
  problemMd: z.string(),
  solutionMd: z.string().nullable(),
  /**
   * Structured MCQ options carried verbatim from the upstream corpus
   * (SME-ExamQuestion topic.json `choices`): label A–D, the attested correct
   * flag, and the option text. Present on ~all multiple_choice parts; null
   * on structured parts. Never inferred — if absent, the MCQ falls back to
   * the honest "options not captured" notice.
   */
  choices: z
    .array(
      z.object({
        label: z.string(),
        isCorrect: z.boolean(),
        textMd: z.string(),
      }),
    )
    .nullable()
    .optional(),
  /** real past-paper provenance from the corpus (e.g. Jan 2022 · WCH11/01) */
  sourcePaper: z
    .object({
      date: z.string().nullable(),
      number: z.string().nullable(),
      questionNumber: z.number().nullable(),
      questionPart: z.string().nullable(),
    })
    .nullable()
    .optional(),
});

export const ExamQuestion = z.object({
  id: z.string(), // canonical qstn_* id
  order: z.number(),
  difficulty: z.string().nullable(),
  style: z.string().nullable(),
  totalMarks: z.number(),
  parts: z.array(QuestionPart),
});
export type ExamQuestion = z.infer<typeof ExamQuestion>;

export const ExamQuestionTopic = z.object({
  topicId: z.string(),
  slug: z.string(),
  name: z.string(),
  /** corpus set page kind, e.g. "Multiple-Choice Questions" (null on mixed sets) */
  setName: z.string().nullable().optional(),
  /** SME topic slug this set page belongs to (corpus-native placement) */
  topicSlug: z.string().optional(),
  sectionSlug: z.string().optional(),
  section: z.string(),
  curriculum: CurriculumIdentity,
  source: z.object({
    provider: z.string(),
    license: z.string(),
    pageUrl: z.string().nullable(),
  }),
  schema: z.string().nullable(),
  relatedRevisionNotesFolder: z.string().nullable().optional(),
  /** note ids (rn_*) the corpus links this topic's questions to */
  relatedNoteIds: z.array(z.string()).optional(),
  questions: z.array(ExamQuestion),
});
export type ExamQuestionTopic = z.infer<typeof ExamQuestionTopic>;

// ── flashcards (corpus decks; SME spec_links preserved) ─────────────
export const Flashcard = z.object({
  id: z.string(),
  specPointCode: z.string().nullable(),
  front: z.string(),
  back: z.string(),
  sourceNoteId: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  provenanceTier: ProvenanceTier,
  // corpus-native fields (set by the importer)
  cardType: z.string().nullable().optional(), // keyword_definition | question_and_answer | true_or_false | fill_in_the_blanks
  specPointIds: z.array(z.string()).optional(), // SME spcpt_* anchors as printed upstream
  deckSlug: z.string().nullable().optional(),
  sectionSlug: z.string().nullable().optional(),
  topicSlug: z.string().nullable().optional(),
  /** resolved navigation sub-topic code (corpus topic or official sub-topic) */
  subtopicCode: z.string().nullable().optional(),
});
export type Flashcard = z.infer<typeof Flashcard>;

// ── learner overlay (SIMULATED in the demo — never a governed model) ──
export const SimSkillState = z.object({
  nodeId: z.string(), // spec-point code
  code: z.string(),
  title: z.string(),
  mastery: z.number(),
  effectiveMastery: z.number(),
  band: MasteryBand,
  attempts: z.number(),
  correctCount: z.number(),
  lastPracticedAt: z.string(),
});

export const SimMisconceptionState = z.object({
  misconceptionNodeId: z.string(),
  code: z.string(),
  title: z.string(),
  probability: z.number(),
  active: z.boolean(),
  evidenceCount: z.number(),
});

export const SimLearnerState = z.object({
  learnerId: z.string(),
  displayName: z.string(),
  disclaimer: z.string(),
  skillStates: z.array(SimSkillState),
  misconceptionStates: z.array(SimMisconceptionState),
});
export type SimLearnerState = z.infer<typeof SimLearnerState>;

// ── content bundle manifest ──────────────────────────────────────────
export const ContentManifest = z.object({
  schema: z.string(),
  generatedUtc: z.string(),
  importSource: z.object({
    repo: z.string(),
    ref: z.string(),
    upstreamSchemas: z.array(z.string()),
  }),
  curriculum: CurriculumIdentity,
  license: z.string(),
  counts: z.record(z.string(), z.number()),
  /** "official" (4CH1 pilot) or "sme-native" (corpus tree) */
  treeKind: z.string().optional(),
});
export type ContentManifest = z.infer<typeof ContentManifest>;

// ── tutor grounding (demo-simplified §26 pipeline) ────────────────────
export const TutorCitation = z.object({
  index: z.number(),
  label: z.string(), // human label, e.g. "The Three States of Matter · 4CH1-1.1"
  kind: z.enum(["REVISION_NOTE", "QUESTION_PART", "SPEC_POINT", "CONCEPT"]),
  ref: z.string(), // noteId / questionId / spec code
  specPointCode: z.string().nullable(),
  url: z.string().nullable(), // in-app deep link
  score: z.number(),
});
export type TutorCitation = z.infer<typeof TutorCitation>;

// ── AI provider abstraction (server-side only) ───────────────────────
export const AiProviderId = z.enum([
  "groq",
  "openrouter",
  "gemini",
  "freellm",
  "zai", // sandbox default — z-ai-web-dev-sdk, no key required
  "mock", // deterministic offline fallback
]);
export type AiProviderId = z.infer<typeof AiProviderId>;

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiCompletionRequest {
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  /** short marker appended to metadata, never shown to the model */
  signal?: string;
}

export interface AiCompletionResult {
  text: string;
  provider: string;
  model: string | null;
  latencyMs: number;
}

/** every adapter is server-only; no key ever reaches the browser */
export interface AiProvider {
  id: AiProviderId;
  displayName: string;
  model: string | null;
  available(): boolean;
  complete(req: AiCompletionRequest): Promise<AiCompletionResult>;
}
