/**
 * SyllabAI shared frontend types — mirror the backend DTOs (Master Spec §22).
 */

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  user: UserView;
}

export interface NodeView {
  id: string;
  code: string;
  type: string;
  title: string;
  description: string | null;
  validationStatus: string;
  provenance: string | null;
  /** official paper/unit/tier scope of a spec point (T-C24/V39) — verbatim
   *  from the seeded store, null on every non-spec (or unscoped) node */
  applicability?: SpecPointApplicability | null;
  children: NodeView[];
}

/**
 * The canonical applicability object (T-KG-16 shape, served verbatim by core
 * since T-C24/V39). Deliberately loose: the store's business, not ours — the
 * known 4CH1 keys are mirrored, anything else passes through uninterpreted.
 */
export interface SpecPointApplicability {
  papers?: string[];
  unit_scope?: string | null;
  tier?: string | null;
  coursework?: boolean | null;
  double_award_shared?: boolean | null;
  rule?: string;
}

/** One question→spec-point mapping with the point's official scope (T-C24):
 *  PRIMARY first then SECONDARY, code-ordered — the order specPointCodes
 *  derives from, so the two views can never disagree. */
export interface SpecPointRef {
  code: string;
  role: string;
  applicability: SpecPointApplicability | null;
}

export interface PrerequisiteView {
  id: string;
  code: string;
  type: string;
  title: string;
  depth: number;
}

export interface OptionView {
  id: string;
  label: string;
  text: string;
}

export interface PartView {
  id: string;
  label: string;
  prompt: string;
  commandWord: string | null;
  marks: number;
}

export interface StudentQuestionView {
  id: string;
  externalRef: string | null;
  type: string;
  stem: string;
  marks: number;
  difficulty: number;
  expectedTimeSeconds: number;
  commandWord: string | null;
  primaryTopicNodeId: string;
  examPaperId: string | null;
  options: OptionView[];
  parts: PartView[];
  /** curriculum codes (PRIMARY first) — the question-help panel joins these
   *  to revision notes client-side (ADR-026); empty for unmapped questions */
  specPointCodes?: string[];
  /** the richer sibling of specPointCodes (T-C24): the same mappings with
   *  mapping role + the spec point's official applicability verbatim (null
   *  when unscoped) — paper/unit/tier scoping needs no second round trip */
  specPoints?: SpecPointRef[];
}

// ── Whole-question families (session-121 / core QuestionFamilyAssembler) ──

/** One WHOLE SME question as the learner meets it on a set page — the demo's
 *  serving unit, reassembled server-side by core so a part can never serve
 *  without its family (the "orphaned stimulus" defect). */
export interface QuestionFamilyView {
  /** stable identity: the family base ref (sme-eq-…-qN), row id otherwise */
  key: string;
  ref: string | null;
  marks: number;
  difficulty: number;
  type: "MCQ" | "STRUCTURED" | string;
  multi: boolean;
  /** member rows in SME part order (the first carries the shared stimulus) */
  parts: StudentQuestionView[];
}

// ── SME-style mark-scheme reveal (policy-gated learner surface) ──

// ── Servable-question taxonomy (session-112, mirrors core QuestionTopicTaxonomyView) ──

/** One browsable topic node with its servable-question census. The counts are
 *  REACHABLE counts (primary + secondary mappings, deduped) — a topic's
 *  questionCount is exactly the length of the list clicking it loads. */
export interface QuestionTaxonomyTopic {
  nodeId: string;
  code: string;
  title: string;
  questionCount: number;
  mcqCount: number;
  structuredCount: number;
}

/** One syllabus section (UNIT node) with its question-bearing topics. The
 *  distinctQuestionCount dedupes a question across the section's topics —
 *  summing the per-topic badges would double-count multi-topic questions. */
export interface QuestionTaxonomySection {
  nodeId: string;
  code: string;
  title: string;
  distinctQuestionCount: number;
  topics: QuestionTaxonomyTopic[];
}

/** GET /api/v1/questions/topics response — the exam-questions browser sidebar
 *  and the practice topic picker, both code-ordered server-side. The total
 *  counts each DISTINCT question once, however many topics it maps to. */
export interface QuestionTopicTaxonomyView {
  sections: QuestionTaxonomySection[];
  totalDistinctQuestions: number;
}

export interface MarkSchemePointView {
  ref: string | null;
  text: string;
  marks: number;
}

export interface MarkSchemePartScheme {
  partId: string;
  label: string | null;
  prompt: string | null;
  marks: number;
  points: MarkSchemePointView[];
}

export interface MarkSchemeRevealView {
  questionId: string;
  questionExternalRef: string | null;
  schemeId: string;
  validationState: "SUGGESTED" | "VALIDATED" | "REJECTED" | "FLAGGED";
  schemeMarks: number;
  questionMarks: number;
  parts: MarkSchemePartScheme[];
  generalPoints: MarkSchemePointView[];
}

export interface StructuredAttemptPartResult {
  partId: string;
  label: string;
  marksPossible: number;
  markingState: string;
  marksAwarded: number | null;
}

// ── SME-style self-mark (ADR-026 practice tranche, κ-excluded provenance) ──

export interface SelfMarkPartView {
  partId: string;
  label: string;
  marksAwarded: number;
  marksPossible: number;
  markingState: string;
}

export interface SelfMarkView {
  attemptId: string;
  marksAwarded: number;
  marksTotal: number;
  evidenceFired: boolean;
  parts: SelfMarkPartView[];
}

// ── Student Smart Mark (F-047 learner half: AI marking + Explain/Improve) ──

export interface SmartMarkPointDecision {
  ref: string | null;
  /** compact scheme-leak-safe label (first meaningful line of the point text) */
  pointLabel: string | null;
  /** marks the point is worth */
  marks: number;
  /** marks earned within the point — partial credit since pipeline 1.2.0 */
  marksAwarded: number;
  awarded: boolean;
  evidence: string;
  rationale: string;
}

export interface SmartMarkPartResult {
  partId: string;
  label: string;
  marksAwarded: number;
  marksPossible: number;
  markingState: string;
  /** κ release gate at marking time — true = marks drove mastery evidence */
  authoritative: boolean;
  confidence: number | null;
  modelId: string | null;
  validationPassed: boolean;
  failureReason: string | null;
  breakdown: SmartMarkPointDecision[];
}

export interface SmartMarkAttemptView {
  attemptId: string;
  questionId: string;
  schemeValidationState: "SUGGESTED" | "VALIDATED" | "REJECTED" | "FLAGGED";
  marksPossible: number;
  parts: SmartMarkPartResult[];
}

export interface SmartMarkFeedbackExplanation {
  partId: string;
  explanation: string;
  modelId: string | null;
  generatedAt: string;
}

export interface SmartMarkImprovementPlan {
  partId: string;
  plan: string;
  modelId: string | null;
  generatedAt: string;
}

export interface StructuredAttemptResultView {
  attemptId: string;
  questionId: string;
  marksPossible: number;
  markingState: string;
  submittedAt: string;
  parts: StructuredAttemptPartResult[];
}

export interface AttemptResultView {
  attemptId: string;
  questionId: string;
  correct: boolean;
  marksAwarded: number;
  marksTotal: number;
  correctOptionLabel: string | null;
  implicatedMisconceptionIds: string[];
  submittedAt: string;
}

export interface SkillStateView {
  nodeId: string;
  mastery: number;
  effectiveMastery: number;
  band: string;
  attempts: number;
  correctCount: number;
  lastPracticedAt: string;
  proceduralFluencyGap: number | null;
  /** Human KG title (P1: backend-resolved); null → callers fall back. */
  nodeName?: string | null;
}

export interface MisconceptionStateView {
  misconceptionNodeId: string;
  probability: number;
  active: boolean;
  evidenceCount: number;
  lastEvidenceAt: string;
  /** Human KG title (P1: backend-resolved); null → callers fall back. */
  misconceptionName?: string | null;
}

export interface ReviewView {
  nodeId: string;
  dueAt: string;
  reason: string;
  /** Human KG title (P1: backend-resolved); null → callers fall back. */
  nodeName?: string | null;
}

export interface LearnerStateView {
  learnerId: string;
  skillStates: SkillStateView[];
  misconceptionStates: MisconceptionStateView[];
  pendingReviews: ReviewView[];
  /** V21 (P7): topics the learner recently asked the Tutor about (last 30 days). */
  tutorEngagements?: TutorEngagementView[];
  /**
   * V47 (tranche 4.4): the learner's recent flashcard rating events
   * (newest first, capped at 50) — the self-report evidence class.
   * Optional: cores older than V47 serve the state view without it.
   */
  flashcardRatings?: FlashcardRatingView[];
}

/** One flashcard rating event (V47) — hub card id + the hub wire vocabulary. */
export interface FlashcardRatingView {
  cardId: string;
  /** "still-learning" | "know" */
  rating: string;
  /** echoes the deck anchor on the POST response; null on the state slice */
  subtopicCode: string | null;
  nodeId: string;
  occurredAt: string;
}

export interface TutorEngagementView {
  nodeId: string;
  /** Human KG title (backend-resolved); null → callers fall back to the graph/code. */
  nodeTitle?: string | null;
  asks: number;
  lastAskedAt: string;
  refusedAny: boolean;
}

export interface SubjectView {
  id: string;
  code: string;
  name: string;
  knowledgeNodeId: string | null;
}

// ── Tutor chat (T-025, mirrors the T-024 backend DTOs) ──

/** One verbatim source reference under a tutor answer ([n] markers, 1-based). */
export interface TutorCitation {
  index: number;
  label: string;
  sourceType: string;
  documentId: string | null;
  page: number | null;
  nodeId: string | null;
  deepLink: string;
}

/** A curriculum topic the intent matcher selected for the question. */
export interface TutorTopicMatch {
  code: string;
  title: string;
  matchScore: number;
}

/** POST /api/v1/tutor/ask response (T-024 TutorAnswerView). */
export interface TutorAnswerView {
  answer: string;
  citations: TutorCitation[];
  topics: TutorTopicMatch[];
  evidenceCount: number;
  model: string | null;
  provider: string;
  refused: boolean;
  latencyMs: number;
}

/**
 * One prior chat turn sent back with a follow-up ask (s139 working memory).
 * The transcript stays client-held: it rides the request, the backend never
 * persists it, and the server sanitizes it (role whitelist, marker strip,
 * turn/list caps) before it reaches retrieval or the prompt.
 */
export interface TutorHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

// ── Tutor sessions (s140, Spec §22 — mirrors the TutorSessionService DTOs) ──

/** One stored transcript turn; assistant turns carry the §19 traceability
 *  footer fields so a hydrated chat renders exactly what the live answer
 *  showed (citations stay in the research telemetry — restored prose only). */
export interface TutorSessionTurnView {
  seq: number;
  role: "user" | "assistant";
  content: string;
  evidenceCount: number;
  refused: boolean;
  model: string | null;
  provider: string | null;
  latencyMs: number | null;
  at: string;
}

/** GET /api/v1/tutor/sessions/{id} — the caller's own transcript. */
export interface TutorSessionView {
  sessionId: string;
  createdAt: string;
  lastActiveAt: string;
  turns: TutorSessionTurnView[];
}

/** POST /api/v1/tutor/sessions response. */
export interface TutorSessionCreated {
  sessionId: string;
  createdAt: string;
}

/**
 * One row of GET /api/v1/tutor/sessions (s143) — the learner's conversation
 * list, most recently active first. The title is derived server-side from
 * the opening question (null = an empty chat); the transcript itself is a
 * separate per-conversation fetch.
 */
export interface TutorSessionSummary {
  sessionId: string;
  createdAt: string;
  lastActiveAt: string;
  turnCount: number;
  title: string | null;
}

// ── Personalized knowledge graph (T-028, mirrors the F-034 backend DTOs) ──

/** KG node + THIS learner's annotations (null = honest "not practised / no signal"). */
export interface LearnerNodeWithStateView {
  id: string;
  code: string;
  type: string;
  title: string;
  description: string | null;
  childIds: string[];
  mastery: number | null;
  effectiveMastery: number | null;
  band: string | null;
  attempts: number | null;
  correctCount: number | null;
  lastPracticedAt: string | null;
  proceduralFluencyGap: number | null;
  reviewDueAt: string | null;
  reviewReason: string | null;
  misconceptionProbability: number | null;
  misconceptionActive: boolean | null;
  /** official paper/unit/tier scope, verbatim from core (T-C28) — present on
   *  spec-point nodes only; null on every other node. Curriculum metadata, not
   *  learner state: render it or omit it, never derive it. */
  applicability?: SpecPointApplicability | null;
}

/** A drawable prerequisite edge: prerequisiteId → nodeId (which requires it). */
export interface LearnerPrerequisiteEdgeView {
  prerequisiteId: string;
  prerequisiteCode: string;
  nodeId: string;
  nodeCode: string;
}

/** GET /api/v1/learners/me/knowledge-graph response (F-034). */
// Smart Lesson MVP (productization sprint §2): ONE explainable next action
// for a selected topic — deterministic, evidence-gated, closed-loop.
export interface SmartLessonView {
  learnerId: string;
  rootId: string;
  topicNodeId: string;
  topicCode: string | null;
  topicTitle: string | null;
  asOf: string;
  policy: string;
  action: SmartLessonActionView;
  topicStatus: SmartLessonTopicStatusView;
  prerequisites: SmartLessonPrerequisiteStatusView[];
  misconceptions: SmartLessonMisconceptionStatusView[];
  evidence: SmartLessonEvidenceFactView[];
}

export interface SmartLessonActionView {
  actionType: string;
  reasonCode: string;
  targetNodeId: string;
  targetCode: string | null;
  targetTitle: string | null;
  questionId: string | null;
  servableQuestionCount: number;
  reasonDetail: string;
}

export interface SmartLessonTopicStatusView {
  coverage: string;
  attempts: number;
  mastery: number | null;
  effectiveMastery: number | null;
  reviewDue: boolean;
  strongestMisconceptionProbability: number | null;
  fluencyGap: number | null;
  tutorAsks: number;
  servableQuestions: number;
}

export interface SmartLessonEvidenceFactView {
  key: string;
  value: string;
}

export interface SmartLessonPrerequisiteStatusView {
  nodeId: string;
  code: string | null;
  title: string | null;
  effectiveMastery: number | null;
  attempts: number | null;
  measuredWeak: boolean;
}

export interface SmartLessonMisconceptionStatusView {
  nodeId: string;
  code: string | null;
  title: string | null;
  probability: number | null;
  active: boolean;
  remediationNodeCode: string | null;
}

export interface LearnerKnowledgeGraphView {
  learnerId: string;
  rootId: string;
  rootCode: string;
  rootTitle: string;
  asOf: string;
  nodes: LearnerNodeWithStateView[];
  prerequisiteEdges: LearnerPrerequisiteEdgeView[];
}

// ── T-029 teacher review surface (mirrors core TeacherViews) ──

export interface TeacherLearnerView {
  id: string;
  displayName: string;
  email: string;
  createdAt: string;
}

export interface SmartMarkBreakdownItem {
  markPointId?: string;
  awarded?: boolean;
  [key: string]: unknown;
}

export interface SmartMarkView {
  id: string;
  pipelineVersion: string | null;
  modelId: string | null;
  marksAwarded: number;
  confidence: number | null;
  validationPassed: boolean;
  failureReason: string | null;
  breakdown: SmartMarkBreakdownItem[];
  createdAt: string;
}

export interface HumanMarkView {
  id: string;
  markerId: string;
  marksAwarded: number;
  perPointDecisions: Record<string, number> | null;
  comments: string | null;
  createdAt: string;
}

export interface AnswerMarkingView {
  answerId: string;
  attemptId: string;
  learnerId: string;
  learnerDisplayName: string | null;
  questionId: string;
  questionExternalRef: string | null;
  partLabel: string;
  partPrompt: string;
  partMarks: number;
  answerText: string;
  markingState: string;
  marksAwarded: number | null;
  latestSmartMark: SmartMarkView | null;
  latestHumanMark: HumanMarkView | null;
  /** G-5: paper context (nullable — SME question-bank answers have no paper row) */
  examPaperId: string | null;
  paperTitle: string | null;
}

/** G-5: the opt-in paged marking-queue envelope — returned only when page/size params are sent */
export interface AnswerMarkingPageView {
  items: AnswerMarkingView[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface KappaEvaluationView {
  id: string;
  scope: string;
  paperId: string | null;
  sampleSize: number;
  kappa: number;
  observedAgreement: number;
  threshold: number;
  passed: boolean;
  computedAt: string;
}

// ── Attempt history (Review Hub minimal slice, mirrors core AttemptHistoryView) ──

/** One written part of a structured attempt: labels and mark outcome only. */
export interface AttemptHistoryPartView {
  partId: string;
  label: string;
  marksPossible: number;
  marksAwarded: number | null;
  markingState: string;
}

/** One past attempt — a read over the immutable evidence rows. */
export interface AttemptHistoryItem {
  attemptId: string;
  questionId: string;
  questionType: string;
  externalRef: string | null;
  commandWord: string | null;
  stemExcerpt: string;
  marksTotal: number;
  topicNodeId: string;
  topicCode: string | null;
  topicTitle: string | null;
  /** null for structured attempts pending authoritative marking */
  correct: boolean | null;
  /** null while marking is pending */
  marksAwarded: number | null;
  markingState: string;
  evidenceEmitted: boolean;
  chosenOptionLabel: string | null;
  correctOptionLabel: string | null;
  implicatedMisconceptionIds: string[];
  selfDoubtFlag: boolean;
  timedCondition: boolean;
  confidenceLevel: number | null;
  responseTimeMs: number;
  attemptedAt: string;
  parts: AttemptHistoryPartView[];
}

/** GET /api/v1/learners/me/attempts response. */
export interface AttemptHistoryView {
  learnerId: string;
  total: number;
  returned: number;
  attempts: AttemptHistoryItem[];
}

// ── T-033: next-best-learning-action read model (ADR-017 nba-rules/v1) ──

export type NextBestActionType =
  | "REVIEW_TOPIC"
  | "PRACTISE_QUESTIONS"
  | "REVIEW_PREREQUISITE"
  | "RETRY_PROBLEM_QUESTION"
  | "ASK_TUTOR"
  | "TIMED_EXERCISE"
  | "REMEDIATE_MISCONCEPTION";

export type NextBestReasonCode =
  | "DUE_REVIEW"
  | "PREREQUISITE_WEAK"
  | "VALIDATED_PREREQUISITE_CHAIN"
  | "PROBLEM_QUESTION"
  | "MISCONCEPTION_SUSPECTED"
  | "MISCONCEPTION_REMEDIATION"
  | "FLUENCY_GAP"
  | "LOW_MASTERY"
  | "UNCOVERED_TOPIC";

/** One ranked, evidence-backed learning action. Advice derived from measured
 *  evidence — deliberately distinct from the dashboard's measured-fact cards. */
export interface NextBestActionView {
  rank: number;
  actionType: NextBestActionType;
  reasonCode: NextBestReasonCode;
  targetNodeId: string;
  targetCode: string;
  targetTitle: string;
  /** present only for RETRY_PROBLEM_QUESTION */
  questionId: string | null;
  /** validated questions currently mapped to the target topic (0 ⇒ honest empty state) */
  servableQuestionCount: number;
  /** deterministic, evidence-derived explanation (never an invented claim) */
  reasonDetail: string;
}

export interface NextBestActionsView {
  learnerId: string;
  rootId: string;
  asOf: string;
  policy: string;
  actions: NextBestActionView[];
}

/** ── Teacher concept graph (V15): the seeded 4CH1 curriculum + settled T-C11 layer ── */

/** Result of POST /api/v1/teacher/concept-graph/activate — deterministic, idempotent. */
export interface ConceptGraphSeedSummary {
  curriculumVersionId: string;
  subjectId: string;
  rootNodeId: string;
  sections: number;
  subsections: number;
  specPoints: number;
  practicals: number;
  conceptNodes: number;
  validatedSemanticEdges: number;
  nodesCreated: number;
  nodesReused: number;
  edgesCreated: number;
  edgesReused: number;
  alreadyActive: boolean;
}

/** A node referenced from a semantic edge (id + display identity + status). */
export interface ConceptGraphNodeRef {
  nodeId: string;
  code: string;
  title: string;
  nodeType: string;
  validationStatus: string;
}

/** One graph-derived conceptual relationship (prerequisite, remediation, …).
 *  Distinct from the official curriculum anchor: the relation and provenance
 *  keep the graph's T-C11 origin visible. */
export interface ConceptGraphEdgeView {
  source: ConceptGraphNodeRef;
  target: ConceptGraphNodeRef;
  relation: string;
  validationStatus: string;
  provenance: string | null;
  rationale: string | null;
}

export interface ConceptGraphEdgesView {
  rootId: string;
  rootCode: string;
  policy: string;
  edges: ConceptGraphEdgeView[];
}

/** ── Teacher content validation (Master Spec §7) + learner papers browsing ── */

/** A paper in the teacher validation queue (POST-ingest everything is SUGGESTED). */
export interface TeacherPaperSummary {
  id: string;
  subjectId: string | null;
  title: string;
  paperCode: string | null;
  sessionLabel: string | null;
  board: string | null;
  qualification: string | null;
  validationState: string;
}

/**
 * V20 enriched queue entry: the same SUGGESTED paper plus the quality signals a
 * reviewer triages by (progress, bridge reconciliation, parser findings, mean
 * extraction confidence). Server-sorted strongest-candidates-first.
 */
export interface TeacherEnrichedPaperSummary extends TeacherPaperSummary {
  versionCount: number;
  validatedVersions: number;
  rejectedVersions: number;
  flaggedVersions: number;
  suggestedSchemes: number;
  reconciliationStatus: string | null;
  findingCount: number;
  avgExtractionConfidence: number | null;
  createdAt: string;
}

export interface TeacherEnrichedReviewQueueView {
  papers: TeacherEnrichedPaperSummary[];
  suggestedVersions: number;
  suggestedSchemes: number;
}

/**
 * Sprint-2 §7 review-queue v3: the v2 signals plus the reviewability and
 * value signals a reviewer triages by (scheme linkage, curriculum mapping,
 * novel coverage) and the human-legible rank reasons. Server-sorted
 * deterministically — ordering is a triage aid, never a promotion.
 */
export interface TeacherEnrichedPaperSummaryV3 extends TeacherEnrichedPaperSummary {
  totalQuestions: number;
  mappedQuestions: number;
  questionsWithScheme: number;
  novelTopicCount: number;
  rankReasons: string[];
}

export interface TeacherEnrichedReviewQueueViewV3 {
  papers: TeacherEnrichedPaperSummaryV3[];
  suggestedVersions: number;
  suggestedSchemes: number;
  practicableTopicCount: number;
}

/** ── Sprint-2 §6/§7 marking throughput lane ── */

/** one paper group in the deterministic marking queue (one mark scheme in working memory). */
export interface MarkingGroupView {
  paperId: string;
  paperTitle: string | null;
  sessionLabel: string | null;
  paperCode: string | null;
  count: number;
  oldestPendingAt: string;
  oldestWaitingHours: number | null;
}

/** a queue item: the marking view plus paper context and the mark→next link. */
export interface MarkingQueueItem {
  answer: AnswerMarkingView;
  paperId: string | null;
  paperTitle: string | null;
  sessionLabel: string | null;
  paperCode: string | null;
  evidenceEmitted: boolean;
  nextAnswerId: string | null;
}

export interface MarkingQueueView {
  state: string;
  groups: MarkingGroupView[];
  items: MarkingQueueItem[];
}

/** G-5: the opt-in paged queue-v2 envelope — returned only when page/size params are sent; whole paper groups per page */
export interface MarkingQueuePageView {
  state: string;
  groups: MarkingGroupView[];
  items: MarkingQueueItem[];
  page: number;
  size: number;
  totalGroups: number;
  totalItems: number;
  totalPages: number;
}

export interface PendingPaperView {
  paperId: string;
  paperTitle: string | null;
  paperCode: string | null;
  pending: number;
}

/** throughput metrics — counts of what happened, never estimates. */
export interface MarkingThroughputView {
  answersByState: Record<string, number>;
  humanMarks24h: number;
  humanMarks7d: number;
  pendingByPaper: PendingPaperView[];
  oldestPendingAt: string | null;
  oldestPendingHours: number | null;
}

export interface SmartMarkBatchItem {
  answerId: string;
  outcome: "MARKED" | "FAILED" | "SKIPPED_ALREADY_MARKED";
  marksAwarded: number | null;
  reason: string | null;
}

export interface SmartMarkBatchView {
  requested: number;
  marked: number;
  skipped: number;
  failed: number;
  items: SmartMarkBatchItem[];
}

export interface TeacherReviewQueueView {
  papers: TeacherPaperSummary[];
  suggestedVersions: number;
  suggestedSchemes: number;
}

/** One parser/bridge review finding (reconciliation + warnings) for a paper. */
export interface TeacherFindingView {
  source: string | null;
  severity: string | null;
  detail: string | null;
  [key: string]: unknown;
}

/** Result of POST .../exam-papers/{id}/validate-all (BatchResult). */
export interface TeacherValidateAllResult {
  paperId: string;
  paperState: string;
  totalVersions: number;
  versionsValidated: number;
  schemesValidated: number;
}

/** §10 topic mapping: result of POST .../questions/{id}/topics. */
export interface TeacherTopicMappingResult {
  questionId: string;
  primaryNodeId: string;
  primaryCode: string;
  primaryTitle: string;
  topicCount: number;
}

/** One row of a question's current topic mapping (GET .../questions/{id}/topics). */
export interface TeacherTopicRowView {
  nodeId: string;
  primary: boolean;
  code: string | null;
  title: string | null;
}

/** Teacher-only: the deterministic marking contract per mark point. */
export interface TeacherPointReview {
  id: string;
  ref: string | null;
  text: string;
  marks: number;
  acceptanceCriteria: string[];
}

/** Teacher-only: includes the correct flag and the misconception a distractor feeds. */
export interface TeacherOptionReview {
  id: string;
  label: string;
  text: string;
  correct: boolean;
  misconceptionNodeId: string | null;
}

export interface TeacherPartReview {
  id: string;
  label: string;
  prompt: string;
  commandWord: string | null;
  marks: number;
}

/** One question version with its full review payload (content + answer key + scheme). */
export interface TeacherVersionReview {
  versionId: string;
  questionId: string;
  externalRef: string | null;
  type: string;
  stem: string;
  marks: number;
  version: number;
  validationState: string;
  commandWord: string | null;
  schemeId: string | null;
  schemeState: string | null;
  points: TeacherPointReview[];
  options: TeacherOptionReview[];
  parts: TeacherPartReview[];
  extractionConfidence: number | null;
  extractionMethod: string | null;
  sourceDocumentId: string | null;
}

export interface TeacherPaperReviewView {
  paper: {
    id: string;
    subjectId: string | null;
    title: string;
    paperCode: string | null;
    sessionLabel: string | null;
    board: string | null;
    qualification: string | null;
    validationState: string;
  };
  versions: TeacherVersionReview[];
}

/** Result of POST .../question-versions/{id}/validate|reject (VersionSummary). */
export interface TeacherVersionActionResult {
  id: string;
  questionId: string;
  version: number;
  validationState: string;
}

/** Result of POST .../mark-schemes/{id}/validate|reject (SchemeSummary). */
export interface TeacherSchemeActionResult {
  id: string;
  questionVersionId: string;
  pointCount: number;
  validationState: string;
}

/** Learner-facing paper metadata (no question content — serving stays gated). */
export interface ExamPaperBrowseView {
  id: string;
  /** subject scoping (null = unassigned) — lets surfaces split papers by subject */
  subjectId: string | null;
  title: string;
  board: string | null;
  qualification: string | null;
  unit: string | null;
  sessionLabel: string | null;
  paperCode: string | null;
  validationState: string;
  provenance: string;
  questionPaperDocumentId: string | null;
  markSchemeDocumentId: string | null;
}

export interface ExamPaperQuestionMeta {
  questionId: string;
  externalRef: string | null;
  marks: number;
  provenance: string;
  versionValidationState: string | null;
  partCount: number;
  currentVersionId: string | null;
  /** rich spec-point refs from the SHARED projection (T-C28): PRIMARY first
   *  then SECONDARY, code-ordered; empty for unmapped questions — honest
   *  absence, never synthesized. */
  specPoints?: SpecPointRef[];
}

export interface ExamPaperDetailView {
  paper: ExamPaperBrowseView;
  questions: ExamPaperQuestionMeta[];
}

// ── P9 Test Builder (mirrors core TestBuilderService.TestPreviewView) ──

/** V22: one durable audit row (who decided what, when, from/to states) */
export interface TeacherAuditRowView {
  occurredAt: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  fromState: string | null;
  toState: string | null;
  detail: string;
}

export interface TestPreviewView {
  rootId: string;
  questionCount: number;
  totalMarks: number;
  targetMarks: number | null;
  topics: TestTopicCoverage[];
  questions: TestQuestionView[];
}

export interface TestTopicCoverage {
  topicNodeId: string;
  code: string;
  title: string;
  servableQuestions: number;
}

// ── sprint-2 §10: class-weakness targeting (mirrors core
// TestBuilderService.WeaknessOptionsView) ──

/** one weak class area — explicit reasons + raw aggregates, no synthetic score */
export interface WeakTopicOption {
  topicNodeId: string;
  code: string;
  title: string;
  reasons: string[]; // LOW_MEAN_MASTERY | ACTIVE_MISCONCEPTION_PRESENT | BLOCKED_BY_WEAK_PREREQUISITE
  learnersMeasured: number;
  meanMastery: number | null;
  masteryBand: string;
  learnersWithActiveMisconception: number;
  activeMisconceptionSignals: number;
  evidenceBackedAttempts: number;
  tutorEngagements: number;
  dueReviews: number;
  servableQuestions: number;
  blockedByPrerequisiteCodes: string[];
}

/** an unmeasured topic with servable content + class activity — honest gap, never weak */
export interface CoverageGapView {
  topicNodeId: string;
  code: string;
  title: string;
  servableQuestions: number;
  evidenceBackedAttempts: number;
  tutorEngagements: number;
}

export interface WeaknessOptionsView {
  rootId: string;
  policy: string;
  enrolledLearners: number;
  learnersWithEvidence: number;
  weakTopics: WeakTopicOption[];
  coverageGaps: CoverageGapView[];
  selectionHint: string;
}

export interface TestQuestionView {
  id: string;
  type: string;
  stem: string;
  marks: number;
  commandWord: string | null;
  difficulty: number;
  topicCode: string | null;
  parts: { id: string; label: string; prompt: string; commandWord: string | null; marks: number }[];
  options: { id: string; label: string; text: string }[];
  answers: TestAnswerView[];
  schemeState: string | null;
}

export interface TestAnswerView {
  partLabel: string | null;
  ref: string | null;
  text: string;
  marks: number;
  acceptanceCriteria: string[];
}

// ── Teacher class intelligence (productization sprint 2 §2–§5; mirrors core
// ClassAnalyticsService view records; policy class-analytics/v1) ──

/** One heatmap cell: topic × class evidence and mastery (null = unmeasured). */
export interface ClassTopicAggregate {
  nodeId: string;
  code: string;
  title: string;
  parentCode: string | null;
  parentTitle: string | null;
  learnersMeasured: number;
  meanMastery: number | null;
  masteryBand: "LOW" | "DEVELOPING" | "SECURE" | "UNMEASURED";
  evidenceBackedAttempts: number;
  learnersWithActiveMisconception: number;
  activeMisconceptionSignals: number;
  tutorEngagements: number;
  dueReviews: number;
  servableQuestions: number;
}

/** A prerequisite the class measures weak, with the dependents that need it. */
export interface ClassWeakPrerequisite {
  prerequisiteNodeId: string;
  prerequisiteCode: string;
  prerequisiteTitle: string;
  learnersMeasured: number;
  meanMastery: number | null;
  masteryBand: string;
  dependents: { nodeId: string; code: string; title: string; meanMastery: number | null }[];
}

export interface ClassRecentActivity {
  recentAttempts: number;
  learnersActive: number;
  tutorAsks: number;
  structuredAnswersPendingMarking: number;
  windowStart: string;
}

export interface ClassOverviewView {
  rootId: string;
  rootCode: string;
  policy: string;
  enrolledLearners: number;
  learnersWithEvidence: number;
  learnersRecentlyActive: number;
  totalTopics: number;
  measuredTopics: number;
  topics: ClassTopicAggregate[];
  weakPrerequisites: ClassWeakPrerequisite[];
  recentActivity: ClassRecentActivity;
}

/** One learner row — evidence kinds stay separated; nulls mean unmeasured. */
export interface ClassLearnerRow {
  learnerId: string;
  displayName: string;
  createdAt: string;
  evidenceState: "MEASURED" | "UNMEASURED";
  topicsMeasured: number;
  meanMastery: number | null;
  evidenceBackedAttempts: number;
  recentAttempts: number;
  recentCorrect: number;
  lastActivityAt: string | null;
  weakestTopics: {
    nodeId: string;
    code: string;
    title: string;
    mastery: number;
    band: string;
    attempts: number;
  }[];
  activeMisconceptions: number;
  misconceptionSignals: {
    misconceptionNodeId: string;
    code: string;
    title: string;
    probability: number;
    evidenceCount: number;
    parentTopicNodeId: string | null;
    parentTopicCode: string | null;
  }[];
  tutorEngagements: number;
  tutorSignalCounts: Record<string, number>;
  lastTutorEngagementAt: string | null;
  dueReviews: number;
}

/** §5 drill-down: class → topic → learners → evidence → intervention. */
export interface ClassTopicDrillDown {
  rootId: string;
  topic: ClassTopicAggregate;
  prerequisiteChain: {
    nodeId: string;
    code: string;
    title: string;
    depth: number;
    learnersMeasured: number;
    meanMastery: number | null;
    masteryBand: string;
  }[];
  affectedLearners: {
    learnerId: string;
    displayName: string;
    mastery: number | null;
    reason: "LOW_MASTERY" | "ACTIVE_MISCONCEPTION" | "LOW_MASTERY_AND_ACTIVE_MISCONCEPTION";
    misconceptions: {
      misconceptionNodeId: string;
      code: string;
      title: string;
      probability: number;
      evidenceCount: number;
      parentTopicNodeId: string | null;
      parentTopicCode: string | null;
    }[];
  }[];
  representativeEvidence: {
    attemptId: string;
    learnerId: string;
    learnerDisplayName: string;
    questionId: string;
    questionRef: string | null;
    correct: boolean;
    marksAwarded: number | null;
    questionMarks: number;
    markingState: string;
    createdAt: string;
  }[];
  servableQuestions: {
    id: string;
    externalRef: string;
    type: string;
    marks: number;
    difficulty: number;
  }[];
}

// ── Contextual Learning Assistant (CLA contract §1–§7; core ClaAnswerView) ──

/** The four explicit response modes (contract §3). HINT/CHECK are attempt-aware. */
export type ClaMode = "EXPLAIN" | "SUMMARIZE" | "HINT" | "CHECK";

/** SMART_LESSON context: the learner's own deterministic lesson next-action (smart-lesson/v2 ladder). */
export interface ClaLessonActionView {
  actionType: string;
  reasonCode: string;
  targetNodeId: string | null;
  targetCode: string | null;
  targetTitle: string | null;
  reasonDetail: string | null;
  servableQuestionCount: number;
}

/** Resolved-context summary — exactly what the SERVER resolved, never client-asserted. */
export interface ClaContextView {
  kind:
    | "KG_TOPIC"
    | "PAST_PAPER_QUESTION"
    | "QUESTION_PART"
    | "SPECIFICATION_POINT"
    | "SMART_LESSON"
    | "NOTE_SECTION";
  reference: string;
  topicNodeId: string | null;
  rootId: string | null;
  subjectCode: string;
  topicCode: string;
  topicTitle: string;
  curriculumVersion: string;
  curriculumBoard: string | null;
  curriculumQualification: string | null;
  validationState: string;
  mode: ClaMode;
  questionStem: string | null;
  questionCommandWord: string | null;
  questionMarks: number;
  paperCode: string | null;
  attempted: boolean | null;
  partLabel: string | null;
  /** SMART_LESSON only: the learner's own deterministic lesson next-action */
  lessonAction: ClaLessonActionView | null;
  /** NOTE_SECTION only: the resolved revision note the learner is reading */
  noteId: string | null;
  noteTitle: string | null;
}

/** Citation mirror of the Tutor citation (resolved, verbatim label + deep link). */
export interface ClaCitation {
  index: number;
  label: string;
  sourceType: string;
  documentId: string | null;
  page: number | null;
  nodeId: string | null;
  deepLink: string | null;
}

/** Audit trace of one read-only tool invocation (contract §4.4 — no output text). */
export interface ClaToolTraceView {
  tool: string;
  args: string;
  resultSize: number;
  latencyMs: number;
}

export interface ClaTopicAnchorView {
  code: string;
  title: string;
  matchScore: number;
}

/** POST /api/v1/learners/me/cla/ask response. */
export interface ClaAnswerView {
  answer: string;
  citations: ClaCitation[];
  context: ClaContextView;
  topics: ClaTopicAnchorView[];
  evidenceCount: number;
  model: string | null;
  provider: string;
  refused: boolean;
  latencyMs: number;
  tools: ClaToolTraceView[];
}

// ── Revision notes (SME-style corpus; learner-scoped; authenticated-only) ──

export interface RevisionNoteMetaView {
  noteId: string;
  title: string;
  order: number;
  specPointCodes: string[];
}

export interface RevisionNoteSubtopicView {
  order: number;
  title: string;
  noteCount: number;
  notes: RevisionNoteMetaView[];
}

export interface RevisionNoteTopicView {
  order: number;
  title: string;
  subtopics: RevisionNoteSubtopicView[];
}

/** One learner's "opened this note" marker — drives the per-subtopic rings. */
export interface RevisionNoteViewedView {
  noteId: string;
  viewedAt: string;
}

/** Full tree + the caller's viewed markers in one response. */
export interface RevisionNotesIndexView {
  corpusVersion: string | null;
  ingestedAt: string | null;
  topics: RevisionNoteTopicView[];
  viewed: RevisionNoteViewedView[];
}

export interface RevisionNoteBodyView {
  noteId: string;
  title: string;
  bodyMd: string;
  specMapJson: string;
  sourceUrl: string | null;
  assets: string[];
  prevNoteId: string | null;
  nextNoteId: string | null;
}
