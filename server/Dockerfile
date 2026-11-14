# LearnMate AI — API image
#
# Why this exists
# ---------------
# The service executes student code. Until now it deployed on `runtime: node`,
# which is a Node-only image with **no Python interpreter** — so every Python
# submission failed with `spawn python3 ENOENT` before a single line ran, and
# the grader reported that as a wrong answer.
#
# A Node image cannot be made to run Python by installing a package: the
# interpreter has to be in the image. So the image carries both runtimes.
#
# The two runtimes are deliberately kept apart:
#   - Node runs the API.
#   - Python runs *only* student submissions, as a separate process with
#     `-I -S` (isolated: no user site-packages, no PYTHON* env influence) and a
#     wall-clock timeout, spawned by src/utils/sandbox.js.
#
# Security note: this is not a strong sandbox. Node's permission model and a
# separate process give useful isolation, but a hardened deployment should run
# submissions in a dedicated worker/container with no network and its own user
# limit. See docs/DEPLOYMENT.md.

FROM node:22-slim

# python3 is the only OS package the app needs at runtime.
# `--no-install-recommends` keeps the image small; `rm -rf /var/lib/apt/lists/*`
# drops the package index so the layer does not carry it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

# Fail the build — not a student's submission — if Python is missing.
RUN python3 --version

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
# The port Render/Vercel route to. `src/index.js` reads PORT.
ENV PORT=3001

# The app writes nothing to disk except temp files under os.tmpdir().
EXPOSE 3001

# A tiny healthcheck so the platform knows when the service is actually up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
