/**
 * SyllabAI API client.
 *
 * Routing:
 * - Production (Vercel): `NEXT_PUBLIC_API_BASE_URL` points at the Spring Boot
 *   service on Render (e.g. https://syllabai-core.onrender.com) — absolute URLs.
 * - Sandbox preview: relative URLs with `XTransformPort` query, which the Caddy
 *   gateway forwards to the Java backend on port 8080.
 *
 * The bearer token is kept in localStorage for the v0 pilot (httpOnly-cookie
 * hardening is tracked for Wave 4).
 *
 * Free-tier resilience (Render spins the core down after 15 min idle; a wake
 * is a full JVM + Spring boot):
 * - identical in-flight GETs are de-duplicated (one network round-trip);
 * - a GET that dies with a network error (the wake occasionally drops the
 *   first connection) is retried once before surfacing an error;
 * - requests slower than 3 s (and not preceded by a recent success) emit
 *   `syllabai:backend-waking` so the UI can say what is happening instead of
 *   spinning silently; every success emits `syllabai:backend-ok`;
 * - content GETs (subjects, tree, questions, papers) read through the
 *   localStorage cache in ./api-cache — repeat visits never wake the
 *   backend at all;
 * - `wakeBackend()` fires ONE unauthenticated health request per browser
 *   session when a human lands on the login screen, so the boot happens
 *   while they type credentials. It is a single request tied to a real page
 *   view — deliberately NOT a keep-alive pinger: pinging a free Render
 *   service on a timer to defeat spin-down violates their Terms of Service
 *   and risks account suspension.
 */
import { cachedGet, invalidateContentCache, singleFlight } from "./api-cache";
import type {
  AttemptHistoryView,
  ClaAnswerView,
  ClaMode,
  FlashcardRatingView,
  TeacherAuditRowView,
  AuthResponse,
  AnswerMarkingView,
  AttemptResultView,
  ConceptGraphEdgesView,
  ConceptGraphSeedSummary,
  CourseStatsView,
  NoteVoteView,
  AssignmentRosterView,
  AssignmentSummaryView,
  AssignmentSubmissionView,
  AssignmentView,
  ExamPaperBrowseView,
  ExamPaperDetailView,
  HumanMarkView,
  KappaEvaluationView,
  LearnerAssignmentView,
  LearnerKnowledgeGraphView,
  LearnerStateView,
  NextBestActionsView,
  NodeView,
  PrerequisiteView,
  QuestionTopicTaxonomyView,
  SmartLessonView,
  SmartMarkView,
  SelfMarkView,
  SmartMarkAttemptView,
  SmartMarkFeedbackExplanation,
  SmartMarkImprovementPlan,
  StudentQuestionView,
  StructuredAttemptResultView,
  SubjectView,
  TeacherEnrichedReviewQueueView,
  TeacherEnrichedReviewQueueViewV3,
  TeacherFindingView,
  TeacherLearnerView,
  MarkingQueuePageView,
  MarkingQueueView,
  MarkingThroughputView,
  SmartMarkBatchView,
  TeacherPaperReviewView,
  TeacherPaperSummary,
  TeacherReviewQueueView,
  TeacherSchemeActionResult,
  TeacherTopicMappingResult,
  TeacherTopicRowView,
  TeacherValidateAllResult,
  TeacherVersionActionResult,
  ClassLearnerRow,
  ClassOverviewView,
  ClassTopicDrillDown,
  TestPreviewView,
  WeaknessOptionsView,
  TutorAnswerView,
  TutorHistoryTurn,
  TutorSessionCreated,
  TutorSessionSummary,
  TutorSessionView,
  RevisionNoteBodyView,
  RevisionNotesIndexView,
  MarkSchemeRevealView,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";
const TOKEN_KEY = "syllabai.token";
const USER_KEY = "syllabai.user";

export function apiPath(path: string): string {
  // path arrives like "/api/v1/auth/login" or ".../tree?includeMisconceptions=true".
  // API_BASE is documented as the bare API origin (e.g. https://syllabai-core.onrender.com),
  // but a trailing /api/v1 (as older deployment notes described) must not double the
  // prefix — normalize it away so both operator conventions produce identical URLs.
  const base = API_BASE.replace(/\/api\/v1$/, "");
  return base
    ? `${base}${path}`
    : `${path}${path.includes("?") ? "&" : "?"}XTransformPort=8080`;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setSession(auth: AuthResponse) {
  window.localStorage.setItem(TOKEN_KEY, auth.accessToken);
  window.localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export function currentUser(): { id: string; email: string; displayName: string; roles: string[] } | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    // Shape-check, don't just parse: a truncated or old-schema payload that
    // still parses (a string, an object without roles) would otherwise flow
    // into auth.user.roles.some(...) and white-screen the app on every visit
    // until storage is cleared manually. A bad payload restores as no session.
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { id?: unknown }).id !== "string" ||
      typeof (parsed as { email?: unknown }).email !== "string" ||
      typeof (parsed as { displayName?: unknown }).displayName !== "string" ||
      !Array.isArray((parsed as { roles?: unknown }).roles) ||
      !(parsed as { roles: unknown[] }).roles.every((r) => typeof r === "string")
    ) {
      clearSession();
      return null;
    }
    return parsed as { id: string; email: string; displayName: string; roles: string[] };
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Honest degradation for AI-ask failures (session-136): when the backend's
 * LLM failover chain has no working provider (exhausted quota/credits, dead
 * key), every ask surfaces as a bare 500 "an internal error occurred" — a
 * string that tells a learner nothing. This maps 5xx asks to what is
 * actually true: AI generation is down server-side; everything else keeps
 * working. 4xx keeps the server's own message — those are honest by design
 * (404 unresolvable spec point, 409 attempt_required, 400 validation).
 */
export function aiAskErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status >= 500) {
    return "AI answers are temporarily unavailable on the server — your notes, practice and history all keep working. Please try asking again in a little while.";
  }
  return err instanceof ApiError && err.message ? err.message : fallback;
}

// ── backend-waking signals ─────────────────────────────────────────────
// A request >3 s with no success in the last 60 s is almost certainly a
// Render cold boot (or a network hiccup pretending to be one). The page
// subscribes to these events and shows an honest "waking up" banner
// instead of a silent spinner. Throttled so a slow burst of parallel boot
// calls cannot spam the UI.
const WAKING_EVENT = "syllabai:backend-waking";
const OK_EVENT = "syllabai:backend-ok";
const SLOW_AFTER_MS = 3_000;
const WAKE_EVENT_COOLDOWN_MS = 30_000;
const WARM_WINDOW_MS = 60_000;
let lastOkAt = 0;
let lastWakingEventAt = 0;

function fireWaking(): void {
  const now = Date.now();
  if (now - lastOkAt < WARM_WINDOW_MS) return; // recently warm — not a cold boot
  if (now - lastWakingEventAt < WAKE_EVENT_COOLDOWN_MS) return;
  lastWakingEventAt = now;
  window.dispatchEvent(new Event(WAKING_EVENT));
}

function fireOk(): void {
  lastOkAt = Date.now();
  window.dispatchEvent(new Event(OK_EVENT));
}

/**
 * ONE unauthenticated GET /actuator/health per browser session, fired when a
 * human being lands on the login screen. With the core's eager Spring init,
 * Tomcat only accepts connections after Flyway + Hibernate are up — so a
 * health response means the login POST that follows lands on a fully warm
 * server. Guarded by sessionStorage; failures swallowed by design. This is
 * user-triggered prefetch, NOT a keep-alive pinger (Render ToS: services
 * kept perpetually awake by uptime pingers risk suspension — do not turn
 * this into a timer).
 */
export function wakeBackend(): void {
  if (typeof window === "undefined") return;
  const GUARD = "syllabai.wake-pinged";
  try {
    if (sessionStorage.getItem(GUARD) === "1") return;
    sessionStorage.setItem(GUARD, "1");
  } catch {
    return; // storage blocked — skip the ping rather than risk repeats
  }
  void fetch(apiPath("/actuator/health"), { method: "GET", cache: "no-store" }).then(
    () => {
      lastOkAt = Date.now();
    },
    () => {
      /* the wake ping is best-effort; the login POST will trigger the boot anyway */
    },
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiPath(path);
  const isGet = !init?.method || init.method === "GET";
  // Identical in-flight GETs share one request (StrictMode double-mounts,
  // concurrent boot calls while the backend is cold).
  if (isGet) return singleFlight(url, () => doRequest<T>(path, url, init));
  return doRequest<T>(path, url, init);
}

async function doRequest<T>(path: string, url: string, init?: RequestInit): Promise<T> {
  const isGet = !init?.method || init.method === "GET";
  let wakingTimer: ReturnType<typeof setTimeout> | null = setTimeout(fireWaking, SLOW_AFTER_MS);

  // Headers are built per attempt so a retry re-reads the token (a 401 from
  // the first attempt may have just cleared the stale session).
  const go = () => {
    const h = new Headers(init?.headers);
    if (init?.body) h.set("Content-Type", "application/json");
    const t = getToken();
    if (t) h.set("Authorization", `Bearer ${t}`);
    return fetch(url, { ...init, headers: h });
  };

  let response: Response;
  try {
    try {
      response = await go();
    } catch (err) {
      // A cold Render instance sometimes resets the very first connection.
      // One retry for GETs before we surface an error to the user.
      if (!isGet || !(err instanceof TypeError)) throw err;
      await new Promise((r) => setTimeout(r, 1_200));
      response = await go();
    }
  } finally {
    if (wakingTimer) {
      clearTimeout(wakingTimer);
      wakingTimer = null;
    }
  }

  if (response.status === 401 && !path.startsWith("/api/v1/auth/")) {
    // an authenticated call lost its session (expired/invalid token) — clear and
    // tell the user to sign in again. NOT for /auth/* itself: a 401 there means
    // invalid credentials and must surface the backend's real message verbatim
    // (the pre-fix rewrite showed "Session expired" on a wrong-password login).
    clearSession();
    // Tell the app tree to drop every per-user read model and return to the
    // login screen (page.tsx listens) — clearing storage alone used to leave a
    // zombie logged-in UI that kept failing on every subsequent call.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("syllabai:session-expired"));
    }
    throw new ApiError(401, "Session expired — please sign in again.");
  }
  if (!response.ok) {
    // P3-1 (hub UI audit): the old bare "Request failed (404)" rendered on
    // teacher panels with no context and no next step. Status-aware fallback;
    // the server's own body.message still wins when it provides one.
    let message =
      response.status === 404
        ? "Request failed — the server returned 404 (not found). This data may not exist yet, or the backend was still waking up; please retry."
        : response.status >= 500
          ? `The server hit an error (HTTP ${response.status}) — please try again in a moment.`
          : `The request failed (HTTP ${response.status}) — please try again.`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      // keep default message
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) {
    fireOk();
    return undefined as T;
  }
  fireOk();
  return (await response.json()) as T;
}

/**
 * Revision-note diagram assets live behind the authenticated learner surface
 * (pilot-licensed corpus, LICENSE-DATA.md) — plain <img src> cannot carry the
 * bearer header, so assets are blob-fetched and cached as object URLs.
 */
const revisionAssetCache = new Map<string, Promise<string>>();

export function fetchRevisionNoteAsset(filename: string): Promise<string> {
  const cached = revisionAssetCache.get(filename);
  if (cached) return cached;
  const promise = (async () => {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(
      apiPath(`/api/v1/learners/me/revision-notes/assets/${encodeURIComponent(filename)}`),
      { headers },
    );
    if (!response.ok) throw new ApiError(response.status, `Asset failed (${response.status})`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  })();
  revisionAssetCache.set(filename, promise);
  promise.catch(() => revisionAssetCache.delete(filename));
  return promise;
}

/**
 * Question diagram assets (SME corpus, ADR-026) — same authenticated-blob
 * pattern as revision-note assets, served from the question-asset endpoint
 * that ships with the corpus package.
 */
const questionAssetCache = new Map<string, Promise<string>>();

export function fetchQuestionAsset(filename: string): Promise<string> {
  const cached = questionAssetCache.get(filename);
  if (cached) return cached;
  const promise = (async () => {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(
      apiPath(`/api/v1/content/question-assets/${encodeURIComponent(filename)}`),
      { headers },
    );
    if (!response.ok) throw new ApiError(response.status, `Asset failed (${response.status})`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  })();
  questionAssetCache.set(filename, promise);
  promise.catch(() => questionAssetCache.delete(filename));
  return promise;
}

/**
 * Teacher/content mutations that change what the serving gate exposes run
 * through this wrapper: on success, every cached content payload is dropped
 * so the next content GET re-fetches the post-validation truth.
 */
async function contentMutation<T>(path: string, init: RequestInit): Promise<T> {
  const result = await request<T>(path, init);
  invalidateContentCache();
  return result;
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (
    email: string,
    password: string,
    displayName: string,
    opts?: { role?: "TEACHER"; joinCode?: string },
  ) =>
    request<AuthResponse>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        displayName,
        ...(opts?.role ? { role: opts.role } : {}),
        ...(opts?.joinCode ? { joinCode: opts.joinCode } : {}),
      }),
    }),

  // ── content GETs (cached, see ./api-cache): user-independent curriculum /
  // question / paper payloads behind the serving gate. A repeat visit serves
  // these from localStorage and never wakes the sleeping Render instance. ──

  subjects: () =>
    cachedGet<SubjectView[]>("subjects", () =>
      request<SubjectView[]>("/api/v1/curriculum/subjects"),
    ),

  knowledgeTree: (rootId: string, includeMisconceptions = true) =>
    cachedGet<NodeView>(`tree.${rootId}.${includeMisconceptions}`, () =>
      request<NodeView>(
        `/api/v1/knowledge/nodes/${rootId}/tree?includeMisconceptions=${includeMisconceptions}`,
      ),
    ),

  prerequisites: (nodeId: string) =>
    cachedGet<PrerequisiteView[]>(`prereq.${nodeId}`, () =>
      request<PrerequisiteView[]>(`/api/v1/knowledge/nodes/${nodeId}/prerequisites`),
    ),

  questions: (topicNodeId?: string, rootId?: string) => {
    // subject-scoped practice (pilot-readiness session-56): rootId narrows the
    // list to the subject's subtree so one subject's questions never surface
    // under another subject's workbench
    const params = new URLSearchParams();
    if (topicNodeId) params.set("topicNodeId", topicNodeId);
    else if (rootId) params.set("rootId", rootId);
    const qs = params.toString();
    const path = `/api/v1/questions${qs ? `?${qs}` : ""}`;
    return cachedGet<StudentQuestionView[]>(`questions.${topicNodeId ?? rootId ?? "all"}`, () =>
      request<StudentQuestionView[]>(path),
    );
  },

  // session-112: the servable-question taxonomy (sections → topics with
  // reachable counts) — drives the exam-questions sidebar and the practice
  // topic picker. Counts follow the same rule as the list itself.
  questionTaxonomy: (rootId?: string) =>
    request<QuestionTopicTaxonomyView>(
      `/api/v1/questions/topics${rootId ? `?rootId=${encodeURIComponent(rootId)}` : ""}`,
    ),

  submitAttempt: (body: {
    questionId: string;
    chosenOptionId: string;
    responseTimeMs: number;
    confidence: number | null;
    selfDoubtFlag: boolean;
    timedCondition: boolean;
  }) =>
    request<AttemptResultView>("/api/v1/attempts", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  submitStructuredAttempt: (body: {
    questionId: string;
    partAnswers: { partId: string; answerText: string }[];
    responseTimeMs: number;
    confidence: number | null;
    selfDoubtFlag: boolean;
    timedCondition: boolean;
  }) =>
    request<StructuredAttemptResultView>("/api/v1/attempts/structured", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // SME-style self-mark (ADR-026 practice tranche): reveal the validated
  // scheme, self-award every part in one shot. Single-shot by design — a
  // settled attempt (teacher- or self-marked) returns 409; self-marks are
  // recorded separately from teacher human marks so the κ sample stays
  // teacher-only.
  selfMarkAttempt: (
    attemptId: string,
    parts: { partId: string; marksAwarded: number }[],
    comment?: string | null,
  ) =>
    request<SelfMarkView>(
      `/api/v1/learners/me/attempts/${encodeURIComponent(attemptId)}/self-mark`,
      {
        method: "POST",
        body: JSON.stringify({ parts, comment: comment ?? null }),
      },
    ),

  learnerState: () => request<LearnerStateView>("/api/v1/learners/me/state"),

  // course-stats contract (ADR-029 tranche 4.11): full-trail coverage
  // aggregates — attempts volume + distinct questions/notes/cards. Fails
  // (rejects) on cores older than the contract; every consumer treats that
  // as "no account stats" and falls back to the local overlay silently.
  learnerCourseStats: () =>
    request<CourseStatsView>("/api/v1/learners/me/course-stats"),

  // Flashcard rating evidence (V47, ADR-029 tranche 4.4): one append-only
  // rating event per call, attributed to the deck's subtopic anchor — core
  // resolves the anchor against the curriculum and 404s an unknown one (the
  // caller degrades to local-only). Self-report: NEVER mastery on core.
  recordFlashcardRating: (body: {
    cardId: string;
    rating: "still-learning" | "know";
    subtopicCode: string;
  }) =>
    request<FlashcardRatingView>("/api/v1/learners/me/flashcard-ratings", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Note-vote evidence (V48, ADR-029 tranche 4.9): one append-only vote per
  // call, attributed to the note's subtopic anchor (same structural gate as
  // ratings — an unknown anchor 404s and the caller degrades to local-only).
  // Self-report: NEVER mastery on core, and never a content-quality verdict.
  recordNoteVote: (body: {
    noteId: string;
    /** the hub's local vocabulary — core maps up→helpful, down→not-helpful */
    vote: "up" | "down";
    subtopicCode: string;
  }) =>
    request<NoteVoteView>("/api/v1/learners/me/note-votes", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Assignments (V49, ADR-029 tranche 4.10): the two-party workflow. The
  // teacher builds from the hub's real bank (assemble stays hub-side) and
  // registers the assignment on core; the learner hands in against it; the
  // teacher tracks REAL completion. Errors are surfaced, never mirrored to
  // localStorage — a hand-in that only reached one browser would be a lie.

  // Teacher: register an assembled assignment (fail-closed target validation
  // on core — every specRef must resolve to a curriculum-structure node).
  teacherCreateAssignment: (body: {
    title: string;
    courseSlug: string;
    courseLabel: string;
    specRefs: string[];
    marksTotal: number;
    questionCount: number;
    /** ISO-8601 instant */
    dueAt: string;
  }) =>
    request<AssignmentView>("/api/v1/teacher/assignments", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Teacher: newest-first list with real completion stats.
  teacherAssignments: () =>
    request<AssignmentSummaryView[]>("/api/v1/teacher/assignments"),

  // Teacher: the full roster for one assignment (every enabled student).
  teacherAssignmentRoster: (id: string) =>
    request<AssignmentRosterView>(`/api/v1/teacher/assignments/${id}`),

  // Teacher: lifecycle — close (no new hand-ins) or reopen.
  teacherSetAssignmentStatus: (id: string, status: "open" | "closed") =>
    request<AssignmentView>(`/api/v1/teacher/assignments/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),

  // Learner: newest-first assignments with my hand-in beside each.
  learnerAssignments: () =>
    request<LearnerAssignmentView[]>("/api/v1/learners/me/assignments"),

  // Learner: append a hand-in (re-hand-in = new evidence, latest wins).
  submitAssignmentSubmission: (
    id: string,
    body: { questionsCompleted: number; score?: number | null },
  ) =>
    request<AssignmentSubmissionView>(
      `/api/v1/learners/me/assignments/${id}/submissions`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  // Attempt history (Review Hub minimal slice) — read-only view over the
  // learner's own attempts/answers evidence rows. Default limit 50 (max 100).
  learnerAttempts: (limit?: number) =>
    request<AttemptHistoryView>(
      `/api/v1/learners/me/attempts${limit ? `?limit=${limit}` : ""}`,
    ),

  // ── per-user read models: NEVER cached (must always reflect the learner's
  // live evidence) and never silently served stale. ──

  learnerKnowledgeGraph: (rootId: string) =>
    request<LearnerKnowledgeGraphView>(
      `/api/v1/learners/me/knowledge-graph?rootId=${encodeURIComponent(rootId)}`,
    ),

  // T-033: deterministic next-best-learning-action read model (Spec §22 route).
  // Advice derived from evidence — distinct from the /state measured facts.
  recommendations: (rootId: string) =>
    request<NextBestActionsView>(
      `/api/v1/learners/me/recommendations?rootId=${encodeURIComponent(rootId)}`,
    ),

  // Smart Lesson MVP (§2): one explainable next action for a topic. Re-query
  // after acting — new evidence changes the decision (closed loop).
  smartLesson: (rootId: string, topicNodeId: string) =>
    request<SmartLessonView>(
      `/api/v1/learners/me/smart-lesson?rootId=${encodeURIComponent(rootId)}&topicNodeId=${encodeURIComponent(topicNodeId)}`,
    ),

  // s139 working memory: the chat's prior turns ride the ask (client-held,
  // capped at the last 8 here — the server re-sanitizes at 12). Omitted/
  // empty behaves exactly like the pre-s139 single-turn ask. s140: an owned
  // sessionId persists the exchange to the §22 session store (omitted =
  // unpersisted ask, pre-s140 behavior).
  tutorAsk: (question: string, history?: TutorHistoryTurn[], sessionId?: string | null) =>
    request<TutorAnswerView>("/api/v1/tutor/ask", {
      method: "POST",
      body: JSON.stringify({
        question,
        history: history ?? [],
        ...(sessionId ? { sessionId } : {}),
      }),
    }),

  // s140 §22 session store: the sanctioned server-side transcript surface.
  // create starts a chat ("New chat" / first ask of a sitting); the id rides
  // subsequent asks so their turns persist; get hydrates after a refresh.
  tutorSessionCreate: () =>
    request<TutorSessionCreated>("/api/v1/tutor/sessions", { method: "POST" }),

  tutorSessionGet: (sessionId: string) =>
    request<TutorSessionView>(`/api/v1/tutor/sessions/${encodeURIComponent(sessionId)}`),

  // s143 conversation management: the learner's chats by recency (title +
  // turn count summaries — transcripts stay a per-chat fetch), and delete
  // for their own chat. A foreign/deleted id 404s server-side like an
  // unknown one.
  tutorSessionList: () =>
    request<TutorSessionSummary[]>("/api/v1/tutor/sessions"),

  tutorSessionDelete: (sessionId: string) =>
    request<void>(`/api/v1/tutor/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }),

  // CLA (contract §2–§7): the context + mode are explicit and server-resolved
  // (fail-closed 404 on anything unvalidated/foreign); CHECK pre-attempt is a
  // deterministic 409 attempt_required the UI renders as guidance.
  claAsk: (body: {
    kind:
      | "KG_TOPIC"
      | "PAST_PAPER_QUESTION"
      | "QUESTION_PART"
      | "SPECIFICATION_POINT"
      | "SMART_LESSON"
      | "NOTE_SECTION";
    rootId?: string;
    topicNodeId?: string;
    questionId?: string;
    partId?: string;
    specCode?: string;
    noteId?: string;
    mode: ClaMode;
    question: string;
  }) =>
    request<ClaAnswerView>("/api/v1/learners/me/cla/ask", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── T-029 teacher review surface (route security: TEACHER or ADMIN on the
  // backend; the role check in the UI is an affordance, never authorization) ──
  teacherLearners: () => request<TeacherLearnerView[]>("/api/v1/teacher/learners"),

  markingQueue: (state: string) =>
    request<AnswerMarkingView[]>(`/api/v1/teacher/marking/answers?state=${state}`),

  /** sprint-2 §6/§7: the deterministic paper-grouped queue with mark→next links */
  markingQueueV2: (state: string) =>
    request<MarkingQueueView>(`/api/v1/teacher/marking/queue-v2?state=${state}`),

  // G-5: opt-in paper-group pagination — the paged envelope ONLY when page/size
  // are present; without them the full view above is returned (compatibility)
  markingQueueV2Page: (state: string, page: number, size: number) =>
    request<MarkingQueuePageView>(
      `/api/v1/teacher/marking/queue-v2?state=${state}&page=${page}&size=${size}`,
    ),

  /** sprint-2 §6: throughput metrics — counts of what happened */
  markingThroughput: () =>
    request<MarkingThroughputView>("/api/v1/teacher/marking/throughput"),

  /** sprint-2 §6: bounded Smart Mark batch (partial success preserved) */
  smartMarkBatch: (answerIds: string[]) =>
    request<SmartMarkBatchView>("/api/v1/teacher/marking/smart-mark-batch", {
      method: "POST",
      body: JSON.stringify({ answerIds }),
    }),

  markingAnswer: (answerId: string) =>
    request<AnswerMarkingView>(`/api/v1/teacher/marking/answers/${answerId}`),

  runSmartMark: (answerId: string) =>
    request<SmartMarkView>(`/api/v1/teacher/marking/answers/${answerId}/smart-mark`, {
      method: "POST",
    }),

  recordHumanMark: (
    answerId: string,
    body: {
      marksAwarded: number;
      perPointDecisions: Record<string, number> | null;
      comments: string | null;
    },
  ) =>
    request<HumanMarkView>(`/api/v1/teacher/marking/answers/${answerId}/human-mark`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  kappaLatest: (paperId?: string) =>
    request<KappaEvaluationView>(
      `/api/v1/teacher/marking/kappa/latest${paperId ? `?paperId=${paperId}` : ""}`,
    ),

  evaluateKappa: (paperId?: string) =>
    request<KappaEvaluationView>("/api/v1/teacher/marking/kappa/evaluate", {
      method: "POST",
      body: JSON.stringify(paperId ? { paperId } : {}),
    }),

  conceptGraphActivate: () =>
    contentMutation<ConceptGraphSeedSummary>(
      "/api/v1/teacher/concept-graph/activate",
      { method: "POST" },
    ),

  conceptGraphEdges: (rootId: string) =>
    cachedGet<ConceptGraphEdgesView>(`concept-edges.${rootId}`, () =>
      request<ConceptGraphEdgesView>(
        `/api/v1/teacher/concept-graph/edges?rootId=${encodeURIComponent(rootId)}`,
      ),
    ),

  // ── P9 Test Builder (route security: TEACHER or ADMIN) ──

  testBuilderPreview: (
    rootId: string,
    topicNodeIds: string[],
    maxQuestions?: number,
    targetMarks?: number,
    includeAnswers = false,
  ) => {
    const params = new URLSearchParams();
    params.set("rootId", rootId);
    if (topicNodeIds.length) params.set("topicNodeIds", topicNodeIds.join(","));
    if (maxQuestions) params.set("maxQuestions", String(maxQuestions));
    if (targetMarks) params.set("targetMarks", String(targetMarks));
    if (includeAnswers) params.set("includeAnswers", "true");
    return request<TestPreviewView>(`/api/v1/teacher/tests/preview?${params}`);
  },

  /** sprint-2 §10: class-weakness targeting options (read-only class evidence) */
  testBuilderWeaknessOptions: (rootId: string) =>
    request<WeaknessOptionsView>(
      `/api/v1/teacher/tests/weakness-options?rootId=${encodeURIComponent(rootId)}`,
    ),

  // ── Teacher class intelligence (sprint 2 §2–§5; route security: TEACHER or
  // ADMIN; read-only aggregations over the existing learner-model tables) ──

  classOverview: (rootId: string) =>
    request<ClassOverviewView>(
      `/api/v1/teacher/class/overview?rootId=${encodeURIComponent(rootId)}`,
    ),

  classLearners: (rootId: string) =>
    request<ClassLearnerRow[]>(
      `/api/v1/teacher/class/learners?rootId=${encodeURIComponent(rootId)}`,
    ),

  classTopicDrillDown: (rootId: string, nodeId: string) =>
    request<ClassTopicDrillDown>(
      `/api/v1/teacher/class/topics/${nodeId}/drill-down?rootId=${encodeURIComponent(rootId)}`,
    ),

  // ── teacher content validation (Master Spec §7: SUGGESTED never serves) ──
  // Mutations run through contentMutation → cache invalidation on success;
  // the review queues themselves stay live (they reflect DB state the
  // teacher is actively working through).

  contentReviewQueue: () =>
    request<TeacherReviewQueueView>("/api/v1/teacher/content/review-queue"),

  paperReview: (paperId: string) =>
    request<TeacherPaperReviewView>(
      `/api/v1/teacher/content/exam-papers/${paperId}/review`,
    ),

  validatePaper: (paperId: string) =>
    contentMutation<TeacherPaperSummary>(
      `/api/v1/teacher/content/exam-papers/${paperId}/validate`,
      { method: "POST" },
    ),

  placePaper: (paperId: string, subjectId: string) =>
    contentMutation<TeacherPaperSummary>(
      `/api/v1/teacher/content/exam-papers/${paperId}/place`,
      { method: "POST", body: JSON.stringify({ subjectId }) },
    ),

  rejectPaper: (paperId: string) =>
    contentMutation<TeacherPaperSummary>(
      `/api/v1/teacher/content/exam-papers/${paperId}/reject`,
      { method: "POST" },
    ),

  validateQuestionVersion: (versionId: string) =>
    contentMutation<TeacherVersionActionResult>(
      `/api/v1/teacher/content/question-versions/${versionId}/validate`,
      { method: "POST" },
    ),

  rejectQuestionVersion: (versionId: string) =>
    contentMutation<TeacherVersionActionResult>(
      `/api/v1/teacher/content/question-versions/${versionId}/reject`,
      { method: "POST" },
    ),

  validateMarkScheme: (schemeId: string) =>
    contentMutation<TeacherSchemeActionResult>(
      `/api/v1/teacher/content/mark-schemes/${schemeId}/validate`,
      { method: "POST", body: JSON.stringify({}) },
    ),

  rejectMarkScheme: (schemeId: string) =>
    contentMutation<TeacherSchemeActionResult>(
      `/api/v1/teacher/content/mark-schemes/${schemeId}/reject`,
      { method: "POST" },
    ),

  // ── V20 high-throughput review: enriched queue, batch validate, flag/unflag, findings ──

  contentReviewQueueV2: () =>
    request<TeacherEnrichedReviewQueueView>(
      "/api/v1/teacher/content/review-queue-v2",
    ),

  /** sprint-2 §7: queue intelligence — §7 signals + rank reasons */
  contentReviewQueueV3: () =>
    request<TeacherEnrichedReviewQueueViewV3>(
      "/api/v1/teacher/content/review-queue-v3",
    ),

  validateAllForPaper: (paperId: string, force = false) =>
    contentMutation<TeacherValidateAllResult>(
      `/api/v1/teacher/content/exam-papers/${paperId}/validate-all${force ? "?force=true" : ""}`,
      { method: "POST" },
    ),

  // V22: durable audit history for a paper and everything under it
  paperAudit: (paperId: string) =>
    request<TeacherAuditRowView[]>(
      `/api/v1/teacher/content/exam-papers/${paperId}/audit`,
    ),

  paperFindings: (paperId: string) =>
    request<TeacherFindingView[]>(
      `/api/v1/teacher/content/glm-ocr/papers/${paperId}/findings`,
    ),

  flagPaper: (paperId: string) =>
    contentMutation<TeacherPaperSummary>(
      `/api/v1/teacher/content/exam-papers/${paperId}/flag`,
      { method: "POST" },
    ),

  unflagPaper: (paperId: string) =>
    contentMutation<TeacherPaperSummary>(
      `/api/v1/teacher/content/exam-papers/${paperId}/unflag`,
      { method: "POST" },
    ),

  flagQuestionVersion: (versionId: string) =>
    contentMutation<TeacherVersionActionResult>(
      `/api/v1/teacher/content/question-versions/${versionId}/flag`,
      { method: "POST" },
    ),

  unflagQuestionVersion: (versionId: string) =>
    contentMutation<TeacherVersionActionResult>(
      `/api/v1/teacher/content/question-versions/${versionId}/unflag`,
      { method: "POST" },
    ),

  flagMarkScheme: (schemeId: string) =>
    contentMutation<TeacherSchemeActionResult>(
      `/api/v1/teacher/content/mark-schemes/${schemeId}/flag`,
      { method: "POST" },
    ),

  unflagMarkScheme: (schemeId: string) =>
    contentMutation<TeacherSchemeActionResult>(
      `/api/v1/teacher/content/mark-schemes/${schemeId}/unflag`,
      { method: "POST" },
    ),

  // ── §10 topic mapping: ingestion anchors -> real curriculum topics ──

  mapQuestionTopics: (questionId: string, primaryNodeId: string, secondaryNodeIds: string[] = []) =>
    contentMutation<TeacherTopicMappingResult>(
      `/api/v1/teacher/content/questions/${questionId}/topics`,
      { method: "POST", body: JSON.stringify({ primaryNodeId, secondaryNodeIds }) },
    ),

  questionTopicRows: (questionId: string) =>
    request<TeacherTopicRowView[]>(
      `/api/v1/teacher/content/questions/${questionId}/topics`,
    ),

  // ── exam papers (learner browsing; content stays behind the serving gate) ──

  examPapers: (subjectId?: string) =>
    cachedGet<ExamPaperBrowseView[]>(`papers.${subjectId ?? "all"}`, () =>
      request<ExamPaperBrowseView[]>(
        `/api/v1/exam-papers${subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : ""}`,
      ),
    ),

  examPaper: (paperId: string) =>
    cachedGet<ExamPaperDetailView>(`paper.${paperId}`, () =>
      request<ExamPaperDetailView>(`/api/v1/exam-papers/${paperId}`),
    ),

  // single servable question with its parts (404 when not servable — the
  // same gate the practice list applies). Live, not cached: the exam player
  // fetches on demand and single-flight already de-dupes concurrent fetches.
  question: (id: string) =>
    request<StudentQuestionView>(`/api/v1/questions/${id}`),

  // SME-style mark-scheme reveal (Master Spec §15/§20/§22, policy-gated):
  // 200 = the reveal policy serves the scheme; 204 = withheld (pending
  // teacher validation under VALIDATED_ONLY, or rejected/flagged) which
  // request() maps to undefined so the UI can say so honestly.
  markScheme: (questionId: string) =>
    request<MarkSchemeRevealView | undefined>(
      `/api/v1/questions/${encodeURIComponent(questionId)}/mark-scheme`,
    ),

  // ── student Smart Mark (F-047 learner half) — button-driven, never a chat
  // box: the marking run and the two feedback actions take no request body,
  // grounding is resolved server-side from opaque ids. 409 = pre-settlement
  // only (self/teacher mark already settled) or scheme pending validation.
  smartMarkAttempt: (attemptId: string) =>
    request<SmartMarkAttemptView>(
      `/api/v1/learners/me/attempts/${encodeURIComponent(attemptId)}/smart-mark`,
      { method: "POST" },
    ),

  explainSmartFeedback: (attemptId: string, partId: string) =>
    request<SmartMarkFeedbackExplanation>(
      `/api/v1/learners/me/attempts/${encodeURIComponent(attemptId)}/parts/${encodeURIComponent(partId)}/feedback-explanation`,
      { method: "POST" },
    ),

  smartImprovementPlan: (attemptId: string, partId: string) =>
    request<SmartMarkImprovementPlan>(
      `/api/v1/learners/me/attempts/${encodeURIComponent(attemptId)}/parts/${encodeURIComponent(partId)}/improvement-plan`,
      { method: "POST" },
    ),

  // ── revision notes (SME-style corpus, learner-scoped, authenticated-only) ──

  revisionNotes: () =>
    request<RevisionNotesIndexView>("/api/v1/learners/me/revision-notes"),

  revisionNote: (noteId: string) =>
    request<RevisionNoteBodyView>(
      `/api/v1/learners/me/revision-notes/${encodeURIComponent(noteId)}`,
    ),

  markRevisionNoteViewed: (noteId: string) =>
    request<void>(`/api/v1/learners/me/revision-notes/progress/views`, {
      method: "POST",
      body: JSON.stringify({ noteId }),
    }),
};
