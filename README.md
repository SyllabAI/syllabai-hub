# SyllabAI Hub

**Status: PRODUCTION TRACK (v1.0) — the SyllabAI product frontend.** Promoted from
`syllabai-demo` on 2026-09-28 (operator decision, ADR-029 in `SyllabAI/syllabai`).

The Hub is the student- and teacher-facing web app: SaveMyExams-style per-subject
Learning Hubs across the registered Edexcel IGCSE/IAL course registry, a
spec-anchored grounded tutor, and the teacher workspace — connected to
[`syllabai-core`](https://github.com/SyllabAI/syllabai-core) for identity,
learner state, evidence and all AI.

## Architecture

```
browser ──► syllabai-hub (this repo, Next.js 16, Vercel)
              │  content: committed corpus bundles (39 courses, read-only resources)
              │  AI:      /api/ai/* server-side proxies → core (learner JWT forwarded)
              │
              └────► syllabai-core (Spring Boot, Render) — auth, BKT/BDT learner
                     state, attempt evidence, tutor/CLA generation, RBAC
```

- **All AI flows through core** (`R3`): no LLM keys in this repo or its Vercel env.
  `/api/ai/chat` proxies `POST /api/v1/tutor/ask` (SSE-adapted),
  `/api/ai/cla` proxies `POST /api/v1/learners/me/cla/ask`,
  `/api/ai/mark` is inert pending core question-ID mapping (self-mark is the path).
- **Identity is core's**: login/register hit core `AuthController`; the session
  token lives in `localStorage` (`syllabai.token`) for the v0 pilot; teacher
  surfaces gate on the core-issued `TEACHER` role (server-enforced).
- **Learner state**: the pilot subject (IGCSE Chemistry 4CH1) drives the real
  core learner model; progress surfaces on other subjects remain the labelled
  `SIMULATED` local overlay until the evidence bridge lands (see ADR-029
  follow-up tranches).
- **Content**: 39 read-only course hubs from the committed corpus
  (`content/`, ~80 MB) per the operator's ADR-019 scope waiver (ADR-028);
  past-paper PDFs stream from the public `syllabai-pastpapers` repo.
- **Math rendering**: KaTeX 0.16 with the local `rehypeKatexMhchem` plugin (s142
  mhchem hardening) and a `rehype-sanitize` allow-list after `rehype-raw`
  (corpus HTML is operator-imported but gated against stored XSS).

## Routes

| Surface | Route |
|---|---|
| Courses directory | `/courses` |
| Learning Hub (per course) | `/courses/[course]` — notes, exam questions, flashcards, past papers, specification, strengths, practice papers |
| Dashboard | `/dashboard` |
| AI Tutor (core-grounded, sign-in required) | `/tutor` |
| Assistant (CLA, sign-in required) | `/assistant` |
| Practice | `/practice` |
| Knowledge Graph / Graph Explorer | `/knowledge-graph`, `/graph-explorer` |
| Learner overlay | `/learner` |
| Teacher workspace (TEACHER role) | `/teacher` — assignments, class graph, test builder, validation |
| Experiments | `/experiments` |

Legacy top-level routes (`/revision-notes`, `/exam-questions`, `/flashcards`)
redirect into the pilot course's hub.

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | client | core origin, e.g. `https://syllabai-core.onrender.com` (browser→core direct) |
| `SYLLABAI_CORE_BASE_URL` | server | same origin for the `/api/ai/*` proxies |
| `HUB_DATA_MODE` | server | `mock` (default, bundled corpus) \| `core-api` |

**Deployment prerequisite:** core's CORS allow-list
(`SYLLABAI_CORS_ORIGINS` on the Render service) must include this app's
production origin — e.g. `https://<hub-domain>.vercel.app` alongside the
existing entries.

## Development

```bash
bun install
bun run dev        # http://localhost:3000 (core CORS already allows localhost:3000)
bun run lint       # eslint
bun run build      # type-checked production build (+ corpus verify prebuild gate)
```

`prebuild` runs `scripts/verify_corpus_23a.ts` — the corpus integrity gate —
before every production build (CI included).

## Provenance & governance

- Canonical semantics: [`SyllabAI/syllabai`](https://github.com/SyllabAI/syllabai)
  (master spec, ADRs, task registry). Promotion decision: ADR-029.
- Content: `syllabai-resources` (SME-derived, pilot-licensed — operator
  attestation 2026-09-17, contract on file).
- Everything simulated on this surface is labelled `SIMULATED`; everything
  AI-suggested keeps its provenance and citations.
- History: this repo was cloned from `SyllabAI/syllabai-demo` at `a8f8fba`
  (full history preserved); the demo repo is now frozen as the prototype
  playground. Promotion hardening landed in the commits that follow.
