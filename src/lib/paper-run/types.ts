/**
 * Paper Run — shared types (client-safe).
 *
 * Implements PAST_PAPER_RUN_MODE_DESIGN.md v2 (design of record, syllabai
 * main b206985): PaperInteractivityManifest v2 + PaperRunResult v3 + the run
 * state machine with durable time-up-pending-submission recovery.
 *
 * Honesty invariants (design §5.1 authority stratification):
 *   - answer rects are UI metadata only
 *   - MCQ keys are assessment evidence ONLY with keyAttested + keyProvenance
 *   - mark allocations come from the PaperBlueprint, never invented
 *   - integrity is "practice" — local, manipulable, labeled; never presented
 *     as controlled-exam semantics
 */

// ── manifest v2 ─────────────────────────────────────────────────────────────

export interface ManifestRect {
  /** normalized [x, y, w, h] of the page (top-origin), 0..1 fractions */
  rect: [number, number, number, number];
}

export interface McqZone extends ManifestRect {
  option: string;
  /** 1-based PDF page the zone sits on */
  page: number;
}

export interface AnswerArea extends ManifestRect {
  page: number;
}

export interface ManifestMcq {
  options: string[];
  zones: McqZone[];
  /** the correct option letter — assessment evidence, provenance-gated */
  key: string | null;
  keyAttested: boolean;
  keyProvenance: "parsed-corpus" | "ms-extracted" | "operator-confirmed" | null;
}

export interface ManifestPart {
  /** letter label a, b, c … (bundle-part order) */
  part: string;
  marks: number;
  kind: "mcq" | "structured";
  /** mcq only */
  mcq?: ManifestMcq;
  /** structured only */
  answerKind?: "text" | "paper-only";
  answerAreas?: AnswerArea[];
  /** honest curation note shown in the runner (why geometry is absent) */
  note?: string | null;
}

export interface ManifestQuestion {
  number: string;
  /** 1-based PDF page the question starts on */
  page: number;
  kind: "mcq" | "structured";
  marksTotal: number;
  parts: ManifestPart[];
}

export interface PaperRunManifest {
  version: 2;
  paper: {
    corpusKey: string;
    ref: string;
    session: string;
    durationMin: number;
    totalMarks: number;
    blueprintRef: string;
    integrity: "practice";
    /** matched reconstruction (parsed corpus) key — the core join lane */
    reconKey?: string;
  };
  provenance: {
    source: "build-time-draft" | "curated";
    draftGeneratedAt: string;
    curatedBy: string;
    status: "draft" | "confirmed";
    verification?: string;
  };
  questions: ManifestQuestion[];
}

export interface PaperRunManifestsFile {
  meta: {
    generatedAt: string;
    note: string;
    papers: number;
  };
  papers: Record<string, PaperRunManifest>;
}

// ── marking provenance (design §5.4/§5.5 — display-honest, N-5) ────────────

export type MarkHow = "auto" | "self" | "ai-suggested" | "paper-only";

// ── run state machine (design §5.2) ─────────────────────────────────────────

export type RunPhase =
  | "running"
  | "time-up-pending-submission"
  | "grading"
  | "done"
  | "abandoned"
  | "corrupted";

export type DurationPolicy = "OFFICIAL" | "ACCOMMODATED";

/** One structured-part answer captured by the overlay. */
export interface CapturedPartAnswer {
  partKey: string; // `${questionNumber}:${partLabel}`
  value: string; // typed text ("" for paper-only tick)
  paperOnly: boolean;
  editedAt: string;
}

/** Per-question grading outcome, recorded in the console. */
export interface PartMark {
  partKey: string;
  marks: number;
  max: number;
  how: MarkHow;
  /** MCQ chosen letter (auto or console-asked) */
  chosen?: string;
  /** key-candidate recorded when the grader supplies a correct option */
  keyCandidate?: string;
}

export interface QuestionMark {
  number: string;
  parts: PartMark[];
}

/** Durable run record in IndexedDB (survives reload; NOT cross-device). */
export interface PaperRunRecord {
  runId: string; // `${course}:${corpusKey}:${startedAt}`
  course: string;
  corpusKey: string;
  ref: string;
  phase: RunPhase;
  startedAt: string;
  lastSavedAt: string;
  submittedAt: string | null;
  endedAt: string | null;
  durationMin: number;
  durationPolicy: DurationPolicy;
  /** seconds elapsed when the run ended (timer snapshot) */
  timeUsedSec: number;
  timeUpAutoSubmitted: boolean;
  /** manifest version the run was taken under */
  manifestVersion: number;
  answers: Record<string, CapturedPartAnswer>; // by partKey
  flags: Record<string, boolean>; // by question number
  currentIndex: number;
}

/** PaperRunResult v3 — additive evolution of MockResult (localStorage). */
export interface PaperRunResult {
  id: string;
  mode: "run";
  course: string;
  ref: string;
  title: string;
  sessionId: string;
  manifestVersion: number;
  integrity: "practice";
  durationPolicy: DurationPolicy;
  startedAt: string;
  finishedAt: string;
  durationMin: number;
  timeUsedSec: number;
  ended: "time-up" | "self";
  timeUpAutoSubmitted: boolean;
  marks: number;
  total: number;
  coverageState: "full" | "partial";
  marked: { auto: number; self: number; aiSuggested: number; paperOnly: number };
  perQuestion: Array<{
    number: string;
    marks: number;
    max: number;
    how: MarkHow;
  }>;
  /** MCQ keys the grader supplied at marking time — manifest candidates
   *  (never auto-applied; R-6 confirmation gate) */
  keyCandidates?: Array<{ number: string; part: string; option: string }>;
  /** core bridge outcome (pilot joins only; absent = local-only run) */
  coreSubmissions?: { attempted: number; recorded: number; failed: number };
}

/** Union for the results strip: v1/v2 mock records keep their shape. */
export type MockOrRunResult = {
  id: string;
  course: string;
  ref: string;
  title: string;
  sessionId: string;
  finishedAt: string;
  durationMin: number;
  timeUsedSec: number;
  marks: number;
  total: number;
  ended: "time-up" | "self" | "exited";
  questions?: Array<{ label: string; marks: number; max: number | null }>;
  mode?: "run";
  integrity?: "practice";
  durationPolicy?: DurationPolicy;
  marked?: PaperRunResult["marked"];
  perQuestion?: PaperRunResult["perQuestion"];
  coverageState?: PaperRunResult["coverageState"];
};

/** Max a run may exceed the official duration (design §5.2, operator-tunable). */
export const ACCOMMODATION_CEILING = 1.25;
