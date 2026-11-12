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

M1 (auth) is done:
- `users` table (UUID PK, case-insensitive unique username and email) with its Alembic migration. `Base.metadata` has a constraint naming convention.
- `core/errors.py` (`AppError`, `UnauthorizedError` and handlers that give every error the `{"detail": {code, message}}` body), `core/security.py` (argon2 via pwdlib, PyJWT access and refresh tokens), `services/auth_service.py`, and `api/auth.py` with register, login, refresh and me. Since F0, the refresh token travels in an HttpOnly cookie, and `api/auth.py` also has logout (see §8).
- `get_current_user` and the `CurrentUser` alias in `core/deps.py` protect any route.
- `tests/conftest.py` runs API tests against `<POSTGRES_DB>_test`, with one rolled-back transaction per test.

M2 (content) is done:
- `engine/registry.py` (module kinds, base classes, decorators, `CostSpec`, `DmgUse`, `ModuleRegistry`) and every starter module in `engine/modules/<kind>/` (§5). `engine/cost.py` holds the cost suggestion (§7.8).
- `GET /api/catalog` publishes the registry, plus the origin colours and icons.
- `origins` (with the five seeded system origins), `cards` and `card_groups` tables, with CRUD under `/api/origins`, `/api/cards` and `/api/card-groups`, and `POST /api/cards/suggest-cost`.
- Art upload: `POST /api/uploads/card-art` and `/api/uploads/origin-art` return a presigned R2 `PUT` URL. A saved art key is checked with a `HEAD`.
- Shared pieces: `AppError(extra=...)`, `Page[T]` with the `Pagination` dependency, and `services/common.py` (`get_owned`, `paginate`, module-reference validation).

M3 (decks, share and import) is done:
- `decks` and `deck_cards` tables, with CRUD under `/api/decks`. A deck is checked against its structural rules and the hard bounds (§4).
- Cards and origins that decks use are protected with 409s (§8).
- `share_codes` table. Decks and card groups can be shared, previewed (`GET /api/share/{code}`) and imported as a forked copy (`POST /api/share/{code}/import`).
- Shared pieces: `OwnedMixin` (the `owner_id` column that `get_owned` relies on), `core/codes.py` (the no-look-alike code alphabet) and `id_name_list` for `[{id, name}]` error bodies.

Deployment is set up (2026-11-10, see §10.1):
- a root `Dockerfile` (it builds the frontend; the API serves it), `render.yaml`, `backend/scripts/start.sh` and GitHub Actions CI
- `app/frontend.py`, `GET /api/health/live`, Neon-style `DATABASE_URL`s accepted, `REDIS_PASSWORD` optional, dev tools moved to `requirements-dev.txt`

Art cleanup is built (2026-11-11, see §10.3):
- `services/art_cleanup_service.py`: a daily sweep, started from the lifespan when `ART_SWEEP_ENABLED` is set, deletes art objects that no card or origin references
- `scripts/sweep_art.py` runs the sweep by hand, as a dry run unless `--delete` is passed

M4 (rulesets, validation, share and import) is done (2026-11-12):
- `schemas/rules.py` (`RulesetDefinition`, `RuleError`, `migrate()`) and `services/rules_service.py`, whose `validate_definition` reports every problem at once, each with a path into the definition (§6).
- `rulesets` table with CRUD under `/api/rulesets`, `POST /api/rulesets/validate`, and the seeded read-only default ruleset (§4).
- `share_codes.ruleset_id`: rulesets can be shared, previewed and imported like decks and groups (§8).

## 2. Stack

| Concern | Choice |
|---|---|
| Web framework | FastAPI (already installed) |
| ORM / migrations | SQLAlchemy 2.0 (async) + asyncpg, Alembic |
| Config | pydantic-settings, reading `.env` in development and the environment in production |
| Live state | Redis (`redis.asyncio`) |
| File storage | Cloudflare R2 through its S3 API with `aioboto3` (async), using presigned URLs. Card art is read from the bucket's public URL (custom domain or r2.dev). |
| Auth | `pwdlib[argon2]` for password hashing, `PyJWT` for access and refresh tokens |
| Logging | `structlog` on top of stdlib `logging`: events with fields, coloured lines in dev, JSON lines in production (§10.2) |
| Tests | pytest, pytest-asyncio, httpx |
| Process model | uvicorn with **one worker** in v1, so room locks can stay in-process (see §13 for scaling) |
| Hosting | One Render web service (Docker) that also serves the built frontend; Neon (Postgres), Upstash (Redis), R2 (art). See §10.1. |

## 3. Package layout

```
backend/
  app/
    main.py            app factory, router registration, lifespan (DB/Redis/R2 clients)
    frontend.py        serves the built frontend (production only, when FRONTEND_DIST_DIR is set)
    core/
      config.py        Settings (DB URL, Redis URL, R2 creds, JWT secret, limits)
      errors.py        AppError / UnauthorizedError + handlers ({"detail": {code, message}})
      security.py      password hashing, JWT encode/decode
      db.py            Base (with constraint naming convention), async engine + session factory
      deps.py          get_db, get_redis, get_s3, get_current_user (CurrentUser), get_optional_user_id
      codes.py         random share and room codes from a no-look-alike alphabet
      logging_config.py  configure_logging, get_logger, redaction, StepTimer (§10.2)
      middleware.py    RequestContextMiddleware: request ids, the access line, unhandled errors
    models/            SQLAlchemy ORM: user, origin, card, card_group, deck, share_code, ruleset, game
    schemas/           Pydantic request/response DTOs
      rules.py         RulesetDefinition (versioned), RuleError, migrate()
      ruleset.py       ruleset create/update/out, validate request and result
    api/               router.py (mounts everything under /api) + routers: health, auth, catalog,
                       origins, cards, card_groups, decks, rulesets, share, rooms, games, uploads,
                       client_logs
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
      common.py        get_owned (404 for other users' rows), paginate, module-ref validation
      health_service.py dependency checks for /api/health
      auth_service.py  register, authenticate, refresh, user_from_token
      catalog_service.py  the catalog, built once from the registry
      origin_service.py / card_service.py / card_group_service.py / deck_service.py /
      ruleset_service.py  content CRUD and rules
      rules_service.py validate_definition: every ruleset problem, with its path (§6)
      upload_service.py   presigned art uploads, art-key checks on save
      art_cleanup_service.py  the daily sweep of art no row references (§10.3)
      room_service.py  room lifecycle: Redis <-> engine glue, timers
      share_service.py share codes, forking imports
      client_log_service.py  the browser's warnings and errors as `web.*` lines, rate-limited
    ws/
      manager.py       connections per room, per-player send
      protocol.py      message schemas
      handler.py       /ws/rooms/{code} endpoint
  alembic/
  scripts/start.sh     production entrypoint: migrations, then uvicorn
  scripts/sweep_art.py the art sweep by hand: python -m scripts.sweep_art [--delete] (§10.3)
  tests/
  requirements.txt     runtime packages (what the image installs)
  requirements-dev.txt + tests, ruff, mypy
.env.example           (repo root, with Dockerfile, .dockerignore, render.yaml, .github/workflows/)
```

## 4. Data model (Postgres)

```
users        id UUID PK, username UNIQUE (case-insensitive), email UNIQUE (stored lowercased),
             password_hash, created_at

origins      id PK, owner_id FK users NULL (NULL = system origin, readable by all),
             system_key UNIQUE NULL ('neutral', 'forest', ...; set only on system origins),
             name, color (palette key), icon (icon key), background_art_key NULL,
             field_effects JSONB  -- [{key, params}], max 3, no repeated key
             created_at, updated_at

cards        id PK, owner_id FK users, kind ('creature'|'spell'), name, origin_id FK origins
             (ON DELETE RESTRICT), mana_cost, dmg NULL, hp NULL (spells),
             abilities JSONB  -- [{key, params}], max 2
             group_id FK card_groups NULL (NULL = ungrouped; ON DELETE SET NULL),
             art_key NULL, created_at, updated_at
             INDEX (owner_id, origin_id), INDEX (group_id)

card_groups  id PK, owner_id FK users, name (unique per owner, ignoring case),
             created_at, updated_at

decks        id PK, owner_id FK users, name, origin_id FK origins (ON DELETE RESTRICT),
             created_at, updated_at
             INDEX (owner_id, origin_id)
deck_cards   deck_id FK decks (ON DELETE CASCADE),
             card_id FK cards (NO ACTION, DEFERRABLE INITIALLY DEFERRED), count (>= 1)
             PK(deck_id, card_id), INDEX (card_id)

share_codes  code PK (10 characters), created_at,
             deck_id FK decks NULL UNIQUE, card_group_id FK card_groups NULL UNIQUE,
             ruleset_id FK rulesets NULL UNIQUE
             (all ON DELETE CASCADE; CHECK num_nonnulls(deck_id, card_group_id, ruleset_id) = 1)

rulesets     id PK, owner_id FK users NULL (ON DELETE CASCADE; NULL = system ruleset),
             system_key UNIQUE NULL ('default'; set only on system rulesets),
             name, definition JSONB (a normalized RulesetDefinition, §6), schema_version,
             created_at, updated_at
             CHECK (owner_id IS NULL) = (system_key IS NOT NULL), INDEX (owner_id)

games        id PK, room_code, ruleset_snapshot JSONB,
             p1_id FK, p2_id FK, p1_deck_snapshot JSONB, p2_deck_snapshot JSONB,
             seed BIGINT, action_log JSONB, winner_id FK NULL, end_reason,
             started_at, ended_at
```

Notes:
- **Every `id` is a UUID** (`uuid4`), so ids in URLs and share flows can't be guessed or counted.
- **Origins are user-created rows**, like cards. Their behaviour comes from `field_effects`: a list of registered field-effect modules with params (§5). Users combine ready-made effects and never write code.
- **System origins** (`owner_id = NULL`) are seeded as templates and can be used by everyone: `neutral`, `forest`, `volcano`, `ocean` and `mountain`. `neutral` is special: it has no field effects, and neutral cards can go into any deck.
  - A data migration inserts them, so every database (the test DB too) has them. Code finds one by its `system_key`, never by UUID. A check constraint makes `owner_id` and `system_key` mutually exclusive.
  - Changing or deleting one gives 403 `system_origin_read_only`. The frontend's "duplicate" button just `POST`s a copy.
- **Origin colours and icons are keys**, not hex values or file names. Colours come from the Okabe–Ito colour-blind-safe palette plus grey. Both lists live in `schemas/origin.py`, and the catalog publishes them.
- **There is no `is_public` column.** A share code is an unlisted link. A public flag waits until there is a public gallery.
- **Timestamps on content tables use `clock_timestamp()`**, not `now()`. `now()` is fixed for a whole transaction, so rows created together (an M3 import) would tie, and "newest first" would come out in random order.
- A card may use one of the user's own origins or a system origin.
- **Card groups** are folders that keep a user's card library tidy. A card is in at most one group, and cards without one are "ungrouped". A group can mix origins. Deleting a group keeps its cards and moves them to ungrouped.
- **Single cards are never shared.** Card content is shared as a deck or a group (§8).
- **A spell's `dmg` follows its effect.** It is positive for damage effects (`deal_damage`, `damage_section`) and negative for `heal` (the amount healed). Effects that don't use it, like `draw_cards`, take `null` or 0 (stored as `null`). Each spell module declares which of these it uses, and the catalog exposes it.
- `games` stores the seed and the full action log, so any game can be replayed exactly (§7.9). The deck snapshots include the origin with its field effects.
- **A deck has a single origin**, one of the user's own or a system origin. Its cards are the user's own, and have that origin or `neutral`. A neutral deck holds only neutral cards.
  - A stored deck is checked only against hard bounds: 1–4 copies of a card, and at most 60 cards in total. There is no minimum, so an unfinished deck can be saved.
  - The ruleset's `deck` rules (size, `max_copies` within 1–4, `allow_neutral`) are checked when the deck is picked for a room (M6), and on the client for display (F2).
  - **`deck.size` is exact:** a deck needs exactly that many cards to be picked for a room.
  - **`allow_neutral: false`** stops neutral cards from being mixed into a deck of another origin. A neutral deck's cards are its own origin, so a neutral deck still passes.
- **Rulesets** follow the system-origin pattern. The **default ruleset** (`system_key: "default"`, name "Default", no owner) is inserted by a data migration with literal JSON, so every database (the test DB too) has it; `tests/test_rulesets.py` checks it still equals `RulesetDefinition()` and still validates.
  - It is listed first for everyone and is read-only: PATCH, DELETE and share give 403 `system_ruleset_read_only`. Users copy it by `POST`ing its definition under a new name.
  - Names are 1–40 characters and need not be unique, like decks.
  - Nothing protects a ruleset in use: a room copies its ruleset when it is created (M6), so deleting one never breaks a game.
  - `schema_version` is copied from the definition, so rulesets of an old version can be found with SQL.
- **Share codes** live in one `share_codes` table, with one FK column per kind. A code is unique across decks, groups and rulesets, `GET /api/share/{code}` needs one lookup, and deleting the target deletes its code in the database.
  - The codes are 10 characters from the no-look-alike alphabet in `core/codes.py` (about 50 bits), so they can't be guessed.
- **Content in use is protected in the database too**, behind the 409s in §8: `cards.origin_id` and `decks.origin_id` are `RESTRICT`, and `deck_cards.card_id` is a **deferred** FK.
  - Deleting a user is one `DELETE FROM users`, and the cascades remove all their content.
  - `deck_cards.card_id` can't be `RESTRICT`. Postgres deletes a user's cards (a direct cascade) before their `deck_cards` rows (a cascade through `decks`), and an immediate check fails in between. A deferred check runs at COMMIT, after every cascade, and still refuses a card that a deck holds.
  - The origin FKs can stay `RESTRICT`, because cards and decks are direct cascades from `users`, so they are gone before an origin's check runs.
  - Tests never commit, so they bring the deferred check forward with `SET CONSTRAINTS ALL IMMEDIATE`.
- **Forks outlive their source.** An imported copy points only at its own copied origins (or system origins), so the author can delete the original origin, deck or group, or their whole account, and the copy stays as it is. It keeps the author's `art_key`, and the object stays as long as any row references it (§10.3).
- **Art objects** are deleted by a daily sweep once no `cards.art_key` or `origins.background_art_key` references them and they are older than 24 h (§10.3). The `games` deck snapshots (M6, M7) hold art keys but don't keep the objects alive: a card deleted mid-game or replayed later can show the no-art look.

## 5. Module registry

The registry is how the "modular" idea works. Each module is a Python class registered under a key:

```python
@feature("armor")
class Armor(FeatureModule):
    name = "Armor"
    description = "Takes less damage from every hit."
    cost_spec = CostSpec(per_param={"amount": 1})      # cost = base + Σ weight × param

    class Params(ModuleParams):                        # extra="forbid", frozen
        amount: Annotated[int, Field(ge=1, le=5)] = 1

    def on_damaged(self, ctx, creature): ...           # behaviour hooks arrive in M5
```

Each module declares:
- a `key` (given to the decorator), a display name and a description
- a `Params` model (a `ModuleParams` subclass). Its JSON Schema is exported to the frontend.
- features and spell effects: a **declarative cost**, `cost_spec = CostSpec(base, per_param)`. `cost(params)` reads it. The catalog sends the same data, so the frontend computes exactly the same suggestion live.
- spell effects: `dmg_use`, which says how the card's `dmg` is used: `damage` (1–99), `heal` (−99 to −1) or `none` (null)
- phases: `interactive` (true only for `action_phase`). Interactive phases stop the runner and wait for player actions.
- behaviour hooks (see §7.5, M5)

Registration fails at import if a key is a duplicate, if `name`, `description`, `cost_spec` or `dmg_use` is missing, or if a cost weight names something that isn't an int param. `registry.get(FeatureModule, key)` and `registry.validate_params(...)` raise `UnknownModuleError` (`unknown_module`) or `InvalidParamsError` (`invalid_params`). Services turn these into 422 responses. Built-in modules are imported lazily on the first lookup.

**Params schemas must fit `SchemaForm`**, and a test enforces it. Allowed property types:
- int with `ge` and `le`
- number
- bool
- string enum (`Literal`; never `Enum` classes, which produce `$ref`)
- array of enum (`uniqueItems` when values can't repeat)

Every module also uses `extra="forbid"`. Stored params are normalized: they are validated, with defaults filled in.

`GET /api/catalog` returns every module, grouped by kind, with its params JSON Schema and cost information. **The frontend builds its card editor and rules editor forms from this catalog**, so adding a module needs no frontend change.

### Starter module set

These are starting values; costs and bounds can be tuned in the module files.

| Kind | Module | Params (bounds, default) | Cost / extra |
|---|---|---|---|
| phase | `draw` | `count` 1–5 =1 | |
| phase | `gain_mana` (Hearthstone-style: max mana +per_turn up to the cap, then refill), `lane_combat` (automatic, lane by lane), `discard_to_hand_limit`, `end_turn` | — | |
| phase | `action_phase` | `actor` active\|both =active; `allow` 1–3 of play/move/attack, unique, =all; `time_limit_s` 10–600 =90 | interactive |
| feature | `taunt`, `charge` (attacks the turn it is played), `ranged` (can also hit a neighbouring lane), `lifesteal_section` (damage dealt heals your own section) | — | 2 |
| feature | `armor`, `deathrattle_damage` | `amount` 1–5 =1 | 1 × amount |
| feature | `field_affinity` (+bonus DMG and HP on its own field type) | `bonus` 1–2 =1 | 1 × bonus |
| spell | `deal_damage` | `target` enemy_creature\|any_creature | 1, dmg `damage` |
| spell | `damage_section` | — | 2, dmg `damage` |
| spell | `heal` | `target` creature\|section | 1, dmg `heal` |
| spell | `draw_cards` | `count` 1–3 =1 | 2 × count, dmg `none` |
| spell | `buff` | `dmg` 0–5 =1, `hp` 0–5 =1 | dmg + hp, dmg `none` |
| spell | `summon_token` | `hp` 1–5 =1, `dmg` 0–5 =1 | hp + dmg, dmg `none` |
| spell | `move_enemy` | — | 2, dmg `none` |
| field effect | `stat_bonus` | `applies_to` own_origin\|all_own\|enemy; `hp` 0–2, `dmg` 0–2 (a penalty for `enemy`) | |
| field effect | `section_hp_bonus` | `amount` 1–10 =5 | |
| field effect | `free_move` (moving costs no action) | — | |
| field effect | `mana_discount` | `card_kind` creature\|spell =spell; `amount` 1–2 =1 | |
| field effect | `turn_start_heal_section` | `amount` 1–3 =1 | |
| field effect | `spell_power` | `amount` 1–2 =1 | |

Seeded system origins: `neutral` (no effects), `forest` (`stat_bonus` +1 HP to own-origin creatures), `volcano` (`stat_bonus` +1 DMG), `ocean` (`free_move`), `mountain` (`section_hp_bonus` +5).

Field effects have no cost formula. Their strength is limited by bounds on their params (for example `stat_bonus` is at most +2) and by allowing at most 3 effects per origin, with no effect repeated.

## 6. Rules JSON (`RulesetDefinition`)

```json
{
  "schema_version": 1,
  "board":  { "lanes": 3, "slots_per_section": 3, "section_hp": 20 },
  "deck":   { "size": 30, "max_copies": 2, "allow_neutral": true },
  "mana":   { "start": 1, "per_turn": 1, "max": 10 },
  "hand":   { "max_size": 10, "second_player_bonus_card": true },
  "setup":  [ { "key": "draw", "params": { "count": 3 } } ],
  "turn": [
    { "key": "gain_mana", "params": {} },
    { "key": "draw", "params": { "count": 1 } },
    { "key": "action_phase",
      "params": { "actor": "active", "allow": ["play", "move", "attack"], "time_limit_s": 90 } },
    { "key": "end_turn", "params": {} }
  ]
}
```

- **Phases are `{key, params}`**, the same `ModuleRef` shape as card abilities and origin field effects.
- **There is no `hand.start_size`:** the starting hand is whatever the setup phases draw.
- **Every value has a default,** so `RulesetDefinition()` is the default ruleset above, and a missing section or field takes its default. Unknown keys anywhere are rejected.

Bounds (default in brackets):

| Field | Bounds |
|---|---|
| `board` | `lanes` 1–5 [3], `slots_per_section` 1–5 [3], `section_hp` 1–100 [20] |
| `deck` | `size` 10–60 [30], the exact number of cards; `max_copies` 1–4 [2]; `allow_neutral` [true] (§4) |
| `mana` | `start` 0–20 and at most `max` [1], `per_turn` 1–5 [1], `max` 1–20 [10] |
| `hand` | `max_size` 1–15 [10], `second_player_bonus_card` [true] |
| `setup` | 0–5 phases [draw 3] |
| `turn` | 1–12 phases [as above] |

Pipeline rules:
- Every `key` is a registered phase module, and its `params` pass the module's `Params` (for example `action_phase.time_limit_s` is 10–600, default 90). Stored params are normalized, with their defaults filled in.
- `turn` has at least one interactive phase (`action_phase`) and exactly one `end_turn`, which is last. Phases may repeat (two `draw`s are fine).
- `setup` runs once, before the first turn, and waits for no one: no interactive phase and no `end_turn`.
- `schema_version` must be 1, the only version so far. `migrate()` in `schemas/rules.py` is where a version 2 will upgrade stored rulesets; for now it changes nothing.

**Validation** happens on `POST /api/rulesets/validate`, on save, and again when a game starts. One function, `rules_service.validate_definition`, reports **every** problem at once as a `RuleError`:

```json
{ "path": ["turn", 2, "params", "time_limit_s"], "code": "invalid_params", "message": "Input should be less than or equal to 600" }
```

- **`path`** points into the definition: at the value for a single value, at the phase for a phase in the wrong place, and at the list (`["turn"]`) for a rule about a whole pipeline.

| `code` | `path` | When |
|---|---|---|
| `invalid_value` | the value | out of bounds, of the wrong type, or an unknown key (from pydantic) |
| `unknown_module` | `[pipeline, i, "key"]` | not a registered phase |
| `invalid_params` | `[pipeline, i, "params", <param>]` | one error per bad param |
| `setup_phase_not_allowed` | `["setup", i]` | an interactive phase or `end_turn` in setup |
| `turn_needs_interactive_phase` | `["turn"]` | no interactive phase in the turn |
| `end_turn_missing` | `["turn"]` | no `end_turn` |
| `end_turn_repeated` | `["turn", i]` | every `end_turn` but the one kept (the last phase if it is one, else the first) |
| `end_turn_not_last` | `["turn", i]` | the kept `end_turn` isn't the last phase |
| `mana_start_above_max` | `["mana", "start"]` | `mana.start` > `mana.max` |
| `unsupported_schema_version` | `["schema_version"]` | an integer other than 1; it is then the only error, since the rest can't be read |

- A section with shape errors (an `invalid_value` in it) skips its other checks, but the other sections are still checked, so a bad `board.lanes` and a missing `end_turn` show together.
- The pipeline rules look only at phases with a known key, so a typo gives `unknown_module` and maybe the rule it then breaks. A phase with bad params still counts.

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
points              = |dmg| + effect.cost(params)           # spells (null dmg counts as 0)
suggested_mana_cost = max(0, ceil((points - 1) / 2))          # no upper cap; constants can be tuned in cost.py
balance             = 'under' | 'balanced' | 'over'         # mana_cost vs the suggestion; 'balanced' only on an exact match
```
- **The card author always sets the final `mana_cost`.** The server only checks hard bounds: mana 0–10, hp 1–99, creature dmg 0–99, and spell dmg as its effect requires (1–99 for damage, −99 to −1 for heal, `null` otherwise).
- **Only the suggestion has no upper cap.** A card worth more than 10 mana gets a suggestion above 10, so it is labelled `under` even at the maximum cost of 10. The card's own `mana_cost` stays 0–10.
- Card responses include `suggested_mana_cost` and `balance`. **The balance label is shown only in the card library**, as information. The card editor shows only the suggestion. Neither one ever changes or blocks the user's `mana_cost`.
- Game-wide constraints, such as how many cards a deck needs to start a game, are set in the ruleset (`deck.size`, §6), not by the cost formula.
- `POST /api/cards/suggest-cost` returns the suggestion for an unsaved draft. It applies the same kind rules as saving a card. The frontend can also work it out itself from the catalog's `cost` data.
- `tests/fixtures/cost_cases.json` holds the formula cases (`kind, hp, dmg, ability_costs, mana_cost` with the expected points, suggestion and balance). The backend runs them, and the frontend's tests must run the same file.

### 7.9 Hidden information and replays
- `view_for` replaces the opponent's hand and deck with counts, and hides the order of the player's own deck.
- A replay is the ruleset snapshot, both deck snapshots, the seed and the action log. Running them through the engine again gives back every intermediate state.

## 8. REST API

All endpoints except register, login, refresh, logout and health need `Authorization: Bearer <access token>`.

**The refresh token is an HttpOnly cookie**, so page scripts (and an XSS) can't read it:
- Register, login and refresh return only `{access}` in the body, and set the cookie `refresh_token` with `HttpOnly`, `SameSite=Strict`, `Path=/api/auth`, `Max-Age` = `REFRESH_TOKEN_TTL_DAYS`, and `Secure` unless `REFRESH_COOKIE_SECURE=false`. Browsers accept Secure cookies on `http://localhost`.
- `POST /api/auth/refresh` reads only the cookie and sets a new one. Without the cookie it answers 401 `not_authenticated`.
- `POST /api/auth/logout` (204, no access token needed) deletes the cookie. Tokens stay stateless, so it doesn't revoke anything: a token copied earlier stays valid until it expires.
- `SameSite=Strict` keeps other sites from refreshing or logging out with the cookie, so these routes need no CSRF token. The cookie needs the app and `/api` on one origin, as nginx serves them.

The OpenAPI schema is at `/api/openapi.json` and the Swagger UI at `/api/docs` (ReDoc is off), so nginx serves them like any other `/api` request. The frontend generates its types from that schema, so every query parameter must appear in it as a plain parameter. FastAPI lists a query model's fields one by one only when the model is the route's only query parameter, so `GET /api/cards` takes one `CardListQuery` (its filters plus `limit`/`offset`) instead of using the shared `Pagination` next to it. `tests/test_openapi.py` checks that no query parameter is an object.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login` → `{access}` plus the refresh cookie, `POST /api/auth/refresh` (cookie in, `{access}` and a new cookie out), `POST /api/auth/logout` (204, deletes the cookie), `GET /api/auth/me` |
| Catalog | `GET /api/catalog` |
| Origins | `GET /api/origins` (mine plus system origins), `POST /api/origins`, `GET/PATCH/DELETE /api/origins/{id}` (system origins are read-only), `POST /api/uploads/origin-art` (background image) |
| Cards | `GET /api/cards` (mine; filters: origin_id, kind, group or ungrouped), `POST /api/cards`, `GET/PATCH/DELETE /api/cards/{id}`, `POST /api/cards/suggest-cost` |
| Card groups | `GET /api/card-groups` (with card counts and `share_code`), `POST /api/card-groups`, `GET/PATCH/DELETE /api/card-groups/{id}` (delete keeps the cards), `POST /api/card-groups/{id}/share` → `{share_code}`, `DELETE /api/card-groups/{id}/share` (revoke) |
| Uploads | `POST /api/uploads/card-art` and `/api/uploads/origin-art`, body `{content_type, size}` → `{upload_url, art_key, expires_in}` (presigned PUT with the signed Content-Type; png/jpeg/webp, 2 MiB or less) |
| Decks | `GET /api/decks` (summaries: `origin_id`, `card_count`, `share_code`), `POST /api/decks`, `GET/PATCH/DELETE /api/decks/{id}` (with `cards: [{card, count}]`), `POST /api/decks/{id}/share` → `{share_code}`, `DELETE /api/decks/{id}/share` (revoke) |
| Rulesets | `GET /api/rulesets` (the default first, then mine; full `RulesetOut`s), `POST /api/rulesets {name, definition}`, `GET/PATCH/DELETE /api/rulesets/{id}` (the default is read-only), `POST /api/rulesets/validate {definition}` → always 200 `{valid, errors: [RuleError], definition}` (the normalized definition when valid, else null), `POST /api/rulesets/{id}/share` → `{share_code}`, `DELETE /api/rulesets/{id}/share` (revoke) |
| Sharing | `GET /api/share/{code}` (preview), `POST /api/share/{code}/import` → 201. Any logged-in user can use a code, and lower-case input works. An import **forks** a copy into your library, in one transaction (see below). Only decks, card groups and rulesets have share codes: single cards are never shared. |
| Rooms | `POST /api/rooms {ruleset_id}` → `{code}` (6 characters, no look-alike characters), `POST /api/rooms/join {code}`, `GET /api/rooms/{code}` |
| History | `GET /api/games`, `GET /api/games/{id}` (with everything needed for a replay) |
| Health | `GET /api/health` |
| Client logs | `POST /api/client-logs {entries: [...]}` → 204. The browser's warnings and errors, logged as `web.<event>` lines. The access token is optional (it adds the user), and entries over the rate limit are dropped (§10.2). |

**Request ids:** every response carries `X-Request-ID`. The server keeps an incoming one that matches `^[A-Za-z0-9-]{8,64}$` (the browser sends one per request) and otherwise makes its own; every log line of the request carries it (§10.2).

**Unhandled exceptions** answer 500 with `{"detail": {"code": "internal_error", "message": "Something went wrong.", "request_id": "…"}}`, so a user's report can be matched to its log line.

Auth errors (every `401` carries `WWW-Authenticate: Bearer`):

| Status | `code` | When |
|---|---|---|
| 409 | `username_taken` / `email_taken` | duplicate on register, including the DB unique-violation race |
| 401 | `invalid_credentials` | wrong email or password (same body for both) |
| 401 | `not_authenticated` | no `Authorization: Bearer` header, or no refresh cookie on `/refresh` |
| 401 | `token_expired` | valid signature, `exp` in the past (the client should refresh) |
| 401 | `token_invalid` | malformed, bad signature, missing claims, or the user no longer exists |
| 401 | `token_wrong_type` | a refresh token used as access, or the other way round |

**Content in use** (409, each with a `[{id, name}]` list, sorted by name):
- Deleting a card that a deck holds gives `card_in_use` with `decks`. The deferred FK (§4) backs this up at COMMIT, including the race where a deck takes the card during the delete.
- Changing a card's origin so that it no longer fits a deck that holds it also gives `card_in_use`. Neutral always fits.
- Deleting an origin that cards or decks use gives `origin_in_use` with both `cards` and `decks`.

**Sharing:**
- `POST .../share` returns the existing code if there is one, so sharing again gives the same code. `DELETE .../share` removes it (204, even when there is none), and the old link stops working. Sharing again makes a new code.
- Only the owner can share or revoke. Other users get the same 404 as for any other request on the deck, group or ruleset. The default ruleset can't be shared (403 `system_ruleset_read_only`): everyone can already read it.
- **The preview and the import use the current content**, not a snapshot taken when the code was made.
- **Import:**
  - Each custom origin is copied once, however many cards use it. System origins are never copied; the copies use them directly.
  - The cards are copied with the remapped origin, and they **keep the original `art_key`**: the object stays while any row references it (§10.3). The key is checked only when it changes, so editing a copy never needs the author's object.
  - A deck's copied cards go into a new card group named after the deck (no group for an empty deck). A group import makes a new group with the source's name.
  - A taken group name gets the first free ` (n)`, cut to fit 40 characters.
  - A ruleset is copied under the same name (ruleset names need not be unique), owned by the importer, without its share code.
  - Importing your own code works as "duplicate".

```json
// GET /api/share/{code}: discriminated by kind
{ "kind": "deck", "code", "name", "author": "<username>", "origin": OriginOut,
  "cards": [{"card": CardOut, "count"}], "card_count" }
{ "kind": "card_group", "code", "name", "author",
  "origins": [OriginOut],               // every origin the cards use: system first, then by name
  "cards": [{"card": CardOut, "count": 1}], "card_count" }
{ "kind": "ruleset", "code", "name", "author", "definition": RulesetDefinition }

// POST /api/share/{code}/import
{ "kind": "deck", "deck": DeckOut }  |  { "kind": "card_group", "group": CardGroupOut }
  |  { "kind": "ruleset", "ruleset": RulesetOut }
```

`RulesetOut` is `{id, name, definition: RulesetDefinition, is_system, system_key, share_code, created_at, updated_at}`.

**Catalog shape** (`GET /api/catalog`):
```json
{ "phases":        [{"key", "name", "description", "params_schema", "interactive"}],
  "features":      [{"key", "name", "description", "params_schema", "cost": {"base", "per_param"}}],
  "spells":        [{"key", "name", "description", "params_schema", "cost", "dmg_use"}],
  "field_effects": [{"key", "name", "description", "params_schema"}],
  "origin_colors": [{"key": "vermillion", "hex": "#D55E00"}, ...],
  "origin_icons":  ["circle", "leaf", "flame", ...] }
```

**Pagination:** list endpoints take `limit` (1–100, default 50) and `offset` (≥ 0), and return `{items, total}`. Ordering:
- origins: system origins first, then the user's own, each by name
- cards: newest first, filtered by `origin_id`, `kind`, `group_id` or `ungrouped=true` (both group filters at once gives 422)
- card groups: by name
- decks: newest first. The cards inside a deck (and in a share preview) are ordered by mana cost, then name.
- rulesets: the default first, then the user's own, each by name

**PATCH** changes only the fields that are sent. Null clears an optional field (`hp`, `dmg`, `group_id`, `art_key`, `background_art_key`) and is rejected for a required one. A card PATCH re-checks the whole merged card, so turning a creature into a spell also needs `hp: null`.
- A deck PATCH with `cards: [{card_id, count}]` replaces the whole list, the way the builder saves.
- The merged deck is re-checked as a whole, so changing `origin_id` while cards of the old origin remain gives `card_origin_mismatch`. Send the new origin and the new card list together.
- A ruleset PATCH with `definition` replaces the whole definition; sections it leaves out go back to their defaults.

**Ruleset definitions in requests are plain JSON objects.** If FastAPI parsed them into `RulesetDefinition`, a bad one would get FastAPI's generic 422 body instead of `RuleError`s. Responses carry the typed `RulesetDefinition`, so the generated frontend types still have its shape. Its sections use `default_factory`, which writes no default into the schema, so the model sets `json_schema_serialization_defaults_required`: the response schema marks every section required, and the frontend reads `definition.deck` without a fallback (added in F2). Unlike a deck, a ruleset can't be saved half-finished: an invalid one gives 422 `invalid_ruleset`.

**Errors** can carry extra fields next to `code` and `message` (`AppError(extra=...)`).

Content errors:

| Status | `code` | When |
|---|---|---|
| 404 | `origin_not_found` / `card_not_found` / `group_not_found` / `deck_not_found` / `ruleset_not_found` | missing, or owned by another user (the same answer, so ids can't be probed) |
| 404 | `share_not_found` | an unknown share code, or one that was revoked or whose deck, group or ruleset was deleted |
| 403 | `system_origin_read_only` | PATCH or DELETE on a system origin |
| 403 | `system_ruleset_read_only` | PATCH, DELETE, share or revoke on the default ruleset |
| 422 | `invalid_ruleset` | saving a ruleset definition with problems; the body has `errors: [RuleError]`, the same list `/validate` gives (§6) |
| 409 | `origin_in_use` | deleting an origin that cards or decks use; the body has `cards` and `decks`, each `[{id, name}]` |
| 409 | `card_in_use` | deleting a card that a deck holds, or changing its origin so that it no longer fits one; the body has `decks: [{id, name}]` |
| 409 | `group_name_taken` | a group name the user already has, ignoring case (including the unique-index race) |
| 422 | `unknown_module` / `invalid_params` | a module key not registered for that kind, or params its `Params` model rejects |
| 422 | `invalid_field_effects` | the same field effect twice on an origin |
| 422 | `invalid_stats` | hp/dmg don't fit the kind: a creature without hp or dmg, a spell with hp, or a spell dmg that doesn't match the effect's `dmg_use` |
| 422 | `invalid_abilities` | a repeated ability, or a spell without exactly one effect |
| 422 | `invalid_origin` / `invalid_group` | the card's or deck's origin isn't the user's own or a system origin, or the group isn't the user's |
| 422 | `invalid_deck_cards` | a deck lists a card that isn't the user's (or doesn't exist), or the same card twice |
| 422 | `card_origin_mismatch` | deck cards that are neither of the deck's origin nor neutral; the body has `cards: [{id, name}]` |
| 422 | `deck_too_large` | more than 60 cards in total (a copy count outside 1–4 gets FastAPI's default 422) |
| 422 | `unsupported_art_type` / `art_too_large` | upload request with a type other than png/jpeg/webp, or over `UPLOAD_MAX_BYTES` (nothing is signed) |
| 422 | `invalid_art_key` | a saved art key that isn't under `{card-art\|origin-art}/{user_id}/`, wasn't uploaded, or whose object is too large or of the wrong type (checked with `HEAD`, only when the key changes) |
| 413 | `payload_too_large` | a client-log batch over 64 KiB (`Content-Length`) |
| 500 | `internal_error` | an unhandled exception; the body also has `request_id` |

Malformed bodies and out-of-bounds values (for example `mana_cost` 11) still get FastAPI's default 422 body.

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

The token in the URL never reaches the logs: the access line leaves out query strings, and a filter strips them from uvicorn's handshake lines (§10.2). Moving the token out of the URL (into the first message, or a one-time ticket) is still open for M6.

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
  - `/` goes to the Vite dev server on `http://host.docker.internal:5173` (with WS upgrade for hot reload).
  - nginx is for development only. In production the API serves the built frontend itself (§10.1).
  - There is no `/media/`: card art is served from the R2 public URL.
- `.env.example` lists every variable used in `docker-compose.yml` and `Settings` (done in M0).
- **R2 setup (manual, in the Cloudflare dashboard):** a bucket, an API token with Object Read & Write on it, public access (custom domain or r2.dev) for card art (`R2_PUBLIC_BASE_URL`), and a CORS rule allowing `PUT` and `GET` from the app origin with the `Content-Type` header, for browser uploads. R2 only supports presigned GET/HEAD/PUT/DELETE: there is no presigned POST, so the size can't be capped by the URL and is checked again with a `HEAD` on save.
- `requirements.txt` and the baseline Alembic migration are done (M0). Still to do: `scripts/seed.py`, which creates starter cards and two starter decks. The default ruleset is not its job: a data migration seeds it (M4, §4).

### 10.1 Deployment

Agreed 2026-11-10. Railway, Render Starter and a Hetzner VPS were considered and set aside, to keep hosting at $0 for now. The operational side (the pipeline, env vars, rollbacks, troubleshooting) is in [deployment.md](deployment.md).

| Piece | Service | Notes |
|---|---|---|
| App | **Render**, one free web service, Docker, Frankfurt (`render.yaml`) | The root `Dockerfile` builds the frontend and the API image. The API serves `dist/` (`app/frontend.py`), so the app, `/api` and later `/ws` share one origin, as the refresh cookie needs (§8). No CORS. |
| Postgres | **Neon**, AWS eu-central-1, the **direct** (non-pooled) endpoint | One long-lived process with its own SQLAlchemy pool needs no PgBouncer, and Neon's pooler would break asyncpg's prepared-statement cache. `Settings` turns Neon's `postgresql://…?sslmode=require&channel_binding=require` into `postgresql+asyncpg://…?ssl=require`. |
| Redis | **Upstash**, AWS eu-central-1, `rediss://` | The password is in the URL, so `REDIS_PASSWORD` is optional. `health_check_interval=30` re-checks a connection that sat idle. |
| Art | **R2**, a separate `card-art-prod` bucket, public through r2.dev | r2.dev is rate-limited; switch to a custom domain once there is one (only `R2_PUBLIC_BASE_URL` and the CORS rule change). |

- **Start:** `backend/scripts/start.sh` runs `alembic upgrade head`, then one uvicorn worker with `--proxy-headers --forwarded-allow-ips "*"` (Render terminates TLS). Render's free plan has no pre-deploy step; on a paid plan the migration moves to `preDeployCommand`.
- **Health:** Render polls `GET /api/health/live` every few seconds. It touches no service, so the probes spend no Upstash commands (the free tier has ~500K a month) and let Neon scale to zero. `GET /api/health` stays the full check, for manual and post-deploy checks.
- **Secrets** are entered in the Render dashboard (`sync: false` in `render.yaml`); `JWT_SECRET` is generated by Render. The image holds no `.env` (`.dockerignore`).
- **CI** (`.github/workflows/ci.yml`) runs on pushes and pull requests to `master`:
  - backend: ruff, mypy and pytest against a Postgres service
  - frontend: lint, format, typecheck, Vitest and the build
  - `docker build`

  Render deploys `master` only after the checks pass (`autoDeployTrigger: checksPass`). Playwright e2e stays local.
- **Free-tier limits:**
  - the service sleeps after 15 minutes without traffic (WebSocket messages count as traffic), and the first request then waits up to about a minute
  - in-process room locks and turn timers (§9.3) are lost when it sleeps or redeploys, while room state in Redis survives. M6 has to restore timers from the stored deadline, or the app moves to an always-on plan.

### 10.2 Logging

Agreed and built 2026-11-11. Reading the logs is in [deployment.md](deployment.md); the full design and the event list are in the logging feature's record (sessions/session_2026-11-11_logging.md).

- **One shape for every line:** `ts` (UTC), `level`, `event`, `logger`, then `request_id` and `user_id` during a request, then the event's own fields. Our code logs through `structlog` (`get_logger(__name__)`, loggers under `app.`); uvicorn, Alembic and SQLAlchemy lines go through the same formatter (`core/logging_config.py`).
- **Format and level:** `LOG_FORMAT` is `auto` (coloured lines in a terminal, JSON otherwise), `console` or `json`; Render sets `json`. `LOG_LEVEL` applies to `app.*` only: the root stays at WARNING, so third-party DEBUG output (botocore's has signed headers) never shows.
- **Set up once per process:** at import of `app.main` and in `alembic/env.py`, never in `create_app()` (the tests build an app per test).
- **Events** are named `<area>.<what_happened>` with the details as fields, never formatted into the text.
- **Levels:** DEBUG for detail (off in production); INFO for normal events, including 4xx answers; WARNING for the unexpected but handled; ERROR for bugs and outages, always with the traceback.
- **The access line** (`core/middleware.py`, a plain ASGI middleware): one `http.request` per request, with `method`, `path` (never the query string), `route` (the template), `status`, `duration_ms`, `user_id`, `error_code` and `client_ip`.
  - ERROR for a 5xx, WARNING over 1 s, INFO otherwise.
  - DEBUG below 400 for `/api/health/live`, `/api/client-logs` and everything outside `/api` and `/ws`.
  - uvicorn's own access log is off.
- **Unhandled exceptions:** the middleware answers the JSON 500 (§8) and its access line carries the traceback. Nothing re-raises, so the traceback is printed once. A WebSocket closes with 1011.
- **Service events** are logged only where they add facts the access line lacks:
  - `app.started` and `app.stopped`
  - `auth.registered` and `auth.logged_in`
  - `upload.ticket_issued`, and `upload.art_checked` (DEBUG)
  - `share.created`, `share.revoked`, `share.imported`, `share.code_retry` (DEBUG), and `share.import_step` (DEBUG, one per step with its duration, through `StepTimer`)
  - `health.check_failed` and `client_logs.dropped`
  - the art sweep (§10.3): `art.swept`, `art.deleted`, `art.would_delete` (dry run), `art.sweep_aborted` and `art.delete_failed` (WARNING), `art.sweep_failed` (ERROR), and `art.sweep_skipped` (DEBUG)
- **A caught exception that the request survives** is logged: WARNING when it's unexpected, DEBUG for a normal race.
- **Never logged:** passwords and hashes, tokens, the `Authorization`, `Cookie` and `Set-Cookie` headers, presigned URLs, secrets, emails, request and response bodies, query strings, and traceback locals. A redaction step replaces secret-looking keys at any depth and scrubs JWTs, `token=` values, `X-Amz-*` signatures and `user:pass@` in URLs, also inside tracebacks. The engine runs with `hide_parameters=True`.
- **The engine never logs** (`tests/engine/test_no_logging.py`); the services that run it log its outcomes.
- **Background tasks** start with an empty log context (`asyncio.create_task(..., context=contextvars.Context())`), and log their own exception at ERROR. M6's tasks bind their own `room_code` and `game_id`, and run through a wrapper that does this. The art sweep's loop (§10.3), the first background task, logs its failures itself.
- **WebSocket events (M6):** a socket lasts a whole game, so it logs per message: `ws.connected`, `ws.closed` (duration, close code), `game.started`, `game.ended`, `game.action_rejected` (INFO, with the reason), `game.action_applied` (DEBUG), `timer.expired` and `ws.resync`, each with `room_code` and `game_id`.
- **Browser logs:** `POST /api/client-logs` (§8) writes each entry on `app.client` as `web.<event>`, with `source="web"`, the page, the browser's time, its `context` and `breadcrumbs` nested, and the user from a valid token (decoded only, no database query). The limit is kept in process (one worker): 60 entries a minute per user or IP, and 600 overall.

### 10.3 Art cleanup

Agreed and built 2026-11-11. Running it and troubleshooting are in [deployment.md](deployment.md).

Art used to be kept forever. Orphans come from deleted cards and origins, art that is replaced or cleared, deleted accounts (an SQL cascade that no app code sees), and abandoned uploads (each file pick uploads at once, so a replaced pick or a closed editor leaves an object no row ever pointed to). Imported copies share the author's key (§4), so only a look at every row can tell an object is unused.

- **One daily sweep** (`art_cleanup_service.sweep`) covers every kind of orphan. Nothing is deleted inline when a card or origin goes.
  1. List the objects under `card-art/` and `origin-art/`, page by page. Only keys with the full art-key shape (`upload_service.is_art_key`) count, so nothing else in the bucket is touched.
  2. Skip objects whose `LastModified` is newer than the grace period (`ART_SWEEP_GRACE_H`, 24 h). Their card or origin may not be saved yet.
  3. Read every non-null `cards.art_key` and `origins.background_art_key`, from every user. This happens **after** the listing, so an import that commits while the listing runs is still seen.
  4. If more objects are old and unused than `ART_SWEEP_MAX_DELETES` (200), delete nothing and log `art.sweep_aborted`. A database paired with the wrong bucket would see every object as unused.
  5. Otherwise delete each one with a single `DeleteObject`, since the multi-delete call needs a request checksum. A failed delete is logged, and the next sweep retries it.
- **`referenced_art_keys`** is the one list of art-key columns. A new column that holds an art key must be added there. Game snapshots are left out on purpose.
- **In the app:** with `ART_SWEEP_ENABLED=true` (production only, from `render.yaml`), the lifespan starts one task in an empty log context.
  - It checks 60 s after startup, then hourly.
  - Each check is `SET art_sweep:last_run <now> NX EX <ART_SWEEP_INTERVAL_H>`, and only the check that sets the key sweeps. So the sweep runs at most once a day, across restarts and overlapping deploys.
  - A failure is logged as `art.sweep_failed`, and the loop goes on. The task is cancelled before the clients close.
  - It runs only while Render keeps the service awake, so it adds no Neon wake-ups and one Upstash command per hour awake.
- **By hand:** `python -m scripts.sweep_art`. It is a dry run unless `--delete` is passed. `--grace-hours` and `--max-deletes` override the settings, and `ART_SWEEP_ENABLED` is ignored.
- **Off by default** in development and tests. Production has its own bucket (`card-art-prod`).
- **Known limits:**
  - An import mid-transaction, while the author deletes the source card and the sweep reads the references in that same moment, leaves the copy without art. The owner can upload it again.
  - An editor left open more than 24 h after a pick gets `invalid_art_key` on Save.
  - Game snapshots don't keep art alive (§4). The board and replays (F5, F6) fall back to the no-art look when an image fails to load.

## 11. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Infra: settings, DB session, Alembic, nginx conf, `/api/health` | `docker compose up` works, and the health check through nginx returns 200 (Postgres, Redis and R2 reachable) |
| M1 | Auth | register, login, refresh and `me` work; protected routes return 401 without a token |
| M2 | Module registry, catalog, origins, cards, card groups, art upload | origins, cards and card groups CRUD work; system origins are seeded; `catalog` lists the modules (including field effects) with their JSON Schemas; images upload to R2 through a presigned URL and are visible at the bucket's public URL |
| M3 | Decks, share and import (decks and card groups) | deck rules are checked; cards and origins in use are protected; a deck or group share code can be previewed, revoked and imported as a forked copy |
| M4 | Rulesets, validation, share and import | `/validate` returns errors per field; the default ruleset is seeded |
| M5 | Engine core | the full starter module set works; golden replay tests pass |
| M6 | Rooms, WebSocket, Redis persistence, timers, reconnect | two WS clients can play a full game to a win |
| M7 | Match history, replay data, polish | `GET /api/games/{id}` can be replayed exactly |

M0–M4 are done (§1).

The frontend milestones (F0–F6) in [frontend_plan.md](frontend_plan.md) are designed to start once the matching backend milestone is done.

Some cross-cutting features were built between milestones, outside this table: deployment (§10.1), logging (§10.2) and art cleanup (§10.3).

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
- **Rate limiting** on auth and upload endpoints (for example `slowapi`). `POST /api/client-logs` already has its own in-process limit (§10.2).

## 14. Resolved questions

1. **Origins:** users create them like cards, from field-effect modules (§4, §5). The seeded system origins are only templates.
2. **Turn timer:** default 90 s. It is set per interactive phase in the rules and is editable (10–600 s).
3. **Lanes:** a rules option, 1–5 lanes with a default of 3 (§6).

## 15. Use case → backend coverage

| Use case (project_description.md) | Backend |
|---|---|
| UC1 Create a card | `POST /api/cards`, `POST /api/uploads/card-art`, `GET /api/catalog` |
| *(new)* Create an origin | `POST /api/origins`, `POST /api/uploads/origin-art`, `GET /api/catalog` (field effects) |
| *(new)* Organise cards into groups | `/api/card-groups`, `group_id` on cards |
| *(new)* Share a card group | `POST /api/card-groups/{id}/share`, `/api/share/{code}` |
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
