# Current feature: Deployment — Render + Neon + Upstash + R2, with CI

**Status:** code done (2026-11-10) on branch `ci-cd-prepare`, not committed yet. The hosted services are still to be created by the user (see "Manual setup"), then the first deploy follows.
**Plan reference:** [backend_plan.md §10.1](backend_plan.md), [frontend_plan.md §1](frontend_plan.md) (production paragraph)
**Previous feature:** F0 (frontend scaffold, auth pages and app shell), done and committed as `d78c24f`; see [sessions/session_2026-11-06.md](sessions/session_2026-11-06.md) and [session_2026-11-08.md](sessions/session_2026-11-08.md).
**Next:** F1 (catalog and `SchemaForm`, origin and card editors, card library, art upload).

## Goal
The app runs publicly at `https://<service>.onrender.com`, deployed from `master` after CI passes, with Postgres on Neon, Redis on Upstash and card art on R2. Local development is unchanged.

## Done when
- [x] One Docker image builds the frontend and runs the API, which serves the frontend on the same origin.
- [x] The backend accepts Neon's connection string and Upstash's `rediss://` URL as they are copied from their dashboards.
- [x] Render's health check (`/api/health/live`) touches no service.
- [x] CI runs the backend and frontend checks and a `docker build` on every push and pull request to `master`.
- [x] Docs: backend_plan §10.1, frontend_plan §1, CLAUDE.md, `.env.example`.
- [ ] Neon, Upstash and the production R2 bucket exist, and the image passes `/api/health` against them locally.
- [ ] Render deploys `master`; `/api/health` returns all `true`; register, log in and reload keep the session; a deep link such as `/login` loads.
- [ ] The R2 bucket's CORS rule allows the Render origin (needed once F1 uploads art).

## Decisions (2026-11-10)
- **Hosting:** Render free web service (Docker, Frankfurt) + Neon + Upstash, all in Frankfurt / AWS eu-central-1. Railway (~$5/mo, everything in one place), Render Starter (~$7/mo, always on) and a Hetzner VPS (~€4–5/mo, self-managed) were considered; the user chose $0 for now. Moving to Railway or Starter later keeps the Dockerfile and backend changes.
- **One service, one origin:** the API serves the built frontend (`app/frontend.py`), because the refresh cookie is `SameSite=Strict` on `/api/auth` and the client uses same-origin requests. No CORS, no frontend changes, `VITE_API_ORIGIN` stays empty.
- **Neon direct endpoint, not the pooler:** one process with its own SQLAlchemy pool needs no PgBouncer, and the pooler breaks asyncpg's prepared-statement cache. `Settings` converts `sslmode`/`channel_binding` into asyncpg's `ssl`.
- **Migrations on start:** Render's pre-deploy step is paid-only, so `scripts/start.sh` runs `alembic upgrade head` before uvicorn. With one instance there's no race.
- **Liveness vs health:** Render polls every few seconds. The full `/api/health` would spend Upstash commands (free tier ~500K a month) and R2 operations on every probe and keep Neon awake, so Render polls `/api/health/live` instead.
- **No domain yet:** the app is on `onrender.com`, art on R2's `r2.dev` URL (rate-limited). A domain later only changes `R2_PUBLIC_BASE_URL`, the CORS rule and Render's custom domain.
- **CI gates deploys:** `autoDeployTrigger: checksPass`. Playwright e2e stays local, since it needs the whole stack.
- **Settings hide their input in errors** (`hide_input_in_errors`), so a bad `DATABASE_URL` can't print its password into the Render logs.

## Tasks

### Backend
- [x] `core/config.py`: `to_asyncpg_url` + a `database_url` validator; `redis_password` optional; `frontend_dist_dir`; `hide_input_in_errors`.
- [x] `main.py`: pass the Redis password only when set, `health_check_interval=30`; `create_app(frontend_dist_dir)`.
- [x] `app/frontend.py`: `/assets` static files; a GET/HEAD catch-all after the API routes that 404s `api…`/`ws…`, serves files inside `dist/` and otherwise returns `index.html` (`Cache-Control: no-cache`); fails at startup without `index.html`.
- [x] `GET /api/health/live` (`LivenessResponse`).
- [x] Tests: `test_config.py`, `test_frontend.py`, a liveness test in `test_health.py`.
- [x] `requirements-dev.txt` (dev tools moved out of `requirements.txt`).

### Deploy files
- [x] `Dockerfile` (node 24.22.2-alpine3.24 → python 3.12.16-slim-trixie, non-root), `.dockerignore`, `backend/scripts/start.sh`, `.gitattributes` (`*.sh` stays LF).
- [x] `render.yaml`: free, Frankfurt, `master`, `checksPass`, `/api/health/live`, secrets `sync: false`, `JWT_SECRET` generated.
- [x] `.github/workflows/ci.yml`: backend (Postgres service), frontend, docker.
- [x] `.gitignore`: `.env.*` except `.env.example`.

### Manual setup (the user)
Collect 7 values for Render and keep them out of git (a password manager, or a local `.env.prod`):
`DATABASE_URL`, `REDIS_URL`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`.

- [ ] **Neon** (neon.com): project `card-table`, Postgres 16, AWS Europe Central 1 (Frankfurt). Connect → **connection pooling off** → copy the string → `DATABASE_URL` (paste it unchanged).
- [ ] **Upstash** (upstash.com): Redis database `card-table`, primary region AWS eu-central-1, no read replicas, Free. Copy the TCP URL `rediss://default:…@….upstash.io:6379` → `REDIS_URL` (not the REST URL).
- [ ] **Cloudflare R2:**
  1. bucket `card-art-prod` (Automatic or Western Europe; not EU jurisdiction) → `R2_BUCKET`
  2. Settings → Public Development URL → Allow → `R2_PUBLIC_BASE_URL`
  3. Manage API tokens → Object Read & Write on that bucket only → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
  4. `R2_ENDPOINT` = `https://<account_id>.r2.cloudflarestorage.com`
- [ ] **Local smoke test:** `docker build -t card-table .`, then `docker run --rm -p 8080:8000 --env-file .env.prod card-table`. `http://localhost:8080/api/health` shows all `true`; register, log in, reload.
- [ ] **GitHub:** merge `ci-cd-prepare` into `master`; CI is green. Optional: require the three checks on `master`.
- [ ] **Render:** sign in with GitHub, give the Render app access to `artryry/web_board_game`, New → Blueprint → this repo, enter the 7 values. Check Settings → Auto-Deploy is "After CI checks pass".
- [ ] **R2 CORS** on `card-art-prod`, with the Render URL:
  ```json
  [{"AllowedOrigins": ["https://<service>.onrender.com"], "AllowedMethods": ["GET", "PUT"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3600}]
  ```

## Free-tier limits to keep in mind
- Render free sleeps after 15 minutes without traffic; the next visitor waits up to about a minute. WebSocket messages count as traffic. Included bandwidth is small (reportedly ~5 GB a month since 2026); art doesn't count, since it comes from R2.
- In-process room locks and turn timers (M6) are lost when the service sleeps or redeploys; room state in Redis survives. M6 must restore timers from the stored deadline, or the app moves to an always-on plan.
- Neon free: the first query after ~5 idle minutes waits for the compute to wake; 0.5 GB storage.
- Upstash free: ~500K commands a month, 256 MB.

## Carried over
- **R2 CORS rule for development (manual, from M2):** the dev bucket must allow `PUT` and `GET` from `http://localhost` with the `Content-Type` header before F1's uploads work. The JSON is in [session_2026-11-01.md](sessions/session_2026-11-01.md) and backend_plan §10.

## Open questions
- None right now.
