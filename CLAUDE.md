# Card Table — card-game constructor

A website where users build their own Hearthstone-like card game from ready-made modules (cards, origins, decks and turn-flow rules), then play it 1v1 with a friend they invite by code.

- **Backend:** Python 3.12, FastAPI, SQLAlchemy (async) + Postgres, Redis, Cloudflare R2 (S3 API) for card art. It has a pure, deterministic game engine that runs rules stored as JSON.
- **Frontend:** React, TypeScript, Vite, TanStack Query, Zustand, dnd-kit, Tailwind.
- **Infrastructure:** `docker-compose.yml` runs Postgres, Redis and nginx. R2 is external, so it has no container. The API (port 8000) and Vite (port 5173) run on the host, and nginx serves everything on `http://localhost/`.
- **Production:** one Render web service built from the root `Dockerfile`, where the API also serves the built frontend. Postgres is Neon, Redis is Upstash. GitHub Actions checks every push to `master`, and Render deploys after the checks pass. See [backend_plan.md §10.1](context/backend_plan.md).
- **Core rule:** the server is authoritative. The UI only offers the moves the server lists in `legal_actions`, and never re-implements game rules.

## Read before working

| File | What it is |
|---|---|
| [context/current-feature.md](context/current-feature.md) | **What we're building right now.** Start here. |
| [context/ai-interaction.md](context/ai-interaction.md) | How to communicate and work in this repo |
| [context/coding-standards.md](context/coding-standards.md) | Code style, structure and conventions |
| [context/backend_plan.md](context/backend_plan.md) | Backend design: data model, module registry, rules JSON, engine, API, WebSocket, milestones M0–M7 |
| [context/frontend_plan.md](context/frontend_plan.md) | Frontend design: pages, builders, game board, WS client, milestones F0–F6 |
| [context/deployment.md](context/deployment.md) | CI/CD and production: pipeline, services, env vars, rollbacks, free-tier limits, troubleshooting |
| [context/project_description.md](context/project_description.md) | The original game idea and use cases |

The plans are the source of truth for design decisions. If the code needs to go against a plan, update the plan in the same change.

## Commands

```powershell
docker compose up -d                                   # Postgres, Redis, nginx
cd backend; .\venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt                    # runtime packages + test and lint tools
alembic upgrade head                                   # apply migrations
uvicorn app.main:app --reload --port 8000              # API (docs: http://localhost/api/docs)
pytest; ruff check .; ruff format --check .; mypy app tests   # checks
```

Frontend (Node 24), with the stack and the API running:

```powershell
cd frontend
npm install
npx playwright install chromium                        # once, for the e2e tests
npm run dev                                            # Vite on 5173; open http://localhost/
npm run gen:api                                        # regenerate src/api/schema.d.ts after API changes
npm run lint; npm run format:check; npm run typecheck; npm test   # checks
npm run e2e                                            # Playwright through nginx
```

The e2e tests leave their `e2e_…` users in the dev DB. Remove them with `DELETE FROM users WHERE username LIKE 'e2e\_%';` (deleting a user cascades to all their content).

## Deploy

Merging to `master` deploys: CI (`.github/workflows/ci.yml`) runs, then Render builds the `Dockerfile` and starts it with `backend/scripts/start.sh` (migrations, then uvicorn). Production secrets live only in the Render dashboard. Details, rollbacks and troubleshooting: [context/deployment.md](context/deployment.md). To try the production image locally, against the hosted services in a git-ignored `.env.prod`:

```powershell
docker build -t card-table .
docker run --rm -p 8080:8000 --env-file .env.prod card-table   # open http://localhost:8080/
```
