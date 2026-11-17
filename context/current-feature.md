# Current feature: M6 — Rooms, WebSocket, Redis, timers

**Status:** built on 2026-11-15, not committed. Branch `m6-rooms`, from `m5-engine`. Session record: [sessions/session_2026-11-15_m6-rooms.md](sessions/session_2026-11-15_m6-rooms.md).
**Plan reference:**
- [backend_plan.md](backend_plan.md): §2 (one worker), §8 (the Rooms endpoints), §9 (rooms and the WebSocket), §10.1 (free-tier limits), §10.2 (the WebSocket's log events), §11 and §12
- [coding-standards.md](coding-standards.md): §2 (layers, background tasks, logging) and §4 (tests)

**Depends on:**
- M5: the engine, `app.engine.runner`
- M3: decks
- M4: rulesets and `validate_definition`
- M1: access tokens

All are done. M5 is committed on `m5-engine` (`88a53bd`), not merged or pushed.

**Unblocks:**
- F4: create a room, join by code, the lobby
- F5: the live part of the board
- M7: it saves the finished game from the room

On the server side it covers UC3 (create a room), UC6 and UC10 (invite and join by code), UC7 (play a game) and UC11 (select a deck).

Earlier features still have follow-ups:
- **M5:** committed on `m5-engine` (`88a53bd`), not merged or pushed. Its migration (`attacker_penalty`) runs on deploy ([sessions/session_2026-11-14_m5-engine.md](sessions/session_2026-11-14_m5-engine.md)).
- **F3:** committed on `f3-rules-editor` (`c065f09`), not merged or pushed. Still to do: a look by hand in a real browser ([sessions/session_2026-11-13_f3-rules.md](sessions/session_2026-11-13_f3-rules.md)).
- **F2:** committed on `f2-decks` (`716a793`), not merged or pushed. Still to check by hand: the copied art on imported cards, and a look in two real browsers ([sessions/session_2026-11-12_f2-decks.md](sessions/session_2026-11-12_f2-decks.md)).
- **M4:** `c8cf578` is on `master` locally, not pushed yet. Its two migrations run on deploy ([sessions/session_2026-11-12_m4-rulesets.md](sessions/session_2026-11-12_m4-rulesets.md)).
- **Dev nginx:** page loads through it stall (an unreachable IPv6 `host.docker.internal`), so `npm run e2e` needs `--workers=1`, and on 2026-11-13 even that needed `--retries=2`. Not fixed; see the F2 and F3 session files. Game sockets through it were fine in M6's smoke run (a full game in 0.4 s).
- **Art cleanup:** deploy it, then check Render ([sessions/session_2026-11-11_art-cleanup.md](sessions/session_2026-11-11_art-cleanup.md)).
- **Logging:** the checks by hand ([sessions/session_2026-11-11_logging.md](sessions/session_2026-11-11_logging.md)).

## Goal
Two logged-in players meet in a room by its code, each picks a deck that fits the room's ruleset, and they play a full game over a WebSocket. The server:
- runs the engine
- keeps the room and the game in Redis
- ends phases at their deadline
- lets a player reconnect
- ends the game for a player who stays away

Done when (backend_plan §11): **two WS clients can play a full game to a win.**

M6 adds no frontend (F4, F5), and doesn't save finished games to Postgres (M7).

## How it works

### Files (backend_plan §3)
```
app/
  api/rooms.py            the Rooms REST routes
  schemas/room.py         RoomCreate, RoomJoin, RoomState, RoomDeckOut, DeckProblem, the socket's
                          payloads (services build them), CloseCode, ServerMessageType
  ws/
    protocol.py           the message envelopes, client-message parsing, the OpenAPI components
    manager.py            the sockets by connection id, each with a send queue and a writer task
    handler.py            WS /ws/rooms/{code}: auth, then a read loop that calls the services
  services/
    room_store.py         the stored Room; the Redis hash: load, save (compare-and-set), TTLs
    live_rooms.py         the in-process side: each room's lock, cached copy, connections, tasks;
                          the Notifier protocol; RoomError
    room_service.py       create, join, the deck list, connect/disconnect, the lobby
    game_service.py       the start, actions, the turn timer, players away, the end; settle()
    deck_service.py       + deck_problems (a ruleset's deck rules) and deck_snapshot
  core/
    config.py             + the room settings and REDIS_TIMEOUT_S
    clock.py              Clock (Unix ms, sleep_until): SystemClock, and tests' FakeClock
    tasks.py              spawn(): a background task with an empty log context and its own fields
    deps.py               + get_rooms and get_session_factory (HTTPConnection, so sockets can use them)
  engine/                 + the `abandon` action and the `abandoned` end reason
```
(As built; the split between the services shifted as expected, the layers didn't.)
- **Layers still point down** (coding-standards §2):
  - A service never imports `ws/`. It sends through a small notifier interface that `ws/manager.py` implements; the app creates it in the lifespan.
  - A REST join can then tell the host's open socket.
- **The split between the services may shift while building;** the layers don't.

### Rooms
- **A room holds:**
  - its `code` and `status` (`lobby`, `playing` or `finished`), and `rev` (+1 per write)
  - the ruleset, copied when the room is created: `{id, name, definition}`
  - the host and the guest: user id and username
  - each player's deck, copied when it's selected: `{id, name, snapshot}`
  - the ready flags, and the seats once the game starts
  - `game_id`, the `GameState`, the turn `deadline`, and each player's `away_since`
- **Status:** `lobby` → `playing` → `finished`. A lobby whose host leaves is deleted.
- **The code:** 6 characters from `core/codes.py` (about 30 bits). Input in lower case works, as for share codes.
- **Edits made after the copies don't affect the room** (§9.1): a deck or ruleset changed or deleted later never breaks it.

### Redis
- **One key per room, `room:{code}`**, holding the lobby and the game as JSON (§9.1 had two keys). As built it is a hash, `{rev, data}`, so the compare-and-set script reads only `rev`.
- **TTL:** 24 h, renewed on every write; 10 minutes once the game is over.
- **Every write is a compare-and-set on `rev`** (a short Lua script, one command):
  - During a deploy, the old and the new instance can both hold a room for a few seconds; this stops one from overwriting the other.
  - A write that loses reloads the room. The action gets `error` with `stale_state`, and both players get the fresh state.
- **In memory:**
  - One worker (§2), so each live room has an `asyncio.Lock` and a cached copy. Reads come from the cache, and writes go through to Redis.
  - After a restart, the first request or socket for a room loads it from Redis.
- **Cost:**
  - About one Redis command per change, so a full game is a few hundred (Upstash's free tier has about 500K a month).
  - A write is small. Measured with the engine's test cards: 13 KB at the start and 20 KB at the end of a 111-action game. Real card names and art URLs make it bigger; an estimate is up to about 60 KB.

### REST (backend_plan §8)
| Route | Answer | Notes |
|---|---|---|
| `POST /api/rooms {ruleset_id}` | 201 `RoomState` | The ruleset must be readable: the user's own or the default (else 404 `ruleset_not_found`). It is checked again with `validate_definition`: a stored ruleset whose modules changed gives 422 `invalid_ruleset`. |
| `POST /api/rooms/join {code}` | 200 `RoomState` | 404 `room_not_found` (unknown, expired or closed); 409 `room_full`. A member gets the same answer again, the host too. The host's socket gets the new `room_state`. |
| `GET /api/rooms/{code}` | 200 `RoomState` | Members only; others get 404 `room_not_found`. |
| `GET /api/rooms/{code}/decks` | 200 `Page[RoomDeckOut]` | The user's decks, each with its `problems` under this room's ruleset. Members only. Paginated and ordered like `/api/decks`. |

- **`RoomState`** is what one player sees of the room. It is also the WebSocket's `room_state` payload, so the frontend has one type.
  ```
  { code, status,
    ruleset: {id, name, definition},
    players: [{user_id, username, is_host, connected, has_deck, ready, seat, away_since}],
    my_deck: {id, name, origin_id, card_count} | null }
  ```
  - `seat` is null until the game starts.
  - The opponent's deck shows only as `has_deck` (confirmed). Its origin shows on the board.
- **`RoomDeckOut`:** `{id, name, origin_id, card_count, problems: [DeckProblem]}`.
- **`DeckProblem`** has the same checks as F2's `deckProblems`:
  - `{kind: "size", count, size}`
  - `{kind: "copies", max, cards: [{id, name}]}`
  - `{kind: "neutral", cards: [{id, name}]}`

### The WebSocket (backend_plan §9.2)
- **Connect:** `WS /ws/rooms/{code}`, with no token in the URL.
- **Messages:** `{type, seq, payload}`. The client numbers its messages with `seq`. A server message is `{type, payload}`: `events` and `error` carry the `seq` they answer in their payload.
- **Auth (confirmed):**
  - The first message must be `auth {token}` (the access token), within 10 s.
  - The server checks the token as REST does (the user must still exist), then that the user is a member.
  - On success the socket gets `room_state`, and `game_state` too during a game.
  - The socket stays logged in until it closes, even after the token expires. A reconnect needs a fresh token, so the client refreshes first.
- **One socket per player and room:** a newer socket from the same user replaces the older one, which closes with 4409.

| Close code | When |
|---|---|
| 4401 | no valid `auth` within 10 s, or the token is invalid or expired; the client refreshes and reconnects |
| 4403 | the user isn't a member of the room |
| 4404 | no such room: unknown, expired or closed |
| 4409 | the same user opened a newer socket |
| 1000 | the room closed, after `room_closed` |
| 1011 | a server error (the middleware's answer) |

**Client → server:**
| Type | Payload | When |
|---|---|---|
| `auth` | `token` | first, once |
| `select_deck` | `deck_id` | lobby |
| `ready` | `ready` (true or false) | lobby |
| `leave` | — | lobby |
| `action` | a player action (§7.4): `play_card`, `move`, `attack`, `end_phase` or `surrender` | game |
| `ping` | — | any time; answered with `pong`, no Redis |
| `resync` | — | any time |

- **`surrender` is an `action`,** since it's an engine action and goes in the log. §9.2's separate `surrender` message is dropped.
- **`abandon` can't be sent:** only the server applies it.

**Server → client:**
| Type | Payload |
|---|---|
| `room_state` | `RoomState` |
| `game_state` | `view` (`view_for`), `legal_actions`, `deadline` and `server_time` (both Unix ms; `deadline` is null outside interactive phases) |
| `events` | `seq` and `events` (`events_for`) |
| `error` | `seq`, `reason`, `message`; `problems` for `deck_not_playable` |
| `game_over` | `winner` (a seat, or null for a draw) and `reason` |
| `room_closed` | — |
| `pong` | — |

- **`game_state`** drops the separate `version` and `phase` that §9.2 listed: both are in `view`.
- **`server_time`** lets the client correct its clock before it counts down to `deadline`.
- **`events.seq`** is the receiver's own message that caused them, so the client knows which pending card resolved. It is null for the opponent's actions and for the timer's.
- **`game_over` has no `game_id` in M6** (confirmed): M7 adds it with the saved game.
- **Error reasons:**
  - the engine's (§7.7)
  - `bad_message`: unknown type or a bad payload
  - `not_in_lobby` and `not_in_game`
  - `deck_not_found`, `deck_not_playable`, `no_deck`
  - `stale_state`

  An error never closes the socket.
- **The message models are added to the OpenAPI schema** as components, with no routes. Then `npm run gen:api` gives F4 and F5 their types (coding-standards §3: no hand-written API types).

### The lobby
- **`select_deck`:**
  - The deck must be the user's own (else `deck_not_found`) and have no problems under the room's ruleset (else `deck_not_playable`, with the problems).
  - Its snapshot is copied then (`deck_snapshot`).
  - Selecting a deck clears the player's ready flag.
- **`ready`:** needs a selected deck (else `no_deck`). `ready: false` takes it back.
- **`leave` (confirmed):**
  - The guest leaving frees their seat, and their deck and ready flag go with it. Anyone with the code can join again.
  - The host leaving deletes the room. The guest gets `room_closed`, then the socket closes with 1000.
  - In a game, a player leaves with `surrender`.
- **A disconnect in the lobby** changes `connected`, and clears the player's ready flag (confirmed 2026-11-15), so a game only starts with both players present.
- **The game starts** as soon as both players have a deck and are ready:
  1. a random seat for each player (confirmed: seat 0 goes first), and a random 63-bit seed, both from `secrets`
  2. `game_id`, a new UUID, for log lines now and for M7's saved game
  3. `start_game(ruleset, decks by seat, seed)`
  4. both players get `room_state`, `events` and `game_state`

### The game (backend_plan §9.3)
- **An action:**
  1. Parse it as a player action. Then, under the room's lock, call `apply_action`.
  2. `IllegalAction`: the sender alone gets `error {seq, reason}`, and the state stays as it was.
  3. Success: save, then each connected player gets `events` (their own, from `events_for`) and then `game_state`.
- **The end of the game:**
  - `status` becomes `finished`.
  - Both players get `events`, `game_state` and `game_over`.
  - The timers stop, and the key expires 10 minutes later.
  - Nothing is written to Postgres yet (M7).
- **The turn timer:**
  - **When it's set:** when an interactive phase starts (a new turn, or the pipeline reaching it), `deadline` = now + its `time_limit_s`. It is stored in the room. Actions inside the phase don't move it.
  - **At the deadline:**
    - `actor: active`: `end_phase` for the active seat
    - `actor: both`: `end_phase` for each seat that isn't ready

    These go in the log as that seat's own actions, so a replay ends the phase the same way.
  - **The task:** one per room. After a restart it is set again from the stored deadline when the room is loaded; a deadline already past fires at once (§10.1).
- **A player who stays away (confirmed):**
  - When a player's socket closes during a game, they get `away_since`. It is stored, and the opponent sees it in `room_state`.
  - Back within 60 s: it is cleared.
  - Otherwise the server applies `abandon` for them: the opponent wins, with `end_reason: abandoned`.
  - If both are away, the first to reach 60 s loses.
  - After a restart, a player without a socket counts as away from the moment the room was loaded.
- **Reconnect and `resync`:** the full `room_state` and `game_state`, with no events.

### Engine: `abandon` (confirmed)
- **`actions.py`:**
  - `Abandon {type: "abandon"}` joins the `Action` union, so logs and replays hold it.
  - `PlayerAction` is the union without it: what the WebSocket accepts.
- **Legality:** it is never in `legal_actions`. `check_action` accepts it from either seat while the game is on (else `game_over`).
- **The runner:** the other seat wins, and `end_reason` is `abandoned` (`EndReason`, the `game_over` event, the view).
- **Golden fixtures:** they don't change.

### Decks into snapshots
- **`deck_service.deck_snapshot(deck, settings)`:**
  - one `CardSnapshot` per copy, with the art URL built from the art key as `card_out` does
  - the origin with its field effects and background URL
- **`deck_service.deck_problems(deck, rules, neutral_id)`:** size (exact), copies, and neutral cards.
  - The backend and F2's `deckProblems` run the same cases from `tests/fixtures/deck_rule_cases.json`, as they do for the cost formula.

### Settings
| Variable | Default | What |
|---|---|---|
| `ROOM_TTL_H` | 24 | how long a room lives after its last change |
| `FINISHED_ROOM_TTL_MIN` | 10 | how long a finished room stays |
| `DISCONNECT_FORFEIT_S` | 60 | how long a player can stay away from a game |
| `WS_AUTH_TIMEOUT_S` | 10 | how long a new socket has to send `auth` |

### Logging (backend_plan §10.2)
- **The fields:** a socket's lines carry `room_code`, `user_id` and, during a game, `game_id`. Background tasks bind their own through `core/tasks.spawn`, and log their own exception at ERROR.
- **REST:** `room.created` (`ruleset_id`) and `room.joined`. The access line has no room code, since the join's code is in the body.
- **Lobby:** `room.left` (`host`), and `room.deck_selected` (DEBUG).
- **Sockets:**
  - `ws.connected` and `ws.closed` (`duration_ms`, `code`)
  - `ws.auth_failed` (INFO, `code`)
  - `ws.replaced` and `ws.resync` (DEBUG)
- **The game:**
  - `game.started` (both users' ids by seat)
  - `game.ended` (`winner`, `end_reason`, `turn_number`, `actions`)
  - `game.action_rejected` (INFO, `reason`, the action's `type`)
  - `game.action_applied` (DEBUG, `type`, `version`, `duration_ms`)
  - `timer.expired` (the phase key, the seats)
  - `game.player_away` and `game.player_back`
- **Redis:** `room.store_conflict` (WARNING) when a compare-and-set loses.
- **Never logged:** the token, the seed, and card names in hands or decks.

### Production and development
- **Production:**
  - Render serves `/ws` on the same origin.
  - The WebSocket route is registered before the frontend's catch-all (`app/frontend.py`).
  - Socket messages count as traffic, so a running game keeps the free instance awake.
- **Development:** nginx already proxies `/ws/` with a long read timeout (§10).
- **Pings:** the client should `ping` about every 30 s (F4, F5), so idle proxies don't close the socket. A ping costs no Redis command.
- **deployment.md:** the CI Redis service, and Redis commands per game.

### Tests (backend_plan §12)
- **Redis:**
  - The real one (confirmed): the docker-compose Redis locally, on DB 15, emptied before each test. The URL and password come from `.env`, as the database's do.
  - CI gets a `redis:7-alpine` service.
- **WebSocket tests:** `httpx-ws==0.10.0` (a new dev dependency; checked on PyPI).
  - Its `ASGIWebSocketTransport` runs the app in the test's own event loop.
  - So sockets share the rolled-back DB session, like the `client` fixture.
- **No sleeps:** the timers take an injectable clock (`now`, `sleep_until`), and tests move it forward.
- **Test files:**
  - `test_rooms.py`: the REST routes and their errors
  - `test_room_lobby.py`: auth and close codes, deck selection and problems, ready, leave, a replaced socket
  - `test_room_game.py`: two clients play a full game to `game_over`, picking moves from `legal_actions` with the engine test bot. Also: errors keep the state, each player gets only their own events, and `events.seq` matches.
  - `test_room_timers.py`: the deadline, `actor: both`, and a deadline restored after the room is reloaded
  - `test_room_away.py`: away and back, `abandoned`, both away, a restart
  - `test_room_store.py`: TTLs, and a lost compare-and-set
  - `test_deck_rules.py`: `deck_problems` on the shared cases
  - `tests/engine/test_abandon.py`
- **`test_openapi.py`** still passes, with the message models in the schema's components.

## Done when
- [x] Two WS clients create and join a room, select decks, get ready and play a full game to `game_over` through `legal_actions`.
- [x] The lobby works: the deck list with problems, a refused deck, ready, the guest leaving, the host closing the room.
- [x] The turn timer ends phases at the deadline, for `actor: active` and `actor: both`, and comes back after a restart.
- [x] A reconnect or `resync` gets the full state; a player away for 60 s loses with `abandoned`.
- [x] Rooms live in Redis with their TTLs, and a restart loses no room.
- [x] The engine has `abandon`, with tests; the golden replays still pass.
- [x] The log events above are written, with the room's fields.
- [ ] **Checks pass:** `pytest` (with Redis), `ruff check .`, `ruff format --check .`, `mypy app tests`; the frontend's checks after `gen:api` and the shared deck-rule cases — all pass locally. CI with its Redis service runs only after a push.

## Decisions
Confirmed with the user on 2026-11-14:
- **Saving finished games is M7's.** M6 keeps a game only in Redis; `game_over` has no `game_id` until M7.
- **Socket login is the first message** (`auth {token}` within 10 s), never a token in the URL.
- **The seats are random:** the server flips a coin, and seat 0 goes first.
- **A player away for 60 s loses with a reason of its own, `abandoned`:** an engine action the server applies and logs, so a replay ends the same way.
- **In the lobby, the guest leaving frees the seat, and the host leaving closes the room.**
- **The lobby's deck list comes from the server** (`GET /api/rooms/{code}/decks`, with each deck's problems).
- **Tests use a real Redis,** locally and in CI.
- **The opponent's deck shows only as "chosen"** until the game starts.

Choices made while writing this spec (say if any should change):
- One Redis key per room, written with a compare-and-set on `rev`, and an in-memory copy per room.
- `surrender` goes through `action`; §9.2's separate `surrender` message is dropped.
- `game_state` carries `server_time`, and drops `version` and `phase` (they're in `view`).
- `events` carries the `seq` of the receiver's own message.
- A newer socket of the same user replaces the older one.
- `ready` takes `true` or `false`; selecting a deck clears it.
- If both players are away, the first to reach 60 s loses. After a restart, a player without a socket counts as away from the moment the room is loaded.
- The WebSocket message models go into the OpenAPI components for `gen:api`.
- The deck rules get a shared case file, like the cost formula.
- `game_id` is made when the game starts, so log lines have it now and M7 can use it as the saved game's id.
- Timers take an injectable clock; WebSocket tests use `httpx-ws`.

Confirmed with the user on 2026-11-15 (planning the build):
- **A lobby disconnect clears the player's ready flag,** so a game only starts with both players there (the spec had "changes only `connected`").
- **Work:** build every step, then report; no commits.

Choices made while building (2026-11-15; say if any should change):
- **The socket's payload models are in `schemas/room.py`,** since the services build them; `ws/protocol.py` has the envelopes, the client-message parsing and the OpenAPI export.
- **The room key is a hash `{rev, data}`.** The Lua scripts return integers only (redis-py 8 speaks RESP3, where a Lua boolean comes back as a Python bool).
- **A server message is `{type, payload}`,** with no `seq` of its own.
- **`connected` isn't stored:** it comes from the live sockets.
- **The socket never holds a DB session:** auth and `select_deck` open a short one each (a session held for a game would keep Neon awake).
- **All times are Unix ms** (`deadline`, `server_time`, `away_since`).
- **After a restart, every player without a socket gets `away_since` = the load time,** overwriting an older value, so the server's downtime never counts against them. A close with 1012 (the server going down) isn't special-cased: a client could send that code too and dodge the countdown, and the reset on load already covers a restart.
- **A guest who leaves** has their socket closed with 1000. **The first message** must be a valid `auth` (else 4401); a later `auth` gets `bad_message`.
- **A finished room closes its sockets** with `room_closed` and 1000 when its 10 minutes are up, as its key expires.
- **Redis:** the client gets `socket_timeout`/`socket_connect_timeout` (`REDIS_TIMEOUT_S`, 5 s), so a hung command can't hold a room's lock; a message that fails on Redis closes its socket with 1011 (the client reconnects and resyncs); a timer task retries with a backoff.
- **Each socket has a bounded send queue and a writer task** (uvicorn's `send` blocks while a client doesn't read); an overflow closes the socket with 1013.
- **`settle` runs after every use of a room:** it keeps away flags, the turn timer, the away tasks and the finished-room task in line with the stored room, so they come back after a restart without special code.
- **Seats and seeds come from `random.SystemRandom`** (the source `secrets` uses), injectable so tests are deterministic.
- **The engine's base models mark every field required in the output JSON Schema** (`json_schema_serialization_defaults_required`), so the generated frontend types have required `type` discriminators. The messages are exported in serialization mode, so no model gets `-Input`/`-Output` twins. `ModuleRef` was left alone, since REST uses it both ways.
- **`ruleset_service.checked_definition`** (was private) is shared by ruleset saves and room creation. **`SessionFactory`** moved to `core/db.py`.

## Tasks
Order:
1. the engine's `abandon`
2. the settings, the Redis test fixture and CI's Redis service
3. `deck_problems`, `deck_snapshot` and the shared deck-rule cases
4. `room_store` and `live_rooms`
5. the REST routes and schemas
6. the WebSocket: protocol, manager, handler, auth and the lobby
7. the game: start, actions, events and `game_state`, the end
8. the turn timer, players away, and restoring after a restart
9. logging, the OpenAPI components and `gen:api`
10. docs

Each step comes with its tests.

### Backend
- [x] Engine: `Abandon`, `PlayerAction`, `abandoned`; its tests and the engine README.
- [x] Settings and `.env.example`; `core/tasks.py`.
- [x] `deck_service.deck_problems` and `deck_snapshot`, and `tests/fixtures/deck_rule_cases.json`.
- [x] `room_store.py` (the key, compare-and-set, TTLs) and `live_rooms.py` (locks, cache, sockets, timers).
- [x] `api/rooms.py` and `schemas/room.py`.
- [x] `ws/protocol.py`, `ws/manager.py` and `ws/handler.py`.
- [x] `room_service.py`: the lobby and the start of the game.
- [x] `game_service.py`: actions, the end, the timer, players away.
- [x] The lifespan: create the live rooms and the notifier, and cancel their tasks on shutdown. The WebSocket route is included next to the API's (the frontend's catch-all is HTTP-only, so it can't shadow it).

### Tests
- [x] The Redis fixture, and the Redis service in `.github/workflows/ci.yml`.
- [x] REST, lobby, game, timers, away, store, deck rules and engine tests.
- [x] A full game between two WS clients.

### Frontend (types and test cases only)
- [x] `npm run gen:api` with the rooms and the message models.
- [x] `deckProblems.test.ts` runs the shared deck-rule cases.

### Docs
- [x] [backend_plan.md](backend_plan.md):
  - §1 and §11: M6 done
  - §3: the new files
  - §4: deck snapshots hold art URLs; `games` waits for M7
  - §7.2, §7.4, §7.6, §7.7: `abandon` and `abandoned`
  - §8: the Rooms routes and their errors
  - §9.1–9.3: one key, compare-and-set, auth by first message, the messages, the lobby, the timer and players away
  - §10.1: timers restored from the stored deadline
  - §10.2: the room and socket events
  - §12: Redis and WebSocket tests
- [x] [frontend_plan.md](frontend_plan.md):
  - §4.4: the deck list from the server, leaving, the opponent's deck hidden, the away countdown
  - §5.1: `GameOverModal` for `abandoned` ("Opponent left the game")
  - §5.3: `events.seq`
  - §6: `RoomSocket` sends `auth` first, handles the close codes, pings and uses `server_time`
- [x] [deployment.md](deployment.md): CI's Redis service, Redis commands per game, the in-process state; the Upstash-archiving note no longer applies once rooms use Redis.
- [x] Update this file, and write the session file.

## Out of scope
- **Saving finished games, `GET /api/games` and replay data** (M7). M7 writes the row at the game's end from the room, with its `game_id`; the `games` table needs a nullable winner for draws.
- **The lobby and the board UI** (F4, F5).
- **Spectators, rematches, chat, matchmaking,** a list of open rooms, inviting by username.
- **Changing the ruleset in a lobby:** create a new room.
- **AFK rules beyond the timer,** such as losing after several timeouts in a row.
- **More than one worker:** Redis locks and pub/sub (§13).
- **Closing sockets** when the user logs out elsewhere.
- **Rate limits** on socket messages.

## Notes
- **What exists:**
  - `core/codes.py` (the code alphabet)
  - `app.state.redis` with `health_check_interval=30`
  - `RequestContextMiddleware._websocket`, which logs an unhandled error and closes with 1011
  - nginx's `/ws/` location, and an empty `app/ws/__init__.py`
- **Reuse:**
  - `auth_service.user_from_token`
  - `ruleset_service.get_ruleset` and `ruleset_definition`
  - `rules_service.validate_definition`
  - `deck_service.get_deck` (`WITH_CARDS`)
  - `card_service.card_out` and `origin_service.origin_out` (art URLs)
  - `origin_service.neutral_origin_id`
  - `id_name_list`, `Page`, `paginate`
- **The engine's API:** `start_game`, `legal_actions`, `apply_action`, `view_for` and `events_for` from `app.engine.runner` (the engine README).
- **The tests:**
  - Most rulesets in tests need a small `deck.size`: the default asks for exactly 30 cards.
  - The engine test bot (`tests/engine/builders.greedy_action`) can pick moves for the full-game test.

## Open questions
None. The "Choices made while writing this spec" are open to change.
