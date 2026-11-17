# Session 2026-11-15: M6 rooms, WebSocket, Redis, timers

## Summary
We built backend M6 on the `m6-rooms` branch. Nothing is committed yet.
- **Before:** the engine (M5) ran only in tests. Nothing let two people play.
- **Now:**
  - **Rooms:** a room is created from a ruleset (copied and checked again), joined by its 6-character code, and lives in Redis as one hash with a compare-and-set on its `rev`.
  - **The game socket** `WS /ws/rooms/{code}`:
    - The first message logs in.
    - The lobby has deck selection with problems, ready, and leaving.
    - The game: actions through the engine, each player's own events and view, the end.
  - **Timers and absence:** the turn timer, players away for 60 s losing with `abandoned`, reconnects, `resync`, and everything coming back after a restart.
  - **Engine:** `Abandon` and the `abandoned` end reason.
  - **Done-when met:** two WS clients play a full game to a win, in the tests and live through nginx.
- **F4 (lobby) and F5 (board) are unblocked:** `npm run gen:api` now types the rooms and every socket message.

## How it went
1. **Plan.** The user asked for a plan of current-feature.md, with questions where needed.
   - Three exploration passes (engine, services, tests and infra), then a design review that checked the risky points against the installed libraries.
   - The user answered three questions:
     - build all the steps, then report
     - no commits
     - **a lobby disconnect clears ready** (the spec had "changes only `connected`")
2. **The engine's `abandon`,** with an `assert_never` in the runner's dispatch.
3. **Groundwork:**
   - the settings, `core/tasks.spawn` and `core/clock.py`
   - `httpx-ws` 0.10.0 (checked on PyPI), with its ASGI transport and client read before use
   - the Redis fixture on database 15, and CI's Redis service
4. **Deck rules and snapshots,** plus the case file shared with the frontend's `deckProblems.test.ts`.
5. **`room_store`, `live_rooms`, `room_service`, `game_service`,** then the REST routes, then `ws/protocol`, `ws/manager`, `ws/handler` and the lifespan.
6. **Tests, which found these problems:**
   - **The socket client fixture failed in teardown:** pytest-asyncio sets a fixture up and tears it down in different tasks, and the transport's anyio task group must be left in its own task. One helper task now holds the client.
   - **Duplicate messages:** a new socket got `room_state` twice, a disconnect in a game sent `room_state` twice, and a reconnecting player's first `room_state` still showed them away. `connect` now clears `away_since` itself before sending.
   - **The full game ended in an `out_of_cards` draw:** equal 2/2 creatures keep trading, since a creature blocks attacks on its section.
     - The full-game test gives the host 3/3s against 1/1s.
     - Seats and seeds came from `secrets`, so tests weren't deterministic. They now come from an injectable random (`SystemRandom` in the app, seeded in tests).
   - **The writer task:** the test transport raises anyio's `ClosedResourceError` where uvicorn raises a disconnect. The writer treats both as "the socket is gone".
7. **The live smoke run** (below), then docs.

## Decisions made
| Topic | Decision |
|---|---|
| Lobby disconnect | Clears the player's ready flag (confirmed by the user; changes the spec). |
| Layers | The socket's payload models are in `schemas/room.py`, since services build them; `ws/protocol.py` has the envelopes, parsing and the OpenAPI export. Services send through a `Notifier` protocol that `ws/manager.py` implements. |
| Redis key | A hash `{rev, data}`; the Lua scripts read only `rev` and return integers (redis-py 8 speaks RESP3). |
| Messages | Client `{type, seq, payload}`, server `{type, payload}`. |
| Connections | `connected` isn't stored. A room owns user → connection id; the manager owns connection id → socket. Each socket has a bounded queue and a writer task (uvicorn's `send` blocks on a slow reader); an overflow closes it with 1013. |
| DB sessions | The socket never holds one: auth and `select_deck` open a short one (a held session would keep Neon awake). Nothing awaits the database under a room's lock. |
| Restarts | `settle` runs after every use of a room and re-arms timers and away tasks from the stored room, so nothing restart-specific is needed. After a load, absent players are away from the load (an older `away_since` is overwritten). A 1012 close isn't special-cased: a client could send it to dodge the countdown, and the reset on load covers restarts. |
| Redis failures | `REDIS_TIMEOUT_S` (5 s) on the client; a failing message closes its socket with 1011; timer tasks retry with a backoff. |
| Finished rooms | Their sockets get `room_closed` when the key expires (10 min). |
| OpenAPI | The messages are components, exported in serialization mode. The engine's base models mark every field required in output schemas, so discriminators are required in TS. No `-Input`/`-Output` twins; a name clash raises. |
| Smaller choices | Times in Unix ms; a guest who leaves gets 1000; a non-`auth` first message gets 4401, a second `auth` gets `bad_message`; `checked_definition` made public in `ruleset_service`; `SessionFactory` moved to `core/db.py`; old comments about the token in the socket URL updated. |

## Files changed
- **New (backend):**
  - `app/api/rooms.py`
  - `app/core/clock.py`, `app/core/tasks.py`
  - `app/schemas/room.py`
  - `app/services/room_store.py`, `live_rooms.py`, `room_service.py`, `game_service.py`
  - `app/ws/protocol.py`, `manager.py`, `handler.py`
- **New (tests):**
  - `tests/room_helpers.py`
  - `test_rooms.py`, `test_room_lobby.py`, `test_room_game.py`, `test_room_timers.py`, `test_room_away.py`, `test_room_store.py`, `test_live_rooms.py`, `test_deck_rules.py`, `test_tasks.py`
  - `tests/engine/test_abandon.py`, `tests/fixtures/deck_rule_cases.json`
- **Changed (backend):**
  - engine: `actions.py`, `legality.py`, `runner.py`, `state.py`, `events.py`, `snapshots.py`, `registry.py`, `README.md`
  - `core/config.py`, `core/db.py`, `core/deps.py`, `core/middleware.py` and `core/logging_config.py` (comments)
  - `main.py`, `api/router.py`
  - `services/deck_service.py`, `ruleset_service.py`, `art_cleanup_service.py`
  - `tests/conftest.py`, `test_openapi.py`, `test_art_cleanup.py`
  - `requirements-dev.txt` (`httpx-ws==0.10.0`)
- **Changed (other):**
  - `.env.example`, `.github/workflows/ci.yml`
  - `frontend/src/api/schema.d.ts` (`gen:api`), `frontend/src/features/decks/deckProblems.test.ts`
- **Docs:**
  - `context/backend_plan.md` (§1, §3, §4, §7.2, §7.4, §7.5, §7.6, §7.7, §8, §9, §10.1, §10.2, §11, §12)
  - `context/frontend_plan.md` (§4.2, §4.4, §5.1, §5.3, §6)
  - `context/deployment.md`, `context/current-feature.md`, this file

## Verification
- **Backend:** `ruff check .`, `ruff format --check .` and `mypy app tests` pass. `pytest`: 800 passed (710 before M6), with the docker Redis.
- **Room tests:** run uncaptured, they log no errors. The only warning is the deliberate `room.store_conflict`.
- **Frontend:** `npm run gen:api` (API and stack up), then `typecheck`, `lint`, `format:check` and `npm test` (256 passed). The shared deck-rule cases run on both sides.
- **Live smoke run,** with uvicorn and the docker stack, through nginx:
  - **A full game:** two users played over real sockets (`ws://localhost/ws/rooms/…`), and the host won by conquest after 31 actions, in 0.4 s.
  - **Redis TTLs:** the finished room's key had 583 s left; a running room's had 86394 s.
  - **A restart:** uvicorn was killed mid-game (a hard kill) and started again. The host reconnected to the restored room. The deadline had passed during the restart, so it fired at once. The absent guest lost with `abandoned` 60.3 s after the reload.
  - **Logs:** no errors or warnings in the server log.
  - The smoke users (`e2e_m6_…`) were deleted from the dev DB.
- **Not verified:**
  - CI, which runs only after a push.
  - Render and Upstash.
  - A graceful uvicorn shutdown (code 1012) with clients connected: the tests and the smoke run cover a hard kill.

## Notes
- **Local `pytest` now needs the docker Redis** (`docker compose up -d`); the room tests refuse any Redis database but 15.
- **The httpx-ws transport differs from uvicorn:** after the server closes a socket, the app gets the disconnect only once the client closes its side, whereas uvicorn queues it at once. Tests always leave their socket contexts, so this doesn't matter.
- **Not done, mentioned only:** `--ws-max-size 65536` in `start.sh` (uvicorn accepts 16 MiB messages, even before `auth`).
- **The docker stack** was started for the tests and is still running.

## Next steps
1. Review and commit `m6-rooms`; push to see CI with its Redis service.
2. F4 (create and join a room, the lobby) and F5 (the board) on the generated socket types.
3. M7: write the finished game to `games` from the room (`game_id`), and `GET /api/games`.
4. Leftovers from earlier features are listed at the top of [current-feature.md](../current-feature.md).
