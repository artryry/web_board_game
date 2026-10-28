# Current feature: M0 — Infrastructure

**Status:** done (2026-10-23).
**Plan reference:** [backend_plan.md §10 (Infrastructure tasks) and §11 (M0)](backend_plan.md)

## Goal
Make the backend skeleton runnable end-to-end. All services start with `docker compose up`, the API connects to Postgres, Redis and Cloudflare R2, and a health check passes through nginx.

## Done when
- [x] `docker compose up -d` starts every service without errors, including nginx.
- [x] `uvicorn app.main:app` starts on the host using settings from `.env`.
- [x] `GET http://localhost/api/health` (through nginx) returns `200` and reports Postgres, Redis and R2 as reachable.
  - Confirmed with real R2 credentials: `{"status":"ok","postgres":true,"redis":true,"storage":true}`.
  - Stopping Redis gives 503 with `redis:false`.
- [x] `alembic upgrade head` runs cleanly against the Postgres container.

## Tasks
- [x] **Dependencies:** `backend/requirements.txt`, pinned from `pip freeze` (runtime and dev tools).
- [x] **Settings:** `app/core/config.py`. It reads the repo-root `.env` by absolute path, and secrets are `SecretStr`.
- [x] **`.env.example`:** lists every variable used by `docker-compose.yml` and `Settings`.
- [x] **DB session:** `app/core/db.py`, with `Base`, `create_engine` and `create_session_factory`. The lifespan owns the engine.
- [x] **Dependencies module:** `app/core/deps.py`, with `get_db`, `get_redis` and `get_s3`.
- [x] **App factory:** `app/main.py`:
  - `create_app()`
  - a lifespan on an `AsyncExitStack` (DB engine, Redis, R2 client)
  - `app/api/router.py` mounts the routers under `/api`
- [x] **Health endpoint:** `GET /api/health` returns `{status, postgres, redis, storage}`.
  - It returns 503 if any check fails.
  - Checks run concurrently, with `HEALTH_CHECK_TIMEOUT_S` (default 2 s), and failures are logged.
- [x] **Storage client:** `app/storage/client.py`, with an R2 client (aioboto3) and `bucket_exists`.
- [x] **Alembic:** async `env.py` using `Settings` and `Base.metadata`, plus the baseline migration `4acec3597752`. The template uses modern type syntax.
- [x] **nginx:** `nginx/default.conf` with `/api/`, `/ws/` (upgrade, 1 h timeout) and `/` (Vite, with HMR upgrade). There is no `/media/` (see decisions).
- [x] **docker-compose:** removed `minio` and `minio-init` (see decisions).
- [x] **Tooling:** `backend/pyproject.toml` (ruff with line length 100, mypy strict on `app.engine.*`, pytest `asyncio_mode=auto`).
- [x] **Test:** `tests/test_health.py` covers 200 and 503 (Redis down), using dependency overrides with no real services.

## Out of scope (later milestones)
- Users, auth and JWT (M1)
- Any domain tables or models: origins, cards, decks (M2+)
- Presigned uploads (M2)
- Seed data script (M2/M4)
- Frontend scaffold (F0)

## Notes and decisions
- **Storage is Cloudflare R2, not MinIO.**
  - The official `minio/minio` and `minio/mc` images are gone from Docker Hub and quay.io.
  - R2 is reached through its S3 API with `aioboto3` (async, so no blocking I/O), using `region_name="auto"` and checksums only when required.
  - The health field is called `storage` so it isn't tied to a provider.
- **Card art is served from the R2 public URL** (a custom domain or r2.dev), not through an nginx `/media/` proxy.
  - M2 will add a setting for that public base URL.
  - M2 also needs a CORS rule on the bucket for browser presigned `PUT`s.
- **`.env` lives at the repo root** and is shared by compose and the API. All settings are required, and R2 values are validated as non-empty, so the app, alembic and anything else that loads `Settings` fail at startup with a clear error until `.env` is complete.
- **Use `127.0.0.1`, not `localhost`, in `DATABASE_URL`/`REDIS_URL`.** On Windows, `localhost` tries `::1` first, and the containers bind only IPv4, which added about 2 s per connection and made every health check time out.
- ruff marks `alembic` as third-party, because the local `alembic/` folder confuses isort, and ignores F401 in `alembic/versions/`.

## Setup notes for a fresh machine
1. In Cloudflare, create an R2 bucket and an API token with Object Read & Write on that bucket.
2. In `.env`, fill in `R2_ENDPOINT` (`https://<account_id>.r2.cloudflarestorage.com`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`.
3. Run uvicorn, then `curl http://localhost/api/health`. Expect 200 with every check true.
