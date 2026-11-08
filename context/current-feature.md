# Current feature: F0 — Frontend scaffold, API client, auth pages and app shell

**Status:** done (2026-11-06), on branch `f0-auth`, not committed yet. See [sessions/session_2026-11-06.md](sessions/session_2026-11-06.md). On 2026-11-08 the refresh token moved into an HttpOnly cookie ([sessions/session_2026-11-08.md](sessions/session_2026-11-08.md)).
**Plan reference:** [frontend_plan.md §0–§3, §7 (F0) and §8](frontend_plan.md), [coding-standards.md §3](coding-standards.md), and [backend_plan.md §8 (auth endpoints and their 401 codes)](backend_plan.md)
**Depends on:** M0 and M1, both done. M3 is done too and merged into `master` (`87ac8e4`); see [sessions/session_2026-11-04.md](sessions/session_2026-11-04.md).
**Unblocks:** F1 (catalog and `SchemaForm`, origin and card editors, card library, art upload).

## Goal
A React + TypeScript + Vite app in `frontend/`, served through nginx on `http://localhost/`. A user can **register, log in, stay logged in across reloads, and log out**.

F0 also builds what every later milestone uses:
- the router
- the API client, with token refresh
- the generated API types
- TanStack Query
- the Tailwind design tokens
- the app shell
- the lint, format and test tooling

## Done when
- [x] `npm run dev` serves the app, and `http://localhost/` loads it through nginx, with hot reload working through nginx too.
- [x] **Register:**
  - creates the account, logs the user in and opens the dashboard
  - the form checks the server's bounds as you type (username 3–32 letters, digits or `_`; a valid email; password 8–128 characters)
  - `username_taken` and `email_taken` show on their fields
- [x] **Login** with email and password. `invalid_credentials` shows one message for both fields. After login the user goes back to the page they came from (default `/`).
- [x] **Protected routes:**
  - a logged-out user who opens an app route goes to `/login`, which remembers the route
  - a logged-in user who opens `/login` or `/register` goes to `/`
- [x] **Session:**
  - the access token stays in memory and the refresh token in an HttpOnly cookie
  - a reload keeps the user logged in
  - a request that gets `token_expired` refreshes once and is retried, and parallel requests share that one refresh
  - a failed refresh logs the user out
- [x] **Logout:**
  - it forgets the access token, clears the query cache and goes to `/login`, and the server deletes the refresh cookie
  - the app's other open tabs log out too
- [x] **App shell:** a header with the app name, the nav, the username and **Log out**. The dashboard shows the user's card, card group and deck counts, from the list endpoints' `total`.
- [x] `npm run gen:api` regenerates `src/api/schema.d.ts` from the API. The file is committed, and the client is typed from it.
- [x] **Checks pass:**
  - `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` (Vitest)
  - `npm run e2e` (Playwright through nginx: register → log out → log in → log out)
  - the backend checks (`pytest`, `ruff`, `mypy`)

## Decisions
Confirmed 2026-11-05:
- **Logout doesn't revoke tokens.** It forgets the tokens in this browser and its other tabs. (Since 2026-11-08 the server deletes the refresh cookie, because scripts can't; see "Changes made during F0".)
  - Refresh tokens stay stateless, and `/refresh` issues a new one without ending the old one.
  - A refresh token that was already copied stays valid until it expires (30 days).
  - Revocation (a `jti` allowlist in Redis, rotation, "log out everywhere") is a later backend task that needs no UI change (see "Out of scope").
- **The look is a dark game table:**
  - charcoal and slate surfaces, light text, one warm gold accent
  - danger and success colours taken from the Okabe–Ito palette, like the origin colours, so they stay colour-blind safe
  - card art and origin colours stand out on it

Confirmed during planning (2026-11-06), with the changes listed under "Changes made during F0" below:
- **Versions:** the newest stable releases that fit together, pinned exactly (`save-exact`), with `package-lock.json` committed. Checked with `npm view`.
  - pinned: React 19.3, TypeScript 5.9, Vite 8.3, React Router 8.5 (data router with `createBrowserRouter`, not framework mode), TanStack Query 5.106, Tailwind 4.3, React Hook Form 7.91, ESLint 10.14, Vitest 5.1, MSW 3.0, Playwright 1.65
  - this machine has Node 24.12 and npm 11.6; `engines` and `.nvmrc` say Node 24
  - Zustand, dnd-kit and Framer Motion are added only when a milestone needs them (F2 and later), so nothing is installed unused
- **Tailwind 4 tokens live in CSS:** an `@theme` block in `src/styles/index.css`, instead of a `tailwind.config.js` file.
  - colours: `bg`, `surface`, `surface-raised`, `border`, `text`, `text-muted`, `accent`, `danger`, `success` and `focus`
  - plus radius and font
  - coding-standards §3 is updated to match
- **OpenAPI goes through nginx:** move FastAPI's schema to `/api/openapi.json` and the docs to `/api/docs` (today both sit outside `/api`, so nginx doesn't proxy them).
  - `gen:api` reads `http://localhost/api/openapi.json`, like every other request
  - this is a small backend change, with a test
- **API client:**
  - `openapi-fetch`, typed by the generated `paths`, with our own `fetch` function that adds the bearer token and handles refresh in one place
  - the API origin comes from `VITE_API_ORIGIN` (empty by default = the page's own origin, through nginx); there is no Vite proxy, since the app is always opened through nginx
- **API errors:**
  - an `ApiError(status, code, message, extra)` is parsed from `{"detail": {code, message, ...}}`
  - FastAPI's own 422 (`{"detail": [...]}`) becomes code `validation_error`, with errors per field
  - forms map the codes onto their fields
- **Token rules:**
  - on start, a saved session goes to `POST /refresh` and then `GET /me`, behind a full-page spinner. (The refresh token was first stored under `cardtable.refresh` in `localStorage`. Since 2026-11-08 it is an HttpOnly cookie, and the `cardtable.session` hint marks a saved session.)
  - only `token_expired` triggers a refresh; any other 401 code logs out
  - each refresh stores the new access token, and its answer renews the cookie
  - other tabs listen for the `storage` event: removing the key logs them out
- **Login is by email**, because that is what the backend's `LoginRequest` takes.
- **The form's input bounds copy the server's auth bounds**, so feedback is instant. These are input limits, not game rules, and the server's 422 and 409 answers are still shown.
- **F0's routes** are `/login`, `/register`, `/` (the dashboard) and a 404 page. Later milestones add their own routes, and the nav shows only pages that exist.
- **Vite dev server:**
  - `host: true`, so nginx in Docker can reach it through `host.docker.internal`
  - `port: 5173` with `strictPort: true`
  - the HMR client port is 80, so hot reload works through nginx
- **Tests:**
  - Vitest, React Testing Library, jsdom, and MSW for API mocks
  - Playwright on Chromium against the real stack through nginx
  - e2e users are named `e2e_<random>`; they stay in the dev DB, and one `DELETE FROM users WHERE username LIKE 'e2e\_%'` clears them (user deletion cascades since M3)
- **Lint and format:**
  - ESLint flat config with `typescript-eslint` (type-checked), `react-hooks`, `react-refresh` and `jsx-a11y`
  - Prettier with a width of 100, the same as ruff
  - TypeScript `strict` plus `noUncheckedIndexedAccess`, and an `@/` alias for `src/`
- **New files the plan's layout (frontend_plan §2) doesn't list yet:**
  - `src/AppShell.tsx` (the header, nav and user menu, next to `App.tsx`)
  - `ui/TextField.tsx` (a labelled input with its error)
  - `auth/tokens.ts` (the access token, the session hint and the cross-tab sync)
  - `api/errors.ts`

## Tasks
Order: scaffold and tooling → styles and `ui/` → backend OpenAPI URL → generated types and API client → auth → shell and dashboard → tests → docs.

### Scaffold and tooling
- [x] Scaffold Vite `react-ts` into `frontend/`, pin exact versions (`.npmrc` with `save-exact=true`), and add `engines` and `.nvmrc`.
- [x] `tsconfig`: `strict`, `noUncheckedIndexedAccess`, the `@/` alias.
- [x] ESLint and Prettier configs. Scripts: `dev`, `build`, `preview`, `lint`, `format`, `format:check`, `typecheck`, `test`, `e2e`, `gen:api`.
- [x] `vite.config.ts`: `host`, `strictPort`, the HMR client port 80, the Tailwind plugin, the alias, and the Vitest config.
- [x] Root `.gitignore`: `node_modules`, `dist`, `playwright-report`, `test-results`. Add `frontend/.env.example` (`VITE_API_ORIGIN=`).

### Styles and `ui/`
- [x] `src/styles/index.css`: Tailwind, the `@theme` tokens (dark table palette, radius, font), base body styles and a visible focus ring.
- [x] `ui/Button.tsx`, `ui/TextField.tsx` (label, error text tied to the input with `aria-describedby`) and `ui/Spinner.tsx`.

### API
- [x] Backend: `openapi_url="/api/openapi.json"` and `docs_url="/api/docs"` in `create_app`, with a test.
- [x] `gen:api` (`openapi-typescript`) → `src/api/schema.d.ts`, committed.
- [x] `api/client.ts`: `openapi-fetch` with the auth `fetch` (bearer header; one shared refresh on `token_expired`, then a retry; logout when the refresh fails). `api/errors.ts`: `ApiError` and the body parsing.
- [x] `QueryClient`: no retries on 4xx; the cache is cleared on logout.

### Auth
- [x] `auth/tokens.ts`: the session hint in `localStorage` (reads and writes wrapped in try/catch) and the `storage` listener. The refresh token is an HttpOnly cookie since 2026-11-08.
- [x] `auth/AuthProvider.tsx`: the state is `loading`, `anonymous` or `authenticated(user)`, with `login`, `register` and `logout`, and `useAuth`. It restores the session on start.
- [x] `auth/ProtectedRoute.tsx` (redirects to `/login` and remembers the route) and a guest-only guard for `/login` and `/register`.
- [x] `auth/LoginPage.tsx` and `auth/RegisterPage.tsx` with React Hook Form: the client bounds, server codes shown on the fields, a busy state, and links between the two pages.

### Shell and dashboard
- [x] `routes.tsx` (`createBrowserRouter`): guest routes, a protected layout route with `AppShell`, the dashboard as its index, and a 404 page.
- [x] `AppShell.tsx`: the app name, the nav (Dashboard for now), the username and **Log out**.
- [x] `features/dashboard/DashboardPage.tsx`: a welcome line plus tiles counting cards, card groups and decks (`api/hooks/useLibraryCounts`, with `limit=1` and reading `total`).

### Tests
- [x] Vitest setup: jsdom, RTL, MSW handlers for the auth endpoints and the list endpoints.
- [x] Client tests:
  - the bearer header is sent
  - `token_expired` → refresh → retry
  - parallel 401s make one refresh
  - a failed refresh logs out
  - `ApiError` parsing for our body and for FastAPI's 422 list
- [x] Auth tests:
  - login goes back to the remembered route
  - the `invalid_credentials` message
  - register's client bounds, and `username_taken` / `email_taken` on their fields
  - the protected-route redirect and the guest guard
  - the session is restored on start
  - logout clears everything, and the other tabs log out
- [x] Playwright (`frontend/e2e/auth.spec.ts`, Chromium, against `http://localhost/`): register → the dashboard shows the username → log out → log in → log out.

### Docs
- [x] [frontend_plan.md](frontend_plan.md):
  - §1: versions, Tailwind 4 tokens in CSS, `openapi-fetch`, MSW
  - §2: the new files
  - §6: how token refresh works
  - §7: F0 done
- [x] [backend_plan.md](backend_plan.md) §8: the OpenAPI and docs URLs.
- [x] [coding-standards.md](coding-standards.md) §3: the tokens live in `@theme`; Prettier width 100.
- [x] [CLAUDE.md](../CLAUDE.md): the frontend commands (`npm install`, `npm run dev`, `gen:api`, checks, `e2e`).
- [x] Decisions recorded here; session file written.

## Changes made during F0
- **Versions:** the newest releases didn't all fit together.
  - TypeScript stays on 5.9.3: 7.0 isn't supported yet by `typescript-eslint` (`<6.1`) or `openapi-typescript` (`^5`).
  - ESLint 10.14 with the original `eslint-plugin-jsx-a11y` 6.10.2, plus an npm `overrides` entry. Its peer range stops at ESLint 9, which npm now marks unsupported, but the plugin only uses `context.options`, `report` and `settings`, which ESLint 10 kept. (The user chose this over staying on ESLint 9.)
  - jsdom 29.1.1: 30+ needs Node ≥24.15, and this machine has 24.12.
  - React Router 8, not 7: data mode is unchanged, `RouterProvider` comes from `react-router/dom`, and `react-router-dom` is gone.
- **`VITE_API_ORIGIN` instead of `VITE_API_BASE_URL=/api`:** the generated paths already start with `/api`, so a `/api` base would have requested `/api/api/...`.
- **Backend:** `redoc_url=None` as well (ReDoc would sit outside `/api`). Also a fix that wasn't planned: `GET /api/cards` showed one required `filters` object in OpenAPI, because FastAPI only lists a query model's fields when the model is the route's only query parameter. The route now takes one `CardListQuery` (filters + `limit`/`offset`), and `test_openapi.py` checks that no query parameter is an object. The API's behaviour didn't change.
- **Tokens:** `border-strong` (`#6b7480`, 3:1 for input outlines) was added. Danger and success use lighter tints of the Okabe–Ito vermillion and bluish green (`#f07a2a`, `#2bb88f`), because the originals fall below 4.5:1 for small text on the raised surface.
- **Return page after logout:** an intended logout (this tab or another) starts the next login at the dashboard. An expired session or a deep link remembers the page.
- **Vite `host: true` is needed:** with Vite on 127.0.0.1 only, nginx answered 502. So the dev server is also reachable from the LAN and VPN interfaces, unless the Windows firewall blocks it.
- **Refresh token in an HttpOnly cookie (2026-11-08, asked by the user after F0 was done):** so that no script, and no XSS, can read the long-lived token.
  - Backend: register, login and refresh return only `{access}` and set the `refresh_token` cookie (`HttpOnly`, `SameSite=Strict`, `Path=/api/auth`, `Secure` unless `REFRESH_COOKIE_SECURE=false`). `/refresh` reads only the cookie. A new `POST /api/auth/logout` deletes it. Details in backend_plan §8.
  - Frontend: `localStorage` keeps only the non-secret hint `cardtable.session`. It saves a refresh call on start when nobody is logged in, and its removal still logs out the other tabs. Logout calls `/logout`. A refresh answer that arrives after a logout has set a new cookie, so the client deletes it again.
  - Tokens stay stateless: logout deletes the cookie but revokes nothing (see "Out of scope").
- **Extra small files:** `auth/AuthContext.ts`, `auth/useAuth.ts`, `auth/GuestRoute.tsx`, `auth/redirect.ts`, `auth/bounds.ts`, `auth/showServerError.ts`, `auth/AuthLayout.tsx`, `features/dashboard/CountTile.tsx`, `src/NotFoundPage.tsx`, `src/env.d.ts`, `api/queryClient.ts`, `src/test/`, `e2e/global-setup.ts`.

## Out of scope (later milestones)
- The catalog, `SchemaForm`, origin and card editors, the card library and art upload (F1)
- Decks, the share dialog and the import page (F2); rules (F3); rooms, the lobby, the WebSocket and Zustand (F4, F5)
- **Revoking refresh tokens** (Redis `jti` allowlist, rotation, revoking on `POST /api/auth/logout`, "log out everywhere"). This is a backend task for later, and the UI's logout button stays the same. `/logout` exists since 2026-11-08, but it only deletes the cookie.
- Password reset, email verification, account settings and deleting an account
- A dark/light theme switch (frontend_plan §9 "Later") and translations

## Carried over
- **R2 CORS rule (manual, from M2):** browser uploads fail until the bucket allows `PUT` and `GET` from `http://localhost` with the `Content-Type` header. F0 doesn't need it, F1 does. The JSON is in [session_2026-11-01.md](sessions/session_2026-11-01.md) and backend_plan §10.

## Notes and decisions
- **The backend the frontend relies on** (M1–M3):
  - every route except register, login, refresh, logout and health needs `Authorization: Bearer <access>`, and every 401 carries `WWW-Authenticate: Bearer`
  - `POST /api/auth/register` (201) and `/login` return `{access}` and set the refresh cookie; `/refresh` reads the cookie and returns `{access}` with a new cookie; `/logout` (204) deletes the cookie; `GET /api/auth/me` returns `{id, username, email, created_at}` (the cookie parts since 2026-11-08)
  - the 401 codes are `not_authenticated`, `token_expired`, `token_invalid`, `token_wrong_type` and `invalid_credentials`; the 409s are `username_taken` and `email_taken`
  - errors are `{"detail": {"code", "message", ...extra}}`, and malformed input gets FastAPI's default 422 (`{"detail": [...]}`)
  - list endpoints take `limit`/`offset` and return `{items, total}`; ids are UUIDs, and timestamps are ISO 8601 with a time zone
  - access tokens last 15 minutes and refresh tokens 30 days (`ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`)
- **The server is authoritative** (frontend_plan §0): the UI never re-implements game rules. F0 has none to copy; its only copied rules are the auth input bounds above.
- **Local layout:** `frontend/` already holds the empty folders from frontend_plan §2 (`src/api`, `src/auth`, …, `e2e`). Git doesn't track empty folders, so they appear in history once files land in them.

## Open questions
- None right now.
