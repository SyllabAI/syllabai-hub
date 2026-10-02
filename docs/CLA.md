# CLA — Contextual Learning Assistant on Revision Notes

**Status:** Implemented (demo slice, revision-notes contexts only) · 2026-09-26
**Ships toward:** the exam-question CLA surface (PAST_PAPER_QUESTION contexts, HINT/CHECK modes, the attempt gate) — operator decision: later, separate lane.
**Production source of truth:** syllabai-core `com.syllabai.cla` (ClaService, ClaContextResolver, ClaLeakagePolicy, ResponseMode) + `POST /api/v1/learners/me/cla/ask` → `ClaAnswerView`; web `ClaAssistantView`.

---

## 1. What this is

The CLA product shape on the note reader: every Revision Note page carries one
overlay entry — the floating **CLA** button; the guided-study banner opens the
same panel — and the panel answers **only about the note being read**. Students
ask free questions or use the four quick actions (operator spec, verbatim):

| Quick action | Prompt sent | Mode |
|---|---|---|
| **Definitions** | "Define the key terms in this revision note" | EXPLAIN |
| **Summary** | "Summarise the key points" | SUMMARIZE |
| **Pitfalls** | "Examine common misconceptions" | EXPLAIN |
| **Exam help** | "Tips for understanding this topic" | EXPLAIN |

This closes gap #4 of the s132 demo-vs-core/web audit (CLA had zero mockup).

## 2. Why it is not just the Tutor again

The free Tutor (`/tutor`, `/api/ai/chat`) and the CLA are two surfaces with
different contracts — the production split, preserved:

| | Free Tutor | CLA (this slice) |
|---|---|---|
| Context | none — any question, whole corpus | **explicit, server-resolved**: the note the learner is reading |
| Retrieval | corpus-wide BM25-lite | bounded to the anchored note's chunks |
| Modes | one behavior | EXPLAIN / SUMMARIZE (HINT / CHECK are question-context modes) |
| Refusal | when corpus evidence is thin | when **this note** doesn't cover the ask → points at the free Tutor |
| Transport | SSE experiment | **synchronous JSON** — mirrors the production `cla/ask` contract |

The boundary is visible in behavior: asking "how is crude oil fractionally
distilled?" on the *Three States of Matter* note is **refused** (the corpus
contains that content — the Tutor answers it; the note-anchored CLA does not).

## 3. Demo implementation map

| Piece | File | Notes |
|---|---|---|
| Orchestration | `src/lib/cla.ts` | fail-closed context resolution (404 unknown refs), mode validation, note-bounded evidence from the shared corpus index, BM25-lite scope gate for free questions (quick actions are in-scope by construction and bypass it), mode-aware system prompt, honest refusal + provider-failure fallback. Mirrors `tutor.ts` conventions. |
| API | `src/app/api/ai/cla/route.ts` | POST → `ClaTurnResult` JSON (answer, mode, server-resolved context, citations, provider, refused, evidenceCount, latencyMs — the `ClaAnswerView` field names); 400 `mode_not_valid_for_context` for HINT/CHECK; 404 `context_not_found`; GET provider transparency. |
| UI island | `src/components/cla/note-cla.tsx` | FAB + guided-study banner + right Sheet: context card ("the server resolves this context — it cannot be pointed anywhere else"), mode row (EXPLAIN/SUMMARIZE select the free-input mode; HINT/CHECK disabled with the reason), 4 quick actions, transcript with citation chips + provider/evidence/latency footer, refused answers styled distinctly, 400/404 rendered as guidance not noise. |
| Note page | `src/app/courses/[course]/revision-notes/[noteId]/page.tsx` | the server-rendered guided-study banner (previously a `/tutor` deep link) is replaced by the island — asking about THIS note is the CLA's job; the free Tutor stays in the nav. |

## 4. Production semantics deliberately preserved

- **Data, not judgment** — the client passes opaque refs (course slug + noteId);
  the server resolves the note and echoes the resolved context back. The
  context is never client-asserted (core contract §3/§5).
- **Mode boundary enforced in code** — HINT/CHECK are rejected by the API for
  note contexts, not merely hidden in the UI. In production they are
  question-context modes: HINT scaffolds without scheme points, CHECK is
  attempt-gated (the §7 answer-leakage rule — `ClaLeakagePolicy`'s
  "never delegated to the model, never prompt-only").
- **Honest refusal** — bounded context + deterministic refusal when the note
  cannot ground the ask; the refusal names the note and redirects to the free
  Tutor (core's tutor-parity boundary on KG_TOPIC-like contexts).
- **No state mutation** — CLA output is text + citations only. Production
  additionally emits a `ClaInteractionEvent` per ask; the demo has no evidence
  pipeline yet, so nothing is recorded (that lands with attempt evidence,
  TEACHER_MODE_PLAN §4's `AttemptEvent` stream).

## 5. Scope decisions (documented, not silent)

- **Revision notes only.** Exam-question CLA (anchored to a
  PAST_PAPER_QUESTION context, where HINT/CHECK unlock post-attempt and the
  mark-scheme leakage rules bite) is a later lane per operator decision —
  the disabled HINT/CHECK chips in the mode row are its placeholder.
- **No scope-gate on quick actions.** The four presets are meta-asks about the
  note as a whole; their prompts need not lexically match the body. Free
  questions go through the BM25-lite scope gate (threshold deliberately low —
  it catches "asked about a different topic", not phrasing variance).
- **Mock provider works offline** (as with the Tutor); the answer footer labels
  the provider honestly ("demo fallback provider" for mock).
- **Provider configuration on deployments (s134).** The `zai` adapter runs in
  two modes: env-var mode when `ZAI_BASE_URL` + `ZAI_API_KEY` + `ZAI_TOKEN` are
  set (optionally `ZAI_MODEL`, `ZAI_USER_ID`, `ZAI_CHAT_ID`) — the only mode
  that works on serverless hosts, where the SDK's file-only `.z-ai-config`
  cannot exist; and SDK mode in the sandbox, where that file is preinstalled.
  The three env values gate engagement together: a partial config falls
  through to the clearly-labeled mock rather than failing every call at 401
  (the endpoint requires `Authorization` + `X-Z-AI-From` + `X-Token` — probed
  live). Without either configuration, `zai.available()` is false and the pool
  falls through to the mock — deployments never see the runtime
  "Configuration file not found" error. A provider that throws is never
  credited in the answer footer (`provider: "unavailable"`, rendered as "no AI
  provider answered — structured fallback shown").
- **Citations are badges — and links when a surface exists.** Note-section
  citations (labels like "Title · §3") stay read-only badges: their target is
  the note already open, and in-page anchor scrolling was considered and
  dropped — heading ids are not stable in the Markdown renderer. Corpus
  citations that carry an in-app url (the F-022 source reader for
  document-backed evidence, mapped by the citation bridge) render as links.
