# Deployment and CI/CD

How a commit reaches production, what runs where, and what to do when something breaks. The design decisions behind it are in [backend_plan.md §10.1](backend_plan.md).

## The pipeline

```
push / pull request to master
        │
        ▼
GitHub Actions CI (.github/workflows/ci.yml): backend · frontend · docker, in parallel
        │  all green, on a commit on master
        ▼
Render (render.yaml, autoDeployTrigger: checksPass)
        │  builds the root Dockerfile
        ▼
backend/scripts/start.sh: alembic upgrade head → uvicorn (one worker)
        │  Render polls GET /api/health/live
        ▼
the new instance gets the traffic at https://<service>.onrender.com
```

- A pull request runs CI but deploys nothing. Only commits on `master` deploy.
- If any check fails, or is still running, Render doesn't deploy that commit.
- First CI run: `a151cf7` on `master`, green (2026-11-10). The repo is public, so Actions minutes are free.

## Where everything runs

| Piece | Service | Details |
|---|---|---|
| App (API + frontend) | **Render**, web service `card-table` | Docker, free plan, Frankfurt. The API serves the built frontend, so the app, `/api` and later `/ws` share one origin. |
| Postgres | **Neon** | Project `card-table`, Postgres 16, AWS eu-central-1, **direct** endpoint (connection pooling off). |
| Redis | **Upstash** | Database `card-table`, AWS eu-central-1, TLS (`rediss://`). |
| Card art | **Cloudflare R2** | Bucket `card-art-prod`, public through its `r2.dev` URL. Kept separate from the dev bucket. |
| CI | **GitHub Actions** | Repo `artryry/web_board_game`. |

## Files

| File | Role |
|---|---|
| `.github/workflows/ci.yml` | The CI checks |
| `render.yaml` | Render Blueprint: the service, plan, region, branch, health check path and env var names |
| `Dockerfile` | Two stages: `node:24.22.2-alpine3.24` builds `frontend/dist`; `python:3.12.16-slim-trixie` installs `requirements.txt`, copies `backend/` to `/srv/backend` and `dist/` to `/srv/frontend/dist`, runs as user `app` |
| `.dockerignore` | Keeps `.env` files, `node_modules`, `venv`, caches, `backend/tests`, `context/` and `nginx/` out of the image |
| `backend/scripts/start.sh` | The container's start command: migrations, then uvicorn on `$PORT` with proxy headers trusted |
| `backend/app/frontend.py` | Serves `dist/` when `FRONTEND_DIST_DIR` is set (only in the image) |
| `backend/requirements.txt` / `requirements-dev.txt` | Runtime packages (the image) / plus pytest, ruff, mypy (dev and CI) |
| `.gitattributes` | Keeps `*.sh` at LF line endings, or the script breaks in Linux |

## CI

Runs on every push and pull request to `master`. A newer push to the same branch cancels the run in progress.

| Job | What it does |
|---|---|
| `backend` | Python 3.12, `pip install -r requirements-dev.txt`, then `ruff check`, `ruff format --check`, `mypy app tests`, `pytest`. A `postgres:16-alpine` service container is the test database; Redis and R2 are faked in the tests, but `Settings` still needs every variable, so the workflow sets placeholders. |
| `frontend` | Node from `frontend/.nvmrc`, `npm ci`, then `lint`, `format:check`, `typecheck`, `test`, `build`. |
| `docker` | `docker build .`, so a broken Dockerfile fails here, not on Render. |

- Playwright e2e isn't in CI: it needs the whole stack. Run `npm run e2e` locally.
- A new **required** setting needs a placeholder in the `backend` job's `env`, or the tests fail to start.

## Deploys on Render

- **Automatic:** a green commit on `master` deploys. Render builds the image (a few minutes), starts it, and switches traffic once `/api/health/live` answers.
- **Manual:** service → **Manual Deploy → Deploy latest commit**. Use it after changing env vars (or pick "Save, rebuild and deploy" when saving them).
- **Rollback:** service → **Events** → an earlier successful deploy → **Rollback**. It redeploys the old code, but **doesn't undo migrations**. Keep migrations backward-compatible (add columns before code uses them, drop them a release later), so a rollback still works.
- **Migrations** run on every start, before uvicorn (`alembic upgrade head`, a no-op when already at head). The free plan has no pre-deploy step; there's one instance, so starts never race. If a migration fails, the container exits and the deploy fails, while the previous instance keeps serving.
- **Logs:** service → **Logs**. One JSON object per line; see [Reading the logs](#reading-the-logs). Render's health checks (`/api/health/live` every few seconds) are logged at DEBUG, so they don't show at the default `LOG_LEVEL=INFO`.

## Environment variables

Production values live **only** in the Render dashboard (service → **Environment**). `render.yaml` lists the names with `sync: false`, so they never enter git.

| Variable | Value in production |
|---|---|
| `DATABASE_URL` | Neon → **Connect**, pooling **off**, copied as-is (`postgresql://…@ep-<name>.eu-central-1.aws.neon.tech/<db>?sslmode=require&channel_binding=require`). `Settings` converts it to `postgresql+asyncpg://…?ssl=require`. |
| `REDIS_URL` | Upstash → **Connect** → the TCP URL `rediss://default:<password>@<name>.upstash.io:6379` (not the REST URL). |
| `REDIS_PASSWORD` | Not set: the password is in the URL. |
| `R2_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | An R2 API token with Object Read & Write on `card-art-prod` only |
| `R2_BUCKET` | `card-art-prod` |
| `R2_PUBLIC_BASE_URL` | The bucket's `https://pub-<hash>.r2.dev` URL |
| `JWT_SECRET` | Generated by Render. Changing it logs everyone out. |
| `FRONTEND_DIST_DIR` | Set by the Dockerfile; don't set it in Render. |
| `PORT` | Set by Render. |
| `LOG_FORMAT` | `json`, from `render.yaml` (`value:`, not a secret). |
| `LOG_LEVEL` | Not set (INFO). Set `DEBUG` while chasing a problem, then remove it; changing a variable redeploys. It applies to the app's own loggers only. |
| `RENDER_GIT_COMMIT` | Set by Render (if present); the `app.started` line shows it. |
| `ART_SWEEP_ENABLED` | `true`, from `render.yaml`: the daily art sweep (see [Art cleanup](#art-cleanup)). `app.started` shows `art_sweep`. |

The rest (`ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`, `REFRESH_COOKIE_SECURE=true`, upload limits, `ART_SWEEP_INTERVAL_H`, `ART_SWEEP_GRACE_H`, `ART_SWEEP_MAX_DELETES`, …) use the defaults in `core/config.py`. Add one in Render only to override it.

## Health endpoints

| Endpoint | Touches | Used by |
|---|---|---|
| `GET /api/health/live` | nothing | Render, every few seconds. Free to call. |
| `GET /api/health` | Postgres, Redis, R2 | People, after a deploy. 200 with `postgres`, `redis` and `storage` all `true`, or 503. Never point Render's health check here: at Render's rate it would use up Upstash's free commands and keep Neon from sleeping. |

## Reading the logs

The API writes one JSON object per line (backend_plan §10.2). Every line starts with `ts`, `level`, `event` and `logger`, then `request_id` and `user_id` while a request runs.

| Looking for | Search Render's logs for |
|---|---|
| One request, end to end | its `request_id`. A user's "error ID" is its first 8 characters, which is enough. |
| Every error | `"level":"error"` |
| Crashes (500s) | `"error_code":"internal_error"`. The line has the traceback under `exception`. |
| Requests slower than 1 s | `"level":"warning"` and `"event":"http.request"` |
| Errors from browsers | `"logger":"app.client"`, or `"event":"web.`. Each line has `page`, `context` and, for errors, `breadcrumbs`: the pages and API calls just before it. |
| What an import did | `share.imported`. With `LOG_LEVEL=DEBUG`, also `share.import_step` with each step's time. |
| A deploy starting | `app.started` (the `commit` it runs), and Alembic's migration lines before it |
| What the art sweep deleted | `art.swept` (the counts, once a day while the app is awake) and `art.deleted` (one per key) |

Every API request has one `http.request` line with `method`, `path`, `route`, `status`, `duration_ms`, `user_id` and, for an error answer, `error_code`. 4xx answers are INFO, since they are expected. Nothing logs passwords, tokens, cookies, presigned URLs, emails, bodies or query strings.

Locally, uvicorn prints the same lines in colour (`LOG_FORMAT=auto` in a terminal). In the browser's console, dev builds show every log entry and production builds show warnings and errors.

## Art cleanup

The app deletes art objects that no card or origin references and that are older than 24 h. The design is in backend_plan §10.3.
- **Automatic:** with `ART_SWEEP_ENABLED=true`, the app checks 60 s after it starts, then hourly. A Redis key (`art_sweep:last_run`) lets it sweep at most once a day. On the free plan it only runs while the service is awake.
- **By hand:** a dry run lists what would go and deletes nothing. Add `--delete` to delete.

  ```powershell
  docker run --rm --env-file .env.prod card-table python -m scripts.sweep_art            # dry run
  docker run --rm --env-file .env.prod card-table python -m scripts.sweep_art --delete
  ```

  Locally, from `backend/`: `python -m scripts.sweep_art`. It uses the `DATABASE_URL` and `R2_BUCKET` of `.env`, so check first that they belong together. It exits with 1 when the sweep was aborted or a delete failed.
- **The R2 token** needs Object Read & Write on the bucket, which covers listing and deleting.
- **Guard:** with more than `ART_SWEEP_MAX_DELETES` (200) unused objects at once, the sweep deletes nothing and logs `art.sweep_aborted`.
- **Deletes are final:** R2 has no undo, and the sweep has no trash.

## Running the production image locally

Against the hosted services, with their values in a git-ignored `.env.prod`:

```powershell
docker build -t card-table .
docker run --rm -p 8080:8000 --env-file .env.prod card-table   # http://localhost:8080/
```

Against the local docker-compose Postgres and Redis (`docker compose up -d` first). The URL is built inside the container from the `POSTGRES_*` variables, so no secret is typed or copied:

```bash
docker run --rm --name card-table-smoke --network card-table_default -p 8080:8000 --env-file .env card-table \
  sh -c 'export DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB?sslmode=disable"; export REDIS_URL="redis://redis:6379/0"; exec sh scripts/start.sh'
```

Check `/api/health`, open `/login` directly, register, reload (the session should survive), and delete the test user afterwards.

## Free-tier behaviour

Everything can stay running; nothing is billed while idle.

| Service | When idle | At the free limit |
|---|---|---|
| Render | Sleeps after 15 min without traffic (WebSocket messages count as traffic); the next request waits up to about a minute. Sleeping time doesn't use the 750 free hours a month. | Suspended until next month, not billed. Bandwidth is small (reportedly ~5 GB/month); art doesn't count, since it comes from R2. |
| Neon | Compute stops after 5 min; wakes in under a second. | 100 compute-hours a month per project, then paused until next month. 0.5 GB storage. |
| Upstash | No commands, no cost. **Archived after at least 14 days without traffic** (warning emails first). | ~500K commands a month. |
| R2 | Free up to 10 GB and millions of operations a month. The account has a payment method, so a billing alert in Cloudflare is worth setting. The daily art sweep adds one list request per 1000 objects and one request per deleted object. | Billed beyond the free tier (not reachable at this scale). |

- **Upstash archiving:** until rooms exist (M6), only `/api/health` uses Redis, so the database looks idle. The app still works if it is archived; Redis is only connected on use. `/api/health` would then show `redis: false`. Restore it, or create a new database, in the Upstash console, then update `REDIS_URL` in Render. A daily scheduled call to `/api/health` would keep it active.
- **In-process state:** room locks and turn timers (M6) live in the process and are lost when the free instance sleeps or redeploys; room state in Redis survives.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ConnectionRefusedError … ('127.0.0.1', 5432)` in the deploy log | `DATABASE_URL` in Render is the local value (from `.env`). Paste Neon's connection string. This is what failed the first deploy. |
| The same with `6379` | `REDIS_URL` is the local value. Paste Upstash's `rediss://` URL. |
| `Field required` for a variable at startup | A `sync: false` variable wasn't filled in. Add it under Environment. |
| `DATABASE_URL is not a valid database URL` | The value isn't a URL, for example Neon's `psql '…'` snippet or a value wrapped in quotes. Copy the bare connection string. |
| `/api/health` 503 with `redis: false` | Wrong `REDIS_URL`, or the Upstash database was archived (see above). |
| `/api/health` 503 with `storage: false` | Wrong R2 endpoint, keys or bucket name, or the token isn't scoped to `card-art-prod`. |
| Art upload fails in the browser with a CORS error | The `card-art-prod` CORS rule doesn't allow `https://<service>.onrender.com` (`GET`, `PUT`, header `Content-Type`). |
| The first page load takes up to a minute | The free instance was asleep. Expected. |
| A merge to `master` didn't deploy | CI failed or is still running (see the Actions tab), or Auto-Deploy isn't "After CI checks pass". |
| A path returns a JSON 404 instead of the app | Its first segment is `api` or `ws`; those never reach the frontend. Every other unknown path returns `index.html`, and React Router shows its 404 page. |
| A user reports "Something went wrong (error ID: 3f2a9c1e)" | Search the logs for `3f2a9c1e`. The `http.request` line with `"error_code":"internal_error"` has the traceback, and the other lines with that id show what the request did first. |
| `art.sweep_aborted` in the logs | More unused art than `ART_SWEEP_MAX_DELETES` at once. First check that `DATABASE_URL` and `R2_BUCKET` are production's pair: with the wrong database, every object looks unused. Then run the dry run by hand and read the keys. If they really are garbage, run it with `--delete --max-deletes <n>`. |
| `art.sweep_failed` in the logs | The sweep crashed (the traceback is on the line), most likely R2, Neon or Upstash being unreachable. The next hourly check after the interval retries it. A single `art.delete_failed` is retried by the next sweep. |
| No `art.swept` for days | Check that `app.started` shows `"art_sweep":true`. If it's `false`, `ART_SWEEP_ENABLED` isn't set: check Environment in Render (the Blueprint sets it from `render.yaml`). The sweep also needs the service to stay awake for 60 s after a start. |
| Lines in the logs aren't JSON | `LOG_FORMAT` isn't `json` on the service (it comes from `render.yaml`). Lines from before the app starts (Render's own build and deploy messages) are always plain text. |

## Changing the setup later

- **Always-on app:** `plan: starter` in `render.yaml`, move `alembic upgrade head` from `start.sh` to `preDeployCommand: alembic upgrade head`, push.
- **Own domain** (DNS in Cloudflare): add it as a custom domain on the Render service and create the DNS record Render shows. For art, connect a custom domain to the R2 bucket, then update `R2_PUBLIC_BASE_URL` and the CORS rule.
- **A new setting:** add it to `Settings` and `.env.example`; to `render.yaml` (`sync: false` for secrets, `value:` otherwise) and the Render dashboard; and, if it's required, to the CI `backend` job's `env`.
- **More than one worker or instance:** move room locks and messages to Redis first (backend_plan §13).
