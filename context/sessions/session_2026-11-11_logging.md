# Session 2026-11-11: Logging (structured logs in the backend and the frontend)

## Summary
We designed and built structured logging on the `logging` branch. Nothing is committed yet.
- **Backend:**
  - every line has one shape (`ts`, `level`, `event`, `logger`, then `request_id` and `user_id`)
  - coloured in a terminal, compact JSON in production
  - uvicorn's and Alembic's lines go through the same formatter
- **Every request** gets one `http.request` access line, and a request id that the browser sends and the API returns.
- **A crash** answers a JSON 500 with the request id, and its line carries the traceback once.
- **Frontend:**
  - a `log` module replaces `console`
  - errors from the API, React, the router and the window are caught in one place
  - production builds send warnings and errors, with the last 20 steps as breadcrumbs, to a new `POST /api/client-logs`, which writes them as `web.*` lines
- **Secrets** are kept out by design and by a redaction step on both sides.
- **Results:**
  - backend: 461 tests pass (up from 391); ruff, format and mypy are clean
  - frontend: 147 Vitest tests pass (up from 113); lint, format, types and build are clean
  - `gen:api` adds only the new endpoint
- **Not done:** the e2e run and the checks by hand. The local `.env` points at the production services (see Notes).

## How it went
1. **Plan** (plan mode):
   - read the code and the plans; there was no logging except in the health check, and no request ids, error hooks or middleware
   - asked three questions: structlog or stdlib (structlog), where frontend logs go (console plus a server endpoint), and the production format (JSON)
   - a review against the installed uvicorn, Starlette, FastAPI, react-router and react-dom found several issues: uvicorn logs the WebSocket URL with its `?token=`, tracebacks can hold secrets, browsers cap keepalive bodies at 64 KiB, and React and the router report the same error twice
   - the plan went into current-feature.md
2. **Follow-up question:** "is one line per request enough?" For the REST API, the access line plus the traceback finds most problems. Four rules were added for the rest: log a failure that a request survives, log the steps of long flows at DEBUG, keep breadcrumbs in the browser, and log per message on WebSockets (M6).
3. **Backend:**
   - settings, `logging_config.py`, the errors and the middleware
   - the dependencies, then the service events and the client-logs endpoint
   - the ruff rules and the engine guard
   - tests after each step
4. **Frontend:**
   - `src/log/`, then the API client, the errors and the error hooks
   - `RouteErrorPage`, the test log capture, and tests
5. **Found and fixed during the work:**
   - **The access line's route:** FastAPI 0.143 keeps a route that came through `include_router` relative to its router, so the line said `/health`. It is rebuilt from the route's public `path` and `path_regex`.
   - **`make_settings(**overrides)` as a dependency override:** FastAPI read `**overrides` as a required query parameter, and `/api/health` answered 422 in `test_health.py`. Fixed with a lambda.
   - **Abort errors in jsdom:** `DOMException` isn't an `instanceof Error` there, so abort and error detection checks by shape.
   - **Overlapping sends:** the remote sink skipped a flush while a send was running, and a late request leaked into the next test. Sends now queue one after another.
   - **The JSON format:** lines had spaces after colons, which didn't match the searches in deployment.md. Lines are now compact.
   - **The WebSocket test:** Starlette's `TestClient` warns that its httpx use is deprecated, so the test drives ASGI directly.
6. **The e2e run stopped** at its health check: the local `.env` now points at production. Redis refused the login, and Postgres was the Neon project. The API I'd started was stopped, and nothing more ran against those services (see Notes).

## Decisions made
| Topic | Decision |
|---|---|
| Backend library | `structlog==26.1.0` on top of stdlib `logging`; `cache_logger_on_first_use=False` |
| Formats | `LOG_FORMAT=auto` (console in a terminal, JSON otherwise); Render sets `json`. JSON is compact, with `ts, level, event, logger, request_id, user_id` first |
| Levels | `LOG_LEVEL` for `app.*` only; root WARNING; `uvicorn.error` and `alembic` INFO; `sqlalchemy.engine` WARNING |
| Setup | once per process: when `app.main` is imported, and in `alembic/env.py` (alembic.ini lost its logging sections); never in `create_app()` |
| Access line | one `http.request` per request from a plain ASGI middleware. ERROR for a 5xx, WARNING over 1 s, DEBUG for health probes, static files and client logs; uvicorn's access log off |
| Crashes | the middleware answers `internal_error` with the `request_id` and doesn't re-raise; the traceback is printed once |
| Request ids | the browser sends a new `X-Request-ID` per attempt; the API keeps a valid one (`[A-Za-z0-9-]{8,64}`) or makes one; the UI shows the first 8 characters as the "error ID" of a 5xx |
| Secrets | redaction of secret-looking keys at any depth, and scrubbing of JWTs, `token=`, `X-Amz-*` and `user:pass@` (tracebacks too); `hide_parameters=True`; no query strings; uvicorn's paths lose their query |
| Service events | only facts the access line lacks: auth, upload, share (with `share.code_retry` and the DEBUG `share.import_step`), health, client logs, startup |
| Browser logs | `POST /api/client-logs`, auth optional (token decoded only), ≤ 20 entries, ≤ 64 KiB, `web.<event>` on `app.client`, 60 a minute per user or IP and 600 overall, in process |
| Browser sink | prod only, warn and error; batches of 10 or every 5 s under 48 KiB; keepalive on `pagehide`; repeats counted; token bucket of 10, then 20 per 5 min; own failures never sent |
| Breadcrumbs | the last 20 entries of every level, including `nav.page_viewed` and `api.request` |
| Lint | ruff `T20`, `G` and `LOG`; ESLint `no-console` except `log/consoleSink.ts`; a test that the engine imports no logging |

## Files changed
- **New (backend):**
  - `app/core/logging_config.py`, `app/core/middleware.py`
  - `app/api/client_logs.py`, `app/schemas/client_log.py`, `app/services/client_log_service.py`
  - `tests/test_logging.py`, `tests/test_middleware.py`, `tests/test_client_logs.py`, `tests/engine/test_no_logging.py`
- **Changed (backend):**
  - `requirements.txt` (structlog), `pyproject.toml` (ruff rules)
  - in `app/core/`: `config.py` (`log_level`, `log_format`, `render_git_commit`), `errors.py`, `deps.py`, `db.py`
  - `app/main.py`, `app/api/router.py`
  - the health, auth, upload and share services
  - `alembic/env.py`, `alembic.ini`
  - `tests/conftest.py`, `tests/helpers.py`
  - the auth, uploads, share and health tests
- **New (frontend):**
  - `src/log/`: `logger`, `consoleSink`, `remoteSink`, `errorHandlers`, `pageViews`, `serializeError`, `installLogging`, and their tests
  - `src/api/requestId.ts`
  - `src/RouteErrorPage.tsx` and its test
  - `src/test/logCapture.ts`
- **Changed (frontend):**
  - `src/main.tsx`, `src/App.tsx`, `src/routes.tsx`
  - in `src/api/`: `client.ts`, `errors.ts`, `showServerError.ts`, `uploadArt.ts` and `schema.d.ts` (generated)
  - `src/auth/AuthProvider.tsx`, `src/auth/tokens.ts`
  - `src/test/setup.ts`, `eslint.config.js`
  - the client, errors and ArtUpload tests, and `e2e/auth.spec.ts`
- **Repo root:** `.env.example`, `render.yaml` (`LOG_FORMAT=json`).
- **Docs:**
  - `backend_plan.md`: §2, §3, §8, §9.2, the new §10.2 and §13
  - `frontend_plan.md`: §2 and the new §6.1
  - `coding-standards.md`: a logging part in §1, plus §2, §3 and §4
  - `deployment.md`: the env vars, "Reading the logs" and troubleshooting
  - `current-feature.md`

## Verification
- **Backend:**
  - `pytest`: 461 passed
  - `ruff check .` and `ruff format --check .`: clean
  - `mypy app tests`: no issues in 120 files
- **Frontend:**
  - `npm run lint`, `format:check` and `typecheck`: clean
  - `npx vitest run`: 147 passed, with no console output in the run
  - `npm run build`: built
  - `npm run gen:api`: 123 added lines, all for the new endpoint
- **Docker:** `docker build` of the production image succeeded, with structlog 26.1.0 inside. The image wasn't run.
- **By running the dev API:**
  - startup lines (uvicorn's included) and `app.started` came out as JSON in the shared shape
  - a 503 health check showed its two `health.check_failed` warnings and the ERROR access line under one `request_id`
- **Not run:**
  - `npm run e2e`: global setup stopped at the 503
  - the production image (`docker run` with `.env.prod`)
  - a forced browser error in a production build
  - Render after a deploy

## Notes
- **The local `.env` points at production.** `DATABASE_URL` is the Neon project and `REDIS_URL` is Upstash. The file was last changed 2026-11-10, during the deployment.
- **What touched Neon this session:**
  - `pytest` ran against a `neondb_test` database on the Neon server, created if missing. Every test rolls back, and `neondb` wasn't touched.
  - The dev API I started served only the OpenAPI schema and one health check (`SELECT 1`, and a Redis login that was refused). It is stopped.
  - The e2e run never got past its health check, so no `e2e_…` users were created.
- **Redis from that `.env`** fails with `AuthenticationError`, probably because the local `REDIS_PASSWORD` overrides the password in Upstash's URL.
- **Still unchecked:** whether Render sets `RENDER_GIT_COMMIT`, and whether it rewrites `X-Forwarded-For`.
- **The query retry policy** retries a 5xx twice, so one failing query gives three server error lines. This was left as it was (out of scope).

## Next steps
1. Put the local values back in `.env` (`127.0.0.1` for Postgres and Redis, as in `.env.example`), and keep the production values in `.env.prod`.
2. Run `npm run e2e`, and check the dev terminal's coloured lines.
3. Run the production image locally with `.env.prod`. Force a browser error in it, and find the `web.*` line by its request id.
4. Commit, merge, and check Render's logs after the deploy (`LOG_FORMAT=json` comes from `render.yaml`; check the service picked it up).
5. Optionally drop `neondb_test` in the Neon console.
