# Backend implementation plan

The backend for the card-game constructor described in [project_description.md](project_description.md). The frontend plan is in [frontend_plan.md](frontend_plan.md).

## 0. Design decisions (agreed)

| Topic | Decision |
|---|---|
| Win condition | Every field section has HP. An unblocked attacker damages the enemy section in its lane. A player wins when all enemy sections reach 0 HP, or when the opponent surrenders. |
| Rules ("turn flow") | An ordered **phase pipeline** of parameterized modules, stored as JSON. No visual scripting. |
| Lanes | **Set in the rules**: 1–5 lanes, default 3. Each player has one section per lane, so the default board has 6 sections. |
| Origins / field types | **Users create origins the same way they create cards.** An origin has a name, look and field effects chosen from modules. A few system origins are seeded as templates. |
| Field type | Set **per side**. Each player's sections take the field type of that player's deck origin. |
| Board | Each section has **N creature slots**, set in the rules (default 3). Creatures move only when a phase allows it. |
| Turn timer | **Default 90 s.** Each interactive phase in the rules has its own `time_limit_s`, which the user can change (10–600 s). |
| Card cost | A budget formula **suggests** a mana cost. **The card author always sets the final cost**, and the server never rejects a card because of the formula. |
| Accounts | Registered accounts only (JWT). Every action, including joining a room, needs a login. |
| Authority | The **server is authoritative**. Clients send actions, and the server validates them, applies them and sends back state. |

## 1. Current state of the repo

M0 (infrastructure) is done:
- `backend/app` has the app factory with a lifespan (DB engine, Redis, R2 client), `core/` (config, db, deps), `GET /api/health`, the R2 storage client, Alembic with an empty baseline, `pyproject.toml` (ruff, mypy, pytest) and pinned `requirements.txt`.
- `docker-compose.yml` runs Postgres 16, Redis 7 and nginx (`nginx/default.conf`). File storage is Cloudflare R2, which is external, so there is no storage container. The official MinIO images were removed from Docker Hub and quay.io.
- There is no JWT library yet (M1).

## 2. Stack

| Concern | Choice |
|---|---|
| Web framework | FastAPI (already installed) |
| ORM / migrations | SQLAlchemy 2.0 (async) + asyncpg, Alembic |
| Config | pydantic-settings, reading `.env` |
| Live state | Redis (`redis.asyncio`) |
| File storage | Cloudflare R2 through its S3 API with `aioboto3` (async), using presigned URLs. Card art is read from the bucket's public URL (custom domain or r2.dev). |
| Auth | `pwdlib[argon2]` for password hashing, `PyJWT` for access and refresh tokens |
| Tests | pytest, pytest-asyncio, httpx |
| Process model | uvicorn with **one worker** in v1, so room locks can stay in-process (see §12 for scaling) |

## 3. Package layout

```
backend/
  app/
    main.py            app factory, router registration, lifespan (DB/Redis/R2 clients)
    core/
      config.py        Settings (DB URL, Redis URL, R2 creds, JWT secret, limits)
      security.py      password hashing, JWT encode/decode
      db.py            async engine + session factory
      deps.py          get_db, get_redis, get_s3, get_current_user
    models/            SQLAlchemy ORM: user, origin, card, deck, ruleset, game
    schemas/           Pydantic request/response DTOs
      rules.py         RulesetDefinition (versioned)
    api/               router.py (mounts everything under /api) + routers: health, auth, catalog,
                       origins, cards, decks, rulesets, share, rooms, games, uploads
    storage/           R2 (S3 API) client, presigned PUT, object key naming
    engine/            PURE game logic: no DB, no Redis, no network (see §7)
      registry.py      module registry + decorators
      state.py         GameState, PlayerState, Section, CreatureInstance
      actions.py       Action types
      events.py        Event types
      runner.py        start_game / legal_actions / apply_action / view_for
      rng.py           seeded deterministic RNG
      cost.py          cost-suggestion formula
      modules/
        phases/        draw, gain_mana, action_phase, lane_combat, end_turn, ...
        features/      taunt, charge, ranged, armor, ...
        spells/        deal_damage, heal, draw_cards, ...
        field_effects/ stat_bonus, section_hp_bonus, free_move, ...  (used by origins)
    services/
      health_service.py dependency checks for /api/health
      room_service.py  room lifecycle: Redis <-> engine glue, timers
      share_service.py share codes, forking imports
    ws/
      manager.py       connections per room, per-player send
      protocol.py      message schemas
      handler.py       /ws/rooms/{code} endpoint
  alembic/
  tests/
  requirements.txt
  .env.example
```

## 4. Data model (Postgres)

```
users        id PK, username UNIQUE, email UNIQUE, password_hash, created_at

origins      id PK, owner_id FK users NULL (NULL = system origin, readable by all),
             name, color, icon, background_art_key NULL,
             field_effects JSONB  -- [{key, params}], max 3
             is_public, created_at, updated_at

cards        id PK, owner_id FK users, kind ('creature'|'spell'), name, origin_id FK origins,
             mana_cost, dmg, hp NULL (spells), abilities JSONB  -- [{key, params}], max 2
             art_key NULL, is_public, created_at, updated_at

decks        id PK, owner_id FK, name, origin_id FK origins, is_public, share_code UNIQUE NULL,
             created_at, updated_at
deck_cards   deck_id FK, card_id FK, count       PK(deck_id, card_id)

rulesets     id PK, owner_id FK, name, definition JSONB, schema_version,
             is_public, share_code UNIQUE NULL, created_at, updated_at

games        id PK, room_code, ruleset_snapshot JSONB,
             p1_id FK, p2_id FK, p1_deck_snapshot JSONB, p2_deck_snapshot JSONB,
             seed BIGINT, action_log JSONB, winner_id FK NULL, end_reason,
             started_at, ended_at
```

Notes:
- **Origins are user-created rows**, like cards. Their behaviour comes from `field_effects`: a list of registered field-effect modules with params (§5). Users combine ready-made effects and never write code.
- **System origins** (`owner_id = NULL`) are seeded as templates and can be used by everyone: `neutral`, `forest`, `volcano`, `ocean` and `mountain`. `neutral` is special: it has no field effects, and neutral cards can go into any deck.
- A card may use one of the user's own origins or a system origin.
- `games` stores the seed and the full action log, so any game can be replayed exactly (§7.9). The deck snapshots include the origin with its field effects.
- A deck has a single origin. Its cards must have that origin or `neutral` (when the ruleset allows neutral cards).

## 5. Module registry

The registry is how the "modular" idea works. Each module is a Python class registered under a key:

```python
@feature("taunt")
class Taunt(FeatureModule):
    name = "Taunt"
    description = "Enemies in this lane must attack this creature first."
    class Params(BaseModel):
        pass
    def cost(self, params) -> int: return 2
    def on_query_blockers(self, ctx, creature): ...
```

Each module declares:
- a `key`, a display name and a description
- a `Params` Pydantic model. Its JSON Schema is exported to the frontend.
- `cost(params) -> int` (features and spell effects only), used by the cost suggestion
- behaviour hooks (see §7.5)

`GET /api/catalog` returns every module, grouped by kind, with its params JSON Schema and cost information. **The frontend builds its card editor and rules editor forms from this catalog**, so adding a module needs no frontend change.

### Starter module set

| Kind | Modules |
|---|---|
| Phases | `draw {count}`, `gain_mana` (Hearthstone-style: max mana +per_turn up to the cap, then refill), `action_phase {actor: active\|both, allow: [play, move, attack], time_limit_s = 90}`, `lane_combat` (automatic resolution, lane by lane), `discard_to_hand_limit`, `end_turn` |
| Creature features | `taunt`, `charge` (can attack the turn it is played), `ranged` (can also hit a neighbouring lane), `armor {amount}`, `lifesteal_section` (damage dealt heals your own section), `deathrattle_damage {amount}`, `field_affinity` (extra bonus on its own field type) |
| Spell effects | `deal_damage {target}`, `heal {target}`, `draw_cards {count}`, `buff {dmg, hp}`, `summon_token {hp, dmg}`, `move_enemy`, `damage_section` |
| Field effects (used by origins) | `stat_bonus {applies_to: own_origin\|all_own\|enemy, hp, dmg}`, `section_hp_bonus {amount}`, `free_move` (moving costs no action), `mana_discount {card_kind, amount}`, `turn_start_heal_section {amount}`, `spell_power {amount}` |
| Seeded system origins | `neutral` (no effects), `forest` (`stat_bonus` +1 HP to own-origin creatures), `volcano` (`stat_bonus` +1 DMG), `ocean` (`free_move`), `mountain` (`section_hp_bonus` +5) |

Field effects have no cost formula. Their strength is limited by bounds on their params (for example `stat_bonus` is at most +2) and by allowing at most 3 effects per origin.

## 6. Rules JSON (`RulesetDefinition`)

```json
{
  "schema_version": 1,
  "board":  { "lanes": 3, "slots_per_section": 3, "section_hp": 20 },
  "deck":   { "size": 30, "max_copies": 2, "allow_neutral": true },
  "mana":   { "start": 1, "per_turn": 1, "max": 10 },
  "hand":   { "start_size": 3, "max_size": 10, "second_player_bonus_card": true },
  "setup":  [ { "module": "draw", "params": { "count": 3 } } ],
  "turn": [
    { "module": "gain_mana" },
    { "module": "draw", "params": { "count": 1 } },
    { "module": "action_phase",
      "params": { "actor": "active", "allow": ["play", "move", "attack"], "time_limit_s": 90 } },
    { "module": "end_turn" }
  ]
}
```

Validation happens on `POST /api/rulesets/validate`, on save, and again when a game starts:
- Every `module` key exists in the registry, and its `params` pass that module's `Params` model.
- `turn` contains at least one interactive phase (`action_phase`) and exactly one `end_turn`, which must be last.
- Numbers are within bounds: `lanes` is 1–5 (default 3), `slots_per_section` is 1–5, `section_hp` is 1–100, `deck.size` is 10–60, `mana.max` is 1–20, and `action_phase.time_limit_s` is 10–600 (default 90).
- `schema_version` lets old rulesets be migrated when the format changes.

## 7. Game engine (`app/engine`)

### 7.1 Principles
- **Pure and deterministic.** The engine never touches the DB, Redis or the network. The same seed and the same actions always produce the same state. This makes it easy to test and gives replays for free.
- **No `eval` or dynamic code.** Rules JSON can only refer to registered modules.

### 7.2 State
`GameState` (Pydantic, serializable to JSON):
- `ruleset`, `seed`, `rng_state`, `turn_number`, `active_player`, and a `phase_pointer` (whether we're in setup or turn, plus the index)
- `players[2]`, each with `user_id`, `deck` (ordered list of card instances), `hand`, `mana`, `max_mana`, `origin` and `ready` flag
- `sections[2][lanes]`, each with `owner`, `lane`, `hp`, `max_hp`, `field_effects`, `slots[N]` (each a creature instance or empty) and `conquered`
- Each player's `origin` is a snapshot with its name, look and field effects, taken from the deck when the game starts
- `CreatureInstance`: `uid`, `card` snapshot, `hp`, `dmg`, `abilities`, `owner`, `exhausted`, `has_moved`, `status` effects
- `version`, which goes up by one after every applied action
- `log`, the list of applied actions

### 7.3 Runner API
```python
start_game(ruleset, deck_p1, deck_p2, seed) -> (GameState, list[Event])
legal_actions(state, player) -> list[Action]
apply_action(state, player, action) -> (GameState, list[Event])   # raises IllegalAction
view_for(state, player) -> PlayerView                             # hides opponent's hand and deck
```

**Runner loop:** walk the pipeline from `phase_pointer`. Automatic phases (`draw`, `gain_mana`, `lane_combat`, `end_turn`) run right away and emit events. When the runner reaches an interactive phase (`action_phase`), it stops and waits for actions. After `end_turn` it moves the active player forward and starts the `turn` list again.

### 7.4 Actions
| Action | Payload |
|---|---|
| `play_card` | `card_uid`, `target` (section and slot for a creature; a creature, section or none for a spell) |
| `move` | `creature_uid`, `to_section`, `to_slot` |
| `attack` | `creature_uid`, `target` (an enemy creature or the enemy section in the same lane, or a neighbouring lane for `ranged`) |
| `end_phase` | — (the active player); in an `actor: both` phase this is `ready` |
| `surrender` | — |

`legal_actions` lists every valid action and all of its valid targets. **The frontend uses this list to decide which cards are draggable and where they can be dropped** (see frontend_plan §5).

### 7.5 Combat and features
- A creature attacks within its own lane. If the enemy section in that lane has creatures (or any with `taunt`), it has to attack one of those. Only when the section has no blockers can it damage the section's HP.
- Creature-vs-creature combat: both creatures deal damage to each other at the same time, like in Hearthstone.
- A section at 0 HP becomes `conquered`. Its creatures stay, but it can't be healed. When all of a player's sections are conquered (one per lane), `game_over` fires.
- `ranged` creatures can hit a neighbouring lane only if one exists. With 1 lane, `ranged` has no extra effect.
- Card features hook into an **internal event bus**: `on_play`, `on_attack`, `on_damaged`, `on_death`, `on_turn_start`, `on_turn_end`. These triggers are only for card features and are **not exposed in the rules editor**.
- Field-type bonuses come from the **field-effect modules** listed in each player's origin snapshot. They use the same hooks and apply to that player's sections.

### 7.6 Events
Every change emits a typed event, for example `card_drawn`, `mana_changed`, `creature_summoned`, `creature_moved`, `attack`, `damage`, `heal`, `creature_died`, `section_hp_changed`, `section_conquered`, `phase_changed`, `turn_started` or `game_over`. The frontend plays these as animations. Events that reveal hidden information (for example `card_drawn`) are stripped down per player.

### 7.7 Safety limits
- A maximum number of engine steps per `apply_action` (for example 1000) and a maximum depth for chains of triggered effects (for example 20). If either is exceeded, the action is rejected and logged.
- `IllegalAction` carries a machine-readable reason (`not_your_turn`, `not_enough_mana`, `slot_occupied`, `invalid_target`, ...).

### 7.8 Cost suggestion (never enforced)
```
points              = hp + dmg + Σ ability.cost(params)     # creatures
points              = dmg + effect.cost(params)             # spells
suggested_mana_cost = ceil((points - 1) / 2)                # constants can be tuned in cost.py
balance             = 'under' | 'balanced' | 'over'         # comparing the author's mana_cost to the suggestion
```
- **The card author always sets the final `mana_cost`.** The server only checks hard bounds (mana 0–10, hp 1–99, dmg 0–99).
- Card responses include `suggested_mana_cost` and `balance` so they can be shown in the UI.
- `POST /api/cards/suggest-cost` returns the suggestion for an unsaved draft. The frontend can also work it out itself from the catalog's ability costs.

### 7.9 Hidden information and replays
- `view_for` replaces the opponent's hand and deck with counts, and hides the order of the player's own deck.
- A replay is the ruleset snapshot, both deck snapshots, the seed and the action log. Running them through the engine again gives back every intermediate state.

## 8. REST API

All endpoints except register and login need `Authorization: Bearer <access token>`.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login` → `{access, refresh}`, `POST /api/auth/refresh`, `GET /api/auth/me` |
| Catalog | `GET /api/catalog` |
| Origins | `GET /api/origins` (mine plus system origins), `POST /api/origins`, `GET/PATCH/DELETE /api/origins/{id}` (system origins are read-only), `POST /api/uploads/origin-art` (background image) |
| Cards | `GET /api/cards` (mine; filters: origin_id, kind), `POST /api/cards`, `GET/PATCH/DELETE /api/cards/{id}`, `POST /api/cards/suggest-cost` |
| Uploads | `POST /api/uploads/card-art` → `{upload_url, art_key}` (presigned PUT; png/jpeg/webp, 2 MB or less) |
| Decks | `GET /api/decks`, `POST /api/decks`, `GET/PATCH/DELETE /api/decks/{id}`, `POST /api/decks/{id}/share` → `{share_code}` |
| Rulesets | `GET /api/rulesets`, `POST /api/rulesets`, `GET/PATCH/DELETE /api/rulesets/{id}`, `POST /api/rulesets/validate`, `POST /api/rulesets/{id}/share` |
| Sharing | `GET /api/share/{code}` (preview), `POST /api/share/{code}/import`. An import **forks** a copy into your library. Importing a deck also copies its cards and its custom origin; system origins are not copied. |
| Rooms | `POST /api/rooms {ruleset_id}` → `{code}` (6 characters, no look-alike characters), `POST /api/rooms/join {code}`, `GET /api/rooms/{code}` |
| History | `GET /api/games`, `GET /api/games/{id}` (with everything needed for a replay) |
| Health | `GET /api/health` |

Deleting a card that is used in one of your decks returns `409`, with the list of decks that use it. The same applies to deleting an origin that is used by any of your cards or decks.

## 9. Rooms and the WebSocket protocol

### 9.1 Room lifecycle
```
create (host) ──► lobby ──(guest joins by code)──► lobby (2 players)
     ──(both select deck + ready)──► playing ──(win / surrender / forfeit)──► finished
```
- Redis keys (24 h TTL):
  - `room:{code}` holds the host, guest, ruleset snapshot, chosen deck snapshots, ready flags and status
  - `game:{code}` holds the serialized `GameState`
- The ruleset is copied into the room when the room is created. The decks are copied when players select them. **Edits made after that don't affect the room.**
- A deck is offered for selection only if it meets the ruleset's `deck` rules (size, copies, origin or neutral).

### 9.2 WebSocket
Connect with `WS /ws/rooms/{code}?token=<access token>`. Every message has the form `{ "type": ..., "seq": n, "payload": {...} }`.

| Direction | Type | Payload |
|---|---|---|
| C → S | `select_deck` | `deck_id` |
| C → S | `ready` | — |
| C → S | `action` | an Action (§7.4) |
| C → S | `surrender` | — |
| C → S | `ping` / `resync` | — |
| S → C | `room_state` | players, selected decks, ready flags, status |
| S → C | `game_state` | `view`, `version`, **`legal_actions`**, `phase`, `deadline` |
| S → C | `events` | the list of events from the last action (filtered per player) |
| S → C | `error` | `seq`, `reason` |
| S → C | `game_over` | `winner`, `reason`, `game_id` |

### 9.3 Processing
- Each room has its own `asyncio.Lock`. For each action the server:
  1. loads the state
  2. calls `engine.apply_action`
  3. saves the state to Redis
  4. sends `events` and then `game_state` to each player, each with their own view
- **Turn timer:** every interactive phase has a `time_limit_s` from the ruleset (default 90 s, editable by the rules author). An asyncio task runs `end_phase` automatically at the deadline. In `actor: both` phases, players who aren't ready by then are marked ready. The deadline is included in `game_state`.
- **Reconnect:** a client that reconnects (or sends `resync`) gets the full current `room_state` and `game_state`. If a player stays disconnected for more than 60 s during a game, they forfeit.
- **Game over:** the match is written to Postgres `games`, the clients get `game_over`, and the Redis keys expire after 10 minutes.

## 10. Infrastructure tasks

- **`nginx/default.conf`** (done in M0):
  - `/api/` goes to `http://host.docker.internal:8000`.
  - `/ws/` goes to `http://host.docker.internal:8000`, with the `Upgrade` and `Connection` headers and a long read timeout.
  - `/` goes to the Vite dev server on `http://host.docker.internal:5173` (with WS upgrade for hot reload). In production it serves the built frontend.
  - There is no `/media/`: card art is served from the R2 public URL.
- `.env.example` lists every variable used in `docker-compose.yml` and `Settings` (done in M0).
- **R2 setup (manual, in the Cloudflare dashboard):** a bucket, an API token with Object Read & Write on it, public access (custom domain or r2.dev) for card art, and a CORS rule allowing `PUT` from the app origin for presigned uploads (needed in M2).
- `requirements.txt` and the baseline Alembic migration are done (M0). Still to do: `scripts/seed.py`, which creates starter cards, two starter decks and a default ruleset.

## 11. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Infra: settings, DB session, Alembic, nginx conf, `/api/health` | `docker compose up` works, and the health check through nginx returns 200 (Postgres, Redis and R2 reachable) |
| M1 | Auth | register, login, refresh and `me` work; protected routes return 401 without a token |
| M2 | Module registry, catalog, origins, cards, art upload | origins and cards CRUD work; system origins are seeded; `catalog` lists the modules (including field effects) with their JSON Schemas; images upload to R2 through a presigned URL and are visible at the bucket's public URL |
| M3 | Decks, share and import | deck rules are checked; importing a share code creates a forked copy |
| M4 | Rulesets, validation, share and import | `/validate` returns errors per field; the default ruleset is seeded |
| M5 | Engine core | the full starter module set works; golden replay tests pass |
| M6 | Rooms, WebSocket, Redis persistence, timers, reconnect | two WS clients can play a full game to a win |
| M7 | Match history, replay data, polish | `GET /api/games/{id}` can be replayed exactly |

The frontend milestones (F0–F6) in [frontend_plan.md](frontend_plan.md) are designed to start once the matching backend milestone is done.

## 12. Testing

- **Engine unit tests** for every module: phases, features, spells and field effects.
- **Board-size tests:** full games with 1, 3 and 5 lanes, to check that the win condition and `ranged` targeting work for every size.
- **Golden replay tests:** a seed, a ruleset, two decks and a list of actions must produce a known final state (stored as JSON fixtures).
- **Property test:** for random games, every action from `legal_actions` is accepted by `apply_action`, and random other actions are rejected.
- **API tests** with httpx against a throwaway Postgres (a docker service or testcontainers).
- **WS integration test:** two simulated clients create and join a room, select decks and play to `game_over`.

## 13. Suggestions and future work

- **The server decides, and the UI follows `legal_actions`.** This is the single most important architecture decision. It prevents cheating and keeps all rules in one place, in Python.
- **Copy content when a game or import starts.** Rooms copy the ruleset and decks; imports fork copies. Later edits by the author never break anyone's game or library.
- **Single-origin decks** (plus neutral cards) keep the field-type mechanic meaningful.
- **Make the second player's disadvantage configurable.** Hearthstone gives the second player an extra card or "the coin". Here it is the `hand.second_player_bonus_card` option, and it could become a `coin` spell module later.
- **Simultaneous (`actor: both`) phases:** in v1, actions apply in the order they arrive, and the phase ends when both players are `ready`. A later option is commit-reveal (both submit hidden orders, which resolve together).
- **Spectators and replays** need little extra work given the seed and action log.
- **Scaling beyond one worker:** move room locks to Redis (`SET NX` with an expiry) and send room messages through Redis pub/sub, so any worker can serve any socket.
- **Moderation:** uploaded art is public. Check type and size (and later, image dimensions), and add a "report" endpoint.
- **Rate limiting** on auth and upload endpoints (for example `slowapi`).

## 14. Resolved questions

1. **Origins:** users create them like cards, from field-effect modules (§4, §5). The seeded system origins are only templates.
2. **Turn timer:** default 90 s. It is set per interactive phase in the rules and is editable (10–600 s).
3. **Lanes:** a rules option, 1–5 lanes with a default of 3 (§6).

## 15. Use case → backend coverage

| Use case (project_description.md) | Backend |
|---|---|
| UC1 Create a card | `POST /api/cards`, `POST /api/uploads/card-art`, `GET /api/catalog` |
| *(new)* Create an origin | `POST /api/origins`, `POST /api/uploads/origin-art`, `GET /api/catalog` (field effects) |
| UC2 Create a deck | `POST /api/decks` |
| UC3 Create a room | `POST /api/rooms` |
| UC4 Create turn-flow rules | `POST /api/rulesets`, `POST /api/rulesets/validate` |
| UC5 Load saved rules | `GET /api/rulesets`, `GET /api/rulesets/{id}` |
| UC6 Invite second player via code | room `code` from `POST /api/rooms` |
| UC7 Play game | `WS /ws/rooms/{code}`, engine |
| UC8 Share deck | `POST /api/decks/{id}/share`, `/api/share/{code}` |
| UC9 Share rules | `POST /api/rulesets/{id}/share`, `/api/share/{code}` |
| UC10 Join a game via code | `POST /api/rooms/join` |
| UC11 Select deck | WS `select_deck` |
| UC12 Save rules | `POST/PATCH /api/rulesets` |
