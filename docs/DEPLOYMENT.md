# Deployment

LearnMate AI is two pieces:

| Piece | What it is | Host |
| --- | --- | --- |
| `web/` | React + Vite SPA (static) | **Vercel** |
| `server/` | Express API (persistent Node process) | **Render** (or Railway / Fly / a VPS) |
| database | MongoDB | **MongoDB Atlas** |

> **Why the split?** The API is a long-running server that opens a MongoDB
> connection pool and serves SSE-style streaming. Vercel runs short-lived
> serverless functions, so it cannot host this API. It is an excellent host for
> the SPA, which is what it does here.
>
> **Why not Supabase?** The persistence layer uses the MongoDB wire protocol —
> 276 driver call sites and 6 aggregation pipelines (`$group`, `$cond`, `$sum`).
> Supabase is PostgreSQL. Pointing the API at it would require rewriting the
> entire data layer, not changing a connection string.

---

## 1. Database — MongoDB Atlas

1. Create a free **M0** cluster at <https://cloud.mongodb.com>.
2. **Database Access** → add a user, e.g. `learnmate` with a strong password.
3. **Network Access** → add `0.0.0.0/0` (Render's egress IPs are not static on
   the free plan). Tighten this later behind a paid Render plan.
4. **Connect → Drivers** → copy the SRV string:
   `mongodb+srv://learnmate:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`

Use it as `MONGODB_URI`, optionally adding the database name:
`.../<cluster>.mongodb.net/learnmate?retryWrites=true&w=majority`

---

## 2. API — Render

The repository includes [`render.yaml`](../render.yaml), so this is a blueprint
deploy rather than manual configuration. It provisions the API as a **Docker**
service built from [`server/Dockerfile`](../server/Dockerfile).

> **Why Docker and not `runtime: node`?** The code sandbox executes submitted
> answers by spawning the language's interpreter (`python3` for Python). A bare
> Node image has no Python, so every Python submission failed with
> `spawn python3 ENOENT` and the learner was told *"Not quite"* for code that
> never ran. The Dockerfile installs `python3` and fails its own build if the
> binary is not on `PATH`. If you deploy to a Node-only host, install the
> interpreters yourself — see [§5](#5-code-execution-runtime).

1. <https://dashboard.render.com> → **New** → **Blueprint**.
2. Connect the `eddalanaveenkumar-ui/iit-hackerthon-project` repository.
3. Render detects `render.yaml` and shows one service: **learnmate-api**.
4. Fill the `sync: false` variables:

   | Variable | Value |
   | --- | --- |
   | `MONGODB_URI` | the Atlas string from step 1 |
   | `JWT_SECRET` | any long random string |
   | `SECRET_ENCRYPTION_KEY` | 32+ random characters |
   | `CORS_ORIGINS` | your Vercel URL, e.g. `https://learnmate.vercel.app` |
   | `NVIDIA_API_KEY` | optional — can be set later in the admin UI |

   Generate the two secrets with:
   ```bash
   node -e "const c=require('crypto');console.log(c.randomBytes(48).toString('base64url'));console.log(c.randomBytes(32).toString('base64url'))"
   ```
5. **Apply**. The first boot seeds the demo dataset (`SEED_DEMO=true`).
6. Verify: `https://<service>.onrender.com/api/health` returns `{"ok":true,...}`.

Free Render services sleep after ~15 minutes idle; the first request afterwards
takes ~30 s to wake. The SPA shows a loading state during that.

---

## 3. SPA — Vercel

`web/vercel.json` handles the build, the SPA rewrite and the asset caching.

1. <https://vercel.com/new> → import this repository.
2. **Root Directory**: `web`
3. Framework preset: **Vite** (auto-detected)
4. Add an environment variable for the production build:

   | Key | Value |
   | --- | --- |
   | `VITE_API_BASE_URL` | `https://<service>.onrender.com` |

5. **Deploy**.

`VITE_API_BASE_URL` is read at build time by `web/src/lib/api.js`. Leave it
unset for single-service local runs, where the SPA and API share an origin.

---

## 4. Post-deploy checks

```bash
curl https://<service>.onrender.com/api/health
curl -X POST https://<service>.onrender.com/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"naveen@learnmate.ai","password":"LearnMate123!"}'
```

Then open the Vercel URL and sign in as `naveen@learnmate.ai` /
`LearnMate123!`. If login fails with a CORS error, `CORS_ORIGINS` on Render does
not yet include the exact Vercel origin (scheme included, no trailing slash).

The full contract can be re-verified against the deployed API:

```bash
cd server
BASE=https://<service>.onrender.com npm run test:smoke
```

---

## Single-service alternative

Everything already runs as one process, which is useful for a VPS or a
container host:

```bash
cd web && npm install && npm run build
cd ../server && npm install && npm start     # serves SPA + API on one port
```

`server/src/app.js` serves `web/dist` when it exists and falls back to
`index.html` for client-side routes.

---

## 5. Code execution runtime

Submitted code is graded by **running it**, not by asking a model whether it
looks right, so the API host must have the interpreters installed. Today only
Python is executed; Java and SQL answers are analysed statically and reported as
*unverified* rather than guessed at.

| Requirement | Why |
| --- | --- |
| `python3` on `PATH` | runs `code_input` answers in Tracs and code review |
| Node ≥ 20 | supplied by the base image; runs JavaScript answers via `--permission` |

`server/Dockerfile` installs Python and verifies it at build time:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/* \
 && python3 --version
```

### What happens if it is missing

The API stays up and degrades honestly. `isRuntimeAvailable('python')` probes
`python3 --version` once and caches the answer; when it fails, `executeCode`
returns `executed: false` with `runtimeUnavailable: true` instead of a
misleading verdict. A Python answer then comes back as `partly_correct` with
*"This server has no Python interpreter installed, so the submission could not be
run… It has been recorded but not verified."* — the learner is never told their
correct code is wrong, and the missing interpreter is **not** filed as a
weakness in their gap record.

To see that path on a machine that does have Python:

```bash
cd server
LM_FORCE_RUNTIME_UNAVAILABLE=python npm run test:tracs
```
