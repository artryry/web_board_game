# Card Table — card-game constructor

A website where users build their own Hearthstone-like card game from ready-made modules (cards, origins, decks and turn-flow rules), then play it 1v1 with a friend they invite by code.

- **Backend:** Python 3.12, FastAPI, SQLAlchemy (async) + Postgres, Redis, Cloudflare R2 (S3 API) for card art. It has a pure, deterministic game engine that runs rules stored as JSON.
- **Frontend:** React, TypeScript, Vite, TanStack Query, Zustand, dnd-kit, Tailwind.
- **Infrastructure:** `docker-compose.yml` runs Postgres, Redis and nginx. R2 is external, so it has no container. The API (port 8000) and Vite (port 5173) run on the host, and nginx serves everything on `http://localhost/`.
- **Core rule:** the server is authoritative. The UI only offers the moves the server lists in `legal_actions`, and never re-implements game rules.

## Read before working

| File | What it is |
|---|---|
| [context/current-feature.md](context/current-feature.md) | **What we're building right now.** Start here. |
| [context/ai-interaction.md](context/ai-interaction.md) | How to communicate and work in this repo |
| [context/coding-standards.md](context/coding-standards.md) | Code style, structure and conventions |
| [context/backend_plan.md](context/backend_plan.md) | Backend design: data model, module registry, rules JSON, engine, API, WebSocket, milestones M0–M7 |
| [context/frontend_plan.md](context/frontend_plan.md) | Frontend design: pages, builders, game board, WS client, milestones F0–F6 |
| [context/project_description.md](context/project_description.md) | The original game idea and use cases |

The plans are the source of truth for design decisions. If the code needs to go against a plan, update the plan in the same change.

## Commands

```powershell
docker compose up -d                                   # Postgres, Redis, nginx
cd backend; .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
alembic upgrade head                                   # apply migrations
uvicorn app.main:app --reload --port 8000              # API
pytest; ruff check .; ruff format --check .; mypy app tests   # checks
```
