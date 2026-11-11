# Current feature: Logging — structured logs in the backend and the frontend

**Status:** built 2026-11-11 on branch `logging` (from `master` at `0ff34e9`), not committed yet. Backend and frontend checks pass. Still to do: the e2e run and the checks by hand, blocked because the local `.env` points at the production services (see Open questions). See [sessions/session_2026-11-11_logging.md](sessions/session_2026-11-11_logging.md).
**Plan reference:** [backend_plan.md §3, §8, §9.2 and §10](backend_plan.md) (a new §10.2 Logging), [frontend_plan.md §2 and §6](frontend_plan.md), [coding-standards.md](coding-standards.md), [deployment.md](deployment.md)
**Depends on:** M3, F1 and the deployment (all done).
**Unblocks:** M6 and F4–F5, which log rooms, sockets and games through it. Production problems can be traced from a user's error message to the server's log line.

## Goal
Both the backend and the frontend write logs that are structured (named fields, not sentences) and easy to read:
- **Backend:**
  - one line per request
  - the request id and user id on every line
  - a traceback for every crash
  - coloured lines in dev, JSON lines in production
- **Frontend:**
  - a small logger instead of `console.*`
  - API, React and window errors caught in one place
  - in production, warnings and errors sent to the backend, so they show up in Render's logs next to the API's lines
- **One request id** links a browser error, the API's access line and any service line from the same request.

## How it works

### The flow
```
Browser                                    API (one uvicorn worker)                      stdout
log.warn / log.error ─┬─ console sink
                      └─ remote sink (prod) ─► POST /api/client-logs ─► "web.<event>" ─┐
authFetch, X-Request-ID ────────────────────► RequestContextMiddleware                  │
                                               ├ binds request_id                      ├─► structlog ─► coloured lines (dev)
                                               ├ get_current_user binds user_id        │               JSON lines (prod) ─► Render → Logs
                                               ├ service events ("share.imported") ────┤
                                               └ one access line ("http.request") ─────┘
uvicorn, Alembic, SQLAlchemy (stdlib logging) ───────────────────────────────────────────┘
```

### A log line
Every backend line is one **event** plus fields:
- **always:** `ts` (UTC, ISO 8601), `level`, `event`, `logger`
- **during a request:** `request_id`, and `user_id` once the user is known
- **then:** the event's own fields

Production (JSON, one object per line):
```json
{"ts":"2026-11-11T10:15:02.123Z","level":"info","event":"http.request","logger":"app.access","request_id":"3f2a9c1e4b7d…","user_id":"8b1d…","method":"POST","path":"/api/cards","route":"/api/cards","status":409,"error_code":"card_in_use","duration_ms":14}
```
Dev (structlog's console renderer) shows the same fields on one coloured line: time, level, event, then `key=value` pairs.

### Event names and levels
- **Names** follow `<area>.<what_happened>` in snake_case, for example `http.request`, `auth.registered`, `share.imported` and `upload.ticket_issued`.
- **Details go in fields, never in the message.** Write `log.info("share.imported", kind="deck", cards=12)`, not an f-string.

| Level | When | Examples |
|---|---|---|
| DEBUG | Detail for development; off in production | health-probe and static-file access lines; a 4xx in the browser |
| INFO | Normal, notable events | every API request, a user registered, a share imported, the app started |
| WARNING | Unexpected but handled | a failed health check, a request slower than 1 s, browser logs dropped by the rate limit, a network error in the browser |
| ERROR | A bug or an outage, always with a traceback or stack | an unhandled exception (500), a render error in the browser |

A 4xx is an expected answer, not an error. It shows as INFO on the access line, with its `error_code`.

### When one line per request isn't enough
For the REST API, the access line plus the traceback finds most problems:
- a crash gives an ERROR line with the traceback and the request id
- a rejected request gives an INFO line with its `error_code`
- the service events record what was created or imported

Four cases need more:
1. **A failure the request survives gets its own line.**
   - Code that catches an exception and carries on (a retry, a fallback or a default) logs it.
   - Use WARNING with the exception when it's unexpected, and DEBUG when it's a normal race.
   - An `except` that doesn't re-raise, log, or turn into an `AppError` is a bug ([coding-standards §1](coding-standards.md): never swallow).
   - Today only the share-code retry carries on (`share.code_retry`, DEBUG). The other `IntegrityError` races end as a 409 or are re-raised, so the access line already covers them.
2. **Long flows log their steps at DEBUG.**
   - This covers flows with several outside calls or many writes:
     - **share import:** source loaded, origins copied, cards copied, committed
     - **the art check on save:** the R2 `HEAD` and its result
   - Each step carries its duration, which shows which step was slow.
   - The steps are off in production. `LOG_LEVEL=DEBUG` on Render turns them on while chasing a problem (changing an env var redeploys).
3. **The browser keeps breadcrumbs.**
   - The logger keeps the last 20 entries of every level in memory, including two new debug events:
     - `nav.page_viewed`, with the route pattern
     - `api.request`, with the method, path, status, duration and request id
   - An error sent to the server carries them as `breadcrumbs`. Its line then shows the steps that led to it, without sending every step.
4. **Work outside a request logs itself.** Startup and migrations already do (`app.started` and Alembic's lines). From M6:
   - **WebSockets:** a socket is one request that lasts a whole game, so it logs per message:
     - `ws.connected`, and `ws.closed` with its duration and close code
     - `game.started` and `game.ended`
     - `game.action_rejected` (INFO, with the reason) and `game.action_applied` (DEBUG)
     - `timer.expired` and `ws.resync`
     - each with `room_code` and `game_id`
   - **Background tasks** run through a small wrapper that logs an exception at ERROR with its traceback. Otherwise asyncio only prints "Task exception was never retrieved", late or never.

Not planned: holding a request's DEBUG lines and printing them only when the request fails. This can be added later if tracebacks turn out not to be enough.

### What is never logged
- **Credentials:**
  - passwords and password hashes
  - access and refresh tokens
  - the `Authorization`, `Cookie` and `Set-Cookie` headers
  - presigned upload URLs
  - secrets and connection URLs from `Settings`
- **Personal data:** emails.
- **Request and response bodies:** only named fields are logged.
- **Query strings:** M6's WebSocket puts the access token in `?token=`.
- **Local variables in tracebacks.**

Safety nets:
- **Redaction (both sides):** values under keys such as `password`, `token`, `secret`, `authorization`, `cookie`, `access`, `refresh` and `upload_url` become `[redacted]`, including inside nested fields.
- **Scrubbing (backend):** text that looks like a JWT, a `token=` value, an `X-Amz-Signature` or `X-Amz-Credential` value, or `user:pass@` in a URL is replaced. This covers stdlib lines and exception messages too.
- **SQLAlchemy** runs with `hide_parameters=True`, so a database error doesn't print the email and password hash of a failed insert.

These are logged on purpose, since only the developer reads the logs and they are all in the database anyway:
- user ids
- the client IP, on the access line only
- share and room codes inside paths

### Request ids
- **The browser** makes a new id for each API request attempt:
  - `crypto.randomUUID()`, falling back to `crypto.getRandomValues` on plain HTTP (a LAN IP)
  - sent as `X-Request-ID`
  - a retry after a token refresh gets a new id
- **The API:**
  - keeps an incoming id that matches `^[A-Za-z0-9-]{8,64}$`, and otherwise makes its own (`uuid4().hex`)
  - uses the id only to link log lines, never as a key for anything
  - returns it in the `X-Request-ID` response header and adds it to every line during the request
  - puts it in the body of a 500
- **The UI:**
  - `ApiError.requestId` keeps the id
  - the message for a 5xx ends with "(error ID: 3f2a9c1e)", the first 8 characters, so a user's report can be found in the logs
- **Exceptions:**
  - The R2 upload doesn't get the header, because the bucket's CORS rule would refuse it.
  - Browsers can't send headers on a WebSocket, so the server always makes those ids.

### Backend
- **structlog 26.1.0 on top of stdlib `logging`.** Our code logs through structlog. uvicorn, Alembic and SQLAlchemy lines go through the same formatter, so every line has the same shape.
- **`core/logging_config.py`**, `configure_logging(settings)`:
  - **Handler:** one root handler, writing to stdout.
  - **Renderer:**
    - dev: `ConsoleRenderer` with plain tracebacks (no locals)
    - production: `JSONRenderer` after `format_exc_info`
  - **Processors** run in this order: contextvars, level, logger name, timestamp, then redaction and scrubbing. Lines from stdlib loggers go through them too.
  - **Levels:**
    - root: WARNING
    - `app`: `LOG_LEVEL`
    - `uvicorn.error` and `alembic`: INFO
    - `sqlalchemy.engine`: WARNING

    So `LOG_LEVEL=DEBUG` never turns on third-party debug output; botocore's includes signed headers.
  - **uvicorn:**
    - `disable_existing_loggers=False`
    - uvicorn's loggers send their lines to the root handler
    - uvicorn's own access log is turned off in code, since the middleware writes the access line. The dev command needs no new flag.
    - a filter on `uvicorn.error` strips the query string from WebSocket handshake lines
  - **`cache_logger_on_first_use=False`**, so tests can capture logs.
  - **Called once per process:**
    - when `app/main.py` is imported. Not in `create_app()`, which tests call for every test.
    - from `alembic/env.py`, instead of `fileConfig`. `alembic.ini` loses its logging sections.
  - **`get_logger(__name__)`:** all app loggers live under `app.`
- **Settings:**
  - `LOG_LEVEL`: DEBUG, INFO, WARNING or ERROR, in any case. The default is INFO.
  - `LOG_FORMAT`: `auto`, `console` or `json`. `auto` gives console output in a terminal and JSON otherwise.
  - `render.yaml` sets `LOG_FORMAT` to `json`.
- **`core/middleware.py`**, `RequestContextMiddleware`. It is a plain ASGI middleware (not `BaseHTTPMiddleware`) and handles both HTTP and WebSocket:
  - **Request id:** it clears the context, sets the request id (in the context and in `scope["state"]`) and adds `X-Request-ID` to the response.
  - **Access line:** one `http.request` per request, with `method`, `path` (without the query string), `route` (the template), `status`, `duration_ms`, `user_id`, `error_code` and `client_ip`.
  - **Level of the access line:**
    - ERROR for a 5xx
    - WARNING when the request took over 1 s
    - INFO otherwise
    - DEBUG below 400 for `/api/health/live` (Render polls it every few seconds), static files and `/api/client-logs`
  - **Unhandled exception:**
    - The access line becomes ERROR, with `error_code=internal_error` and the traceback.
    - The middleware sends the JSON 500 itself: `{"detail": {"code": "internal_error", "message": "Something went wrong.", "request_id": …}}`. Nothing else prints the traceback again.
    - It catches `Exception` only, never cancellation.
    - If the response has already started, it only logs.
    - A WebSocket is closed with code 1011 instead.
  - **`user_id` and `error_code`** are read from `request.state`. They are set by:
    - `get_current_user`
    - the `AppError` and `HTTPException` handlers
    - a wrapper around FastAPI's 422 handler, which sets `validation_error` and leaves the body unchanged
- **`get_current_user`** stays async, sets `request.state.user_id`, and binds `user_id` so service lines carry it.
- **Service events** are added only where they give facts the access line lacks, since the access line already shows who called which route and the result:

| Event | Level | Fields | Where |
|---|---|---|---|
| `app.started`, `app.stopped` | INFO | log level and format, and the commit (`RENDER_GIT_COMMIT`, if set) | lifespan |
| `auth.registered`, `auth.logged_in` | INFO | `user_id` (the access line has none on these routes) | auth service |
| `upload.ticket_issued` | INFO | kind, content type, size and `art_key`, never the URL | upload service |
| `share.created`, `share.revoked`, `share.imported` | INFO | kind, ids, and the number of cards and origins copied | share service |
| `share.code_retry` | DEBUG | the attempt number | share service (a code collision or a concurrent share) |
| `health.check_failed` | WARNING | the check's name, with the exception | health service (already logs; moves to structlog) |
| `client_logs.dropped` | WARNING | count and reason | client log service |

The DEBUG steps of the share import and the art check (see "When one line per request isn't enough") aren't listed here.

- **The engine never logs.** It stays pure: it returns errors and events, and the service that runs it logs them. A test checks that `app/engine` never imports `logging` or `structlog`.
- **Background tasks** (M6's turn timers) start with an empty context, so they don't inherit the request id of the request that created them. They bind their own fields, such as `room_code` and `game_id`.

### Frontend
- **`src/log/`** imports nothing from `api/` or `auth/`. It holds:
  - **`logger.ts`:**
    - `log.debug/info/warn/error(event, fields?)`
    - each entry gets `ts`, `level`, `event` and `page` (the path without the query string)
    - the same key redaction as the backend
    - a ring buffer of the last 20 entries of every level, attached as `breadcrumbs` to the `error` entries the remote sink sends
  - **`consoleSink.ts`:**
    - the only file allowed to call `console` (ESLint's `no-console` applies everywhere else)
    - dev prints every level; production prints warn and error
  - **`remoteSink.ts`:**
    - **When:** production builds only, warn and error only.
    - **Batches:** at most 10 entries, sent every 5 s, each under about 48 KiB.
    - **Sending:**
      - with plain `fetch`, not `authFetch`, so there are no refresh loops
      - with the bearer token when there is one
      - on `pagehide`, what is left goes with `keepalive: true`, which browsers cap at 64 KiB
    - **Flood control:**
      - the same event and message repeated within 60 s is counted, not resent
      - a token bucket allows 10 at once, then 20 more per 5 minutes
      - the queue has a size cap
    - **Its own failures** are never sent.
  - **`errorHandlers.ts`:**
    - **Window `error` events:** caught in the bubble phase, so broken images don't count. "Script error." and errors from browser extensions are dropped.
    - **Window `unhandledrejection` events.**
    - **React's root hooks:** `onUncaughtError`, `onCaughtError` and `onRecoverableError`.
    - **The router's `onError`.**
    - Each error is logged once (a `WeakSet` remembers it).
  - **`serializeError.ts`:** name, message and stack, with the stack cut to 2000 characters.
  - **`installLogging({ apiOrigin, getAccessToken })`:** called in `main.tsx`; sets up the sinks. Tests install a memory sink instead.
- **API client:** `authFetch`:
  - sets the request id and times the request
  - logs every call as `api.request` (debug), with method, path, status, `request_id` and `duration_ms`
  - logs `api.request_failed` (warn) for a 5xx, with its code, or for a network error; nothing for an `AbortError` from a cancelled query
- **`RouteErrorPage.tsx`** is the root route's `errorElement`. It shows "Something went wrong" with a Reload button. Today react-router's default screen shows the stack trace, even in production.
- **Events:**

| Event | Level | Where |
|---|---|---|
| `api.request` | debug, for every call: method, path, status, duration and request id | `api/client.ts` |
| `api.request_failed` | warn for a 5xx or network error (a 4xx shows only on the debug `api.request`) | `api/client.ts` |
| `nav.page_viewed` | debug, with the route pattern | `App.tsx` (the router) |
| `auth.session_expired` | info | `auth/tokens.ts` |
| `auth.restore_failed` | warn | `AuthProvider` (silently swallowed today) |
| `auth.logout_cookie_clear_failed` | warn | `api/client.ts` (a `console.warn` today) |
| `upload.put_failed` | warn | `api/uploadArt.ts`: status, type and size, never the URL |
| `ui.render_error` | error | the React and router error hooks, with the component stack |
| `ui.uncaught_error`, `ui.recoverable_error` | error, warn | React's root hooks |
| `window.error`, `window.unhandled_rejection` | error | the window listeners |

### `POST /api/client-logs`
- **Body:** `{entries: [...]}`, with at most 20 entries. Each entry has:
  - `level`: `warn` or `error`
  - `event`: matches `^[a-z0-9_.]{1,64}$`
  - `message`: at most 500 characters
  - `stack`: at most 4000 characters
  - `page`: at most 200 characters
  - `client_ts`
  - `context`: at most 20 keys matching `^[a-z0-9_]{1,40}$`. Each value is a string (at most 200 characters), a number, a boolean or null.
  - `breadcrumbs`, on `error` entries only: at most 20 items, each with `ts`, `level`, `event` and a `context` of at most 5 keys (same key and value rules). The 64 KiB cap still applies, and the sink splits batches by bytes.
- **Errors:**
  - 413 `payload_too_large` when `Content-Length` is over 64 KiB
  - 422 for an invalid body
- **Auth is optional:**
  - A valid bearer token adds `user_id`. The token is only decoded, with no database query, so sending logs doesn't wake Neon.
  - A missing, expired or invalid token makes the entry anonymous. It never causes a 401.
- **Each entry is logged** on `app.client` as `web.<event>`, so a browser can't fake an `http.request` line. It carries:
  - `source="web"`, `client_ts`, `page`, `message` and `stack`
  - `context` and `breadcrumbs`, each nested under its own key
  - `user_agent` (at most 200 characters)
  - the request's `request_id`
- **Rate limit:**
  - kept in process, since there is one worker
  - 60 entries a minute per user (per IP when anonymous), and 600 a minute overall. The IP comes from `X-Forwarded-For`, which a client can fake, hence the overall cap.
  - extra entries are dropped and counted in one `client_logs.dropped` WARNING per minute
- **The answer** is 204, also when entries were dropped.
- **Its access line** is DEBUG.

### Reading the logs
- **Dev:** the uvicorn terminal shows coloured lines. `LOG_LEVEL=DEBUG` adds the health probes and static files.
- **Production:** Render → the service → **Logs**. You can search for:
  - a `request_id` (the 8 characters of a user's "error ID" are enough)
  - `"level":"error"`
  - an event name
  - an `error_code`
- `deployment.md` gets a short "Reading the logs" section.

## Done when
- [x] **Backend lines:**
  - every line has one shape, with `ts`, `level`, `event` and `logger`, including uvicorn's and Alembic's lines
  - lines are coloured in dev and JSON in production (`LOG_FORMAT`)
  - `LOG_LEVEL` controls our code only
- [x] **Access lines:**
  - every API request gives exactly one `http.request` line, with the request id, the route, the status, the duration, and the user and `error_code` when there are any
  - Render's health probes and static files are DEBUG
- [x] **Request ids:**
  - `X-Request-ID` is kept when it is valid and replaced when it isn't
  - every response returns it, and every line during the request has it
- [x] **Crashes:**
  - an unhandled exception gives one ERROR line with the traceback, and a JSON 500 `internal_error` with the `request_id`
  - the traceback is not printed a second time
- [x] **Never logged:**
  - tokens, passwords, cookies, presigned URLs, secrets, emails, query strings and traceback locals
  - covered by tests for the redaction, the scrubbing and the WebSocket query filter
- [x] **Service events:**
  - the events in the table above are logged, with tests
  - every caught exception that a request survives is logged, including `share.code_retry`
  - the share import and the art check log their steps at DEBUG
  - the engine imports no logging, which is checked by a test
- [x] **`POST /api/client-logs`:**
  - checks its limits (413, 422)
  - logs each entry as `web.<event>`, with `user_id` from a valid token, or anonymously
  - is rate-limited with one `client_logs.dropped` warning, and answers 204
- [x] **Frontend logger:**
  - no `console.*` outside `consoleSink.ts`, enforced by ESLint
  - production sends warn and error in batches, within the byte, repeat and rate limits
- [x] **Frontend events:**
  - API failures, React render errors, window errors and rejections, a failed R2 upload, and a failed session restore are each logged once
  - they carry the request id where there is one
  - an error sent from the browser carries the last 20 steps as `breadcrumbs`
- [x] **UI:** a 5xx message shows "(error ID: …)", and a render error shows `RouteErrorPage` instead of a stack trace.
- [ ] **Checked by hand:**
  - dev: coloured lines
  - the production image run locally: JSON lines
  - a browser error in the production build appears as `web.*`, and it shares the request id with the API's line when an API call failed
  - after deploying, the same on Render
- [ ] **Checks pass:**
  - backend: `pytest` (461 passed), `ruff check .`, `ruff format --check .` and `mypy app tests`: pass
  - frontend: `npm run lint`, `format:check`, `typecheck`, `test` (147 passed) and `build`: pass. `e2e` not run yet (Open questions).
  - `npm run gen:api` changes only what the new endpoint adds: yes

## Decisions
Confirmed with the user on 2026-11-11:
- **Backend library:** structlog, pinned (26.1.0 is the newest release on 2026-11-11), over stdlib-only code.
- **Frontend logs** go to the console, and in production builds warnings and errors also go to `POST /api/client-logs`. No third-party service such as Sentry.
- **Production format:** JSON lines. Dev uses coloured console lines.

Everything else in "How it works" is proposed by this plan.

Changed or added while implementing (2026-11-11), all in the plans now:
- **The access line's `route`:**
  - FastAPI 0.143 keeps a route that came through `include_router` relative to its router (`/health`, `/share/{code}`).
  - The middleware rebuilds the full template from the route's public `path` and `path_regex`: the prefix is the part of the real path in front of the match.
  - A test covers a nested route.
- **JSON lines are compact** (`"level":"error"`, no spaces), so the searches in deployment.md match exactly.
- **The browser's 4xx** shows only on its debug `api.request` line, not as an `api.request_failed`.
- **Recognising errors in the browser:**
  - Abort errors and other error-like values are recognised by their `name` and `message`, since jsdom's `DOMException` isn't an `instanceof Error`.
  - `isAbort` lives in `log/errorHandlers.ts`, and `api/client.ts` uses it.
- **The remote sink** sends one batch after another (a promise chain) instead of skipping a flush while a send runs. Only the `pagehide` send doesn't wait.
- **`client_logs.dropped`** is logged at the first drop of each minute, with `dropped`, `reason` (`source_limit` or `overall_limit`) and `source` (`user` or `ip`). Later drops in that minute are counted but not logged.
- **`get_optional_user_id`** also binds the user, so the `web.*` lines and their access line carry `user_id`. An expired or invalid token logs `auth.optional_token_ignored` at DEBUG.
- **`health.check_failed`** is now a WARNING with the exception, where it was `logger.exception` (ERROR). The request survives, and its access line is the ERROR (503).
- **Test helpers:**
  - `make_settings(**overrides)` takes raw values.
  - Passing it straight to `dependency_overrides` would make FastAPI read `overrides` as a query parameter, so `test_health.py` wraps it in a lambda.
  - `logged()` and `access_line()` live in `tests/helpers.py`, and `logs` in `conftest.py`.
- **The WebSocket middleware test** drives the app through ASGI directly. Starlette's `TestClient` warns that its httpx use is deprecated.

## Tasks
Order:
1. backend setup
2. errors and middleware
3. service events
4. client-logs endpoint
5. lint guards
6. frontend logger
7. API client and error hooks
8. remote sink
9. docs

Each step comes with its tests.

### Backend: setup
- [x] Add `structlog==26.1.0` to `requirements.txt`.
- [x] Add `Settings.log_level` (case-insensitive) and `log_format`. Add both to `.env.example`, and add `LOG_FORMAT` with `value: json` to `render.yaml`.
- [x] `core/logging_config.py`: processors, renderers, levels, redaction and scrubbing, uvicorn's loggers and the WebSocket query filter, and `get_logger`. Call it from `app/main.py` at import and from `alembic/env.py`, and trim `alembic.ini`.
- [x] `hide_parameters=True` in `core/db.py`'s `create_engine`.

### Backend: requests
- [x] `core/errors.py`:
  - the 500 body comes from the same `_error_response` helper
  - the handlers set `request.state.error_code`
  - a wrapper around FastAPI's 422 handler sets `validation_error` and keeps the body
- [x] `core/middleware.py`: `RequestContextMiddleware`, added in `create_app()`.
- [x] `core/deps.py`: `get_current_user` takes the `Request`, sets `request.state.user_id` and binds `user_id`.

### Backend: events
- [x] The lifespan logs `app.started` and `app.stopped`.
- [x] The auth, upload and share services log their events.
- [x] `share.code_retry` in `share_service._get_or_create`.
- [x] DEBUG steps with durations in the share import (`share_service`) and in `upload_service.verify_art_key`.
- [x] `health_service` moves to structlog.

### Backend: client logs
- [x] Add the new files:
  - `schemas/client_log.py`
  - `services/client_log_service.py` (the rate limit and the `web.*` lines)
  - `api/client_logs.py`
- [x] The `breadcrumbs` field on `error` entries, with its limits.
- [x] Add `get_optional_user_id` (decodes the token only) to `core/deps.py`, and register the route in `api/router.py`.
- [x] Run `npm run gen:api`.

### Backend: guards
- [x] Add ruff rules `T20` (no `print`), `G` and `LOG` (logging calls), and fix any findings.
- [x] Add a test that `app/engine` imports neither `logging` nor `structlog`.

### Frontend
- [x] `src/log/`: `logger.ts` (with the breadcrumb ring buffer), `consoleSink.ts`, `errorHandlers.ts`, `serializeError.ts` and `installLogging`, called in `main.tsx`.
- [x] `api.request` on every call in `api/client.ts`, and `nav.page_viewed` on route changes in `App.tsx`.
- [x] ESLint: `no-console: "error"` for `src/`, except `src/log/consoleSink.ts`.
- [x] `api/client.ts`:
  - the request id per attempt, the timing and `api.request_failed`, skipping `AbortError`
  - `clearRefreshCookie` logs `auth.logout_cookie_clear_failed`
- [x] `api/errors.ts`:
  - `ApiError.requestId` (an optional last parameter) is filled by `unwrap` from the response header
  - `errorMessage()` adds the error ID for a 5xx
- [x] `api/uploadArt.ts`, `auth/AuthProvider.tsx` and `auth/tokens.ts` log their events.
- [x] `errorHandlers.ts` is wired up:
  - React's root options in `main.tsx`
  - the router's `onError` in `App.tsx`
  - `RouteErrorPage.tsx` as the root route's `errorElement`
- [x] `log/remoteSink.ts`: the batches, the byte cap, the repeat counting, the token bucket, the `pagehide` flush, and breadcrumbs on `error` entries.

### Tests
- [x] **Backend fixtures:**
  - an autouse fixture that clears contextvars, because httpx's `ASGITransport` runs the app in the test's own task
  - a log-capture fixture: structlog's `LogCapture`, with `merge_contextvars` before it
- [x] **Backend `test_logging.py`:**
  - JSON output, with the redaction and scrubbing
  - existing loggers stay enabled
  - uvicorn's lines are routed through our handler, and its access log stays silent
  - the WebSocket query filter
- [x] **Backend `test_middleware.py`:**
  - the request id is generated, kept or replaced, and returned
  - the access-line fields: `route`, `user_id`, and `error_code` for an `AppError`, a 404 and a 422
  - the levels
  - an unhandled exception gives one ERROR line and the JSON 500
- [x] **Backend `test_client_logs.py`:**
  - the limits, 413 and 422
  - anonymous, a valid token, and an expired token
  - `web.<event>`, the nested context, and the rate limit with its one warning
  - breadcrumbs are logged nested, and more than 20 are refused
- [x] **Backend service events:**
  - `auth.registered`, `upload.ticket_issued` and `share.imported`
  - `health.check_failed`, which the existing redis-down test now asserts
  - a share-code collision logs `share.code_retry`
  - the share import logs its steps at DEBUG
- [x] **Frontend logger:**
  - the thresholds, the redaction, and the console sink in dev and production
  - a memory sink installed in `src/test/setup.ts` and reset after each test
- [x] **Frontend `remoteSink`:**
  - batching, the byte cap, repeats, the token bucket and the `pagehide` keepalive
  - an `error` entry carries the last 20 breadcrumbs, within the limits
  - the body checked through an MSW handler
- [x] **Frontend `client.test.ts`:**
  - `X-Request-ID` is sent, with a new one on retry
  - a 5xx and a network error are logged with the request id
  - an `AbortError` is not logged
  - the `console.warn` spy (line 191) becomes a check on the log entry
- [x] **Frontend `errors.test.ts`:** `requestId` and the error ID in the message.
- [x] **Frontend error handlers:**
  - a render error is logged once and shows `RouteErrorPage`
  - window errors are filtered
- [ ] **e2e:** the auth spec checks that the login response returns the browser's `X-Request-ID` through nginx. Written; not run yet (Open questions).
- [ ] **By hand:**
  - the dev terminal
  - `docker run` of the production image with `.env.prod`
  - a forced browser error in the production build, seen as `web.*`
  - Render after the deploy

### Docs
- [x] [backend_plan.md](backend_plan.md):
  - §2: structlog
  - §3: the new files
  - §8: `POST /api/client-logs`, the `X-Request-ID` header, the 500 `internal_error` body and the 413 `payload_too_large`
  - §9.2: the token in the WebSocket URL is stripped from uvicorn's lines
  - a new §10.2 Logging, summarising "How it works"
- [x] [frontend_plan.md](frontend_plan.md):
  - §2: `log/` and `RouteErrorPage.tsx`
  - §6: a Logging part, with the `ws.*` events F4–F5 will add
- [x] [coding-standards.md](coding-standards.md):
  - §1: event names, fields not prose, the levels, what is never logged, and that code which catches an exception and carries on logs it
  - §2: `get_logger`, the engine never logs, background tasks start with an empty context and run through the wrapper that logs their exceptions (M6)
  - §3: use `log`, never `console`
- [x] [deployment.md](deployment.md):
  - `LOG_LEVEL` and `LOG_FORMAT`
  - "Reading the logs"
  - the health-check line (now DEBUG, so it no longer shows every few seconds)
  - a troubleshooting row for "a user reports an error ID"
- [x] Update this file, and write the session file.

## Out of scope
- **External log tools:** log drains, alerts, metrics and tracing. Render's log viewer is enough for now, and a JSON log drain can be added later without code changes.
- **Sentry**, or any other third-party error tracker.
- **The query retry policy:** `queryClient` retries a 5xx twice, so one failing query gives three server error lines with three request ids. It stays as it is.
- **A top-level error boundary outside `AuthProvider`:** `onUncaughtError` still logs an error there, but the page stays blank.
- **Moving the WebSocket access token out of the URL:** decided in M6. Until then, the filter keeps it out of uvicorn's lines.
- **WebSocket, room and game events:** M6 and F4–F5 add them under these rules.
- **Rate limits on other endpoints** ([backend_plan.md §13](backend_plan.md)).
- **Sampling, and log levels per module.**
- **Holding a request's DEBUG lines** and printing them only when the request fails.

## Notes
- **Checked in the installed packages:** uvicorn 0.54.0, Starlette 1.8.0, FastAPI 0.143.2, react-router 8.5.1 and react-dom 19.3.1.
  - **uvicorn:**
    - It applies its own logging config before it imports the app, in the `--reload` worker too, so configuring at import of `app.main` wins. Only the reloader's own lines ("Will watch…") keep uvicorn's format.
    - It writes access lines only while `uvicorn.access` has handlers.
    - It logs WebSocket handshakes on `uvicorn.error` with the full query string.
  - **Middleware order:** ServerErrorMiddleware → our middleware → ExceptionMiddleware → router. So `AppError`, `HTTPException` and 422s reach our middleware as normal responses.
  - **Request state and context:**
    - `request.state` is `scope["state"]`, shared by every layer. httpx's `ASGITransport` doesn't create it, so the middleware does.
    - Async dependencies run in the middleware's task, so values they bind reach the endpoint and the services. Sync dependencies run in a thread with a copy of the context.
  - **React and react-router:**
    - React calls the root's `onCaughtError` before the router's error boundary calls its `onError`.
    - The router's default error screen shows `error.stack` in production builds.
- **Checked in structlog 26.1.0:**
  - `ExceptionDictTransformer` defaults to `show_locals=False`, and JSON uses `format_exc_info` anyway.
  - `capture_logs(processors=...)` exists (since 25.5.0), and the `logs` fixture uses it.
- **Checked by running the dev API:** uvicorn's own lines ("Started server process", "Application startup complete") come out in the same JSON shape, and so does `app.started`. A failed `/api/health` gave two `health.check_failed` warnings and an ERROR access line, all with one `request_id`.
- **Still unchecked:**
  - whether Render sets `RENDER_GIT_COMMIT` at runtime (`app.started` shows `commit: null` if not)
  - whether Render rewrites a client's `X-Forwarded-For`
- **Tests:** once the middleware sends 500s itself, a server bug in a test shows up as a 500 response, not a raised exception.
- **The dev venv** has `rich` (through fastapi-cloud-cli), which isn't in the requirements. The console renderer is told to use plain tracebacks, so dev doesn't depend on it.

## Open questions
- **The local `.env` points at production.**
  - `DATABASE_URL` is the Neon project (database `neondb`), and `REDIS_URL` is Upstash.
  - Redis refuses the login from there (`AuthenticationError`, probably `REDIS_PASSWORD` overriding the password in the URL), so `/api/health` answers 503 and the e2e setup stops.
  - Running e2e or the dev API against production would write `e2e_…` users into the production database, so neither was run.
  - To finish: put the local values back (`.env.example`: `127.0.0.1:5432` and `127.0.0.1:6379`) and keep the production ones in `.env.prod`. Then run `npm run e2e` and the checks by hand.
- **The backend tests used Neon:** with this `.env`, `pytest` ran against a `neondb_test` database on the Neon server (created if it was missing). Every test rolls back, and production `neondb` wasn't touched. You may want to drop `neondb_test` in the Neon console.
