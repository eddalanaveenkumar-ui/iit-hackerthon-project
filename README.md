# LearnMate AI

A multi-user, AI-personalised learning platform: classrooms with real permissions, a scaffolded AI tutor, evidence-based learning analytics, a sandboxed coding practice environment, private-by-default chat, and one central admin console that configures every AI model in the product.

Built with **React + Tailwind + Recharts + Monaco** on the client and **Node + Express + JWT + MongoDB** on the server, with the AI layer abstracted behind provider adapters (NVIDIA NIM first).

---

## Quick start

```bash
# 1. Backend
cd server
npm install
cp ../.env.example ../.env      # then edit secrets (see below)
npm run dev                     # http://localhost:3001  (seeds demo data on first boot)

# 2. Frontend (separate terminal — hot reload)
cd web
npm install
npm run dev                     # http://localhost:5173, proxying /api → :3001
```

Production single-service mode (Express serves the built SPA):

```bash
cd web && npm install && npm run build
cd ../server && npm install && npm start        # everything on http://localhost:3001
```

### Demo accounts

All demo users share the password **`LearnMate123!`** (seeded when `SEED_DEMO=true`).

| Email | Role in the seeded data |
| --- | --- |
| `aisha@learnmate.ai` | Owner of *Java Programming — Section A* (join approval on) |
| `meera@learnmate.ai` | Owner of *Machine Learning Foundations*, co-owner of *Data Structures* |
| `naveen@learnmate.ai` | Owner of *Modern Web Development*, learner in Java + ML |
| `rohit@learnmate.ai` | Teacher in Java with **monitoring OFF** — demonstrates the gate |
| `priya@learnmate.ai` | Learner + co-owner |
| `karthik@learnmate.ai` | Learner |
| `admin@learnmate.ai` | Platform administrator (AI console access) |

There are no fixed "teacher" and "student" account types. Every account is the same kind of user; **permissions come from classroom membership**, so the same person can own one classroom, teach in a second, and learn in a third.

---

## Configuration

Everything lives in one `.env` at the repository root (read by `server/`).

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default `3001`). |
| `CORS_ORIGINS` | Comma-separated allowed origins for the Vite dev server. |
| `DB_MODE` | `embedded` (default — a bundled MongoDB-compatible engine, zero setup) or `external`. |
| `MONGODB_URI` | Atlas / self-hosted URI when `DB_MODE=external`. |
| `JWT_SECRET` | Token signing key. |
| `SECRET_ENCRYPTION_KEY` | AES-256-GCM key used to encrypt provider API keys at rest. Rotating it invalidates stored keys. |
| `NVIDIA_API_KEY` | Optional. Can also be set from the admin UI, where it is stored encrypted. |
| `NVIDIA_BASE_URL` | Defaults to `https://integrate.api.nvidia.com/v1`. |
| `SEED_DEMO` | Seeds the realistic demo dataset on first boot. |

**No AI key is required to run the product.** Without a key the platform routes every task through a deterministic local analyser, so tutoring, gap detection, assessment generation, code review and analytics all still work end-to-end. Adding a key in **Admin → AI configuration** switches traffic to NVIDIA NIM at runtime with no restart.

---

## What's implemented

### Accounts, classrooms and permissions
- Unified auth (register / login / JWT), profile and password management, light + dark themes.
- Classroom CRUD with a human-readable unique **classroom ID** (`LM-XXXX-XXXX`).
- Join by ID, with owner-controlled **approval** and a pending-request queue.
- Four classroom roles — `owner`, `co_owner`, `teacher`, `student` — with independent permission grants, role changes, removal, leave and ownership transfer.
- **Per-teacher monitoring toggle.** Each teacher independently switches student monitoring ON/OFF. OFF hides student analytics, individual profiles and chat history, but leaves that teacher's own learning completely unaffected. Enforced server-side, audited.

### Syllabus and retrieval
- Upload **PDF / DOCX / PPTX** and get a parsed `Subject → Unit → Topic → Concept → Subtopic` tree, or build it manually.
- Documents are chunked and indexed so tutor replies can cite real syllabus material.

### The learning flow
- Guided `/start` wizard: classroom → subject → unit → concept → mode (**learn / test / practise / continue**).
- Every session starts a **fresh chat** without deleting prior records, so history stays intact.
- **Progressive scaffolding** — support level moves between `independent`, `supported` and `guided` based on evidence (repeated mistakes, wrong streaks, hint usage, unaided correct answers).
- Student-triggered assessments, plus AI-triggered recommendations that are **optional and postponable**.
- **Monaco** practice workspace with language-aware editing, run/submit against a sandboxed evaluator, hidden tests, static analysis, copy-paste detection and an AI code review.

### Evidence-based intelligence
Detected from real interactions — answers, assessment results and code submissions — never from self-report:

- knowledge gaps, misconceptions, practical difficulties, repeated errors, learning speed, independence, topic mastery with trend, and at-risk flags.
- Each **classroom keeps its own isolated learning profile**, so progress in one subject never leaks into another.
- Dashboards for the learner, the classroom owner and each teacher.

### Chat privacy
- Conversations are **private by default**.
- The student grants or revokes access per classroom (`shareWithTeachers`, `shareWithOwner`); revocation is enforced on the backend immediately, while analytics stay visible.
- Every grant/revoke and every teacher view is written to an **audit trail**.

### Central AI configuration (admin only)
- NVIDIA NIM base URL, API key (encrypted, write-only, never returned to a browser) and timeouts.
- **Model registry** with live availability verification against the provider catalogue — availability is never assumed.
  `nemotron-3.5-lightning-30b-a3b`, `nemotron-3-ultra-550b-a55b`, `nemotron-3.5-embed-1b`, `nemotron-3.5-rerank-8b`, `nemotron-3.5-parse`, `nemotron-content-safety-reasoning-4b`, `qwen/qwen2.5-coder-32b-instruct`, `deepseek-ai/deepseek-v4-flash`.
- **Task → model routing**, editable per task with fallbacks, applied without a restart.
- Generation parameters (temperature, top-P, max tokens, JSON mode) and independent **feature toggles** enforced at the route level.
- Usage analytics: requests, tokens, estimated cost, latency, and breakdowns by model, feature, task and classroom.
- Provider-independent adapters with a local fallback, per-user rate limiting and response caching.

---

## Testing

```bash
cd server
npm run test:e2e      # 137 assertions, isolated harness (own port + temp database)
npm run test:smoke    # 74 assertions against a running server: the client/server contract
```

`test:e2e` boots a disposable server on port `3111` with a temp database, exercises all twelve required scenarios plus isolation and authorisation attacks, then tears everything down.

`test:smoke` runs against a live instance and verifies every payload shape the React pages actually read — including that the SPA shell is served, that credentials never leak, and that feature toggles and monitoring gates take effect immediately.

---

## Project layout

```
server/
  src/
    config/            env loading and validation
    db/                connection, 27 collections, 46 indexes
    middleware/        JWT auth, admin guard
    modules/
      auth/            register, login, profile, password, directory
      classrooms/      CRUD, join, members, roles, monitoring, audit
      syllabus/        PDF/DOCX/PPTX extraction, parser, manual tree
      tutor/           session lifecycle, scaffolding, retrieval, privacy
      assessments/     generation, attempt, grading, postpone
      practice/        Monaco exercises, sandboxed runner, code review
      intelligence/    profiles, gap engine, student/classroom analytics
      ai/              catalogue, config store, orchestrator, providers, admin routes
      dashboards/      landing payloads
    seed/              realistic demo dataset + workflows
  tests/               e2e suite + harness + web contract smoke test

web/
  src/
    lib/               API client, formatters
    contexts/          auth, theme
    components/        design system, charts, app shell
    pages/             dashboard, classrooms, tutor, practice, assessments,
                       progress, monitoring, student profile, chat privacy,
                       settings, admin AI console
```

---

## Security notes

- Passwords hashed with bcrypt; JWT bearer auth on every non-auth route.
- Provider credentials encrypted with AES-256-GCM and never serialised to the client — the API returns only a masked preview.
- Every classroom-scoped query filters by classroom **and** verifies membership on the server; the client never decides access.
- Assessment questions are served without correct answers; hidden test expectations are never exposed.
- Submitted code runs in a sandbox with a permission-restricted runtime, an empty environment and a hard timeout — never in the API process.
- Join approval, monitoring gates and chat-privacy revocation are all enforced server-side, with an audit log.
