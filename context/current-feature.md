# Current feature: M2 — Module registry, catalog, origins, cards, card groups and art upload

**Status:** not started
**Plan reference:** [backend_plan.md §3 (layout), §4 (`origins`, `cards`, `card_groups`), §5 (module registry), §7.8 (cost suggestion), §8 (REST API), §10 (R2 setup) and §11 (M2)](backend_plan.md)
**Previous milestone:** M1 (Auth) is done. See [sessions/session_2026-10-31.md](sessions/session_2026-10-31.md).
**Unblocks:** F1 in [frontend_plan.md](frontend_plan.md) (catalog + `SchemaForm`, origin editor, card editor with cost suggestion, card library with groups and balance labels, art upload).

## Goal
Users can create the content of their game:
- **origins** (field types) built from field-effect modules
- **creature and spell cards** built from feature and spell modules, with art uploaded to R2
- **card groups** that keep their card library organised

The **module registry** is the core of the "modular" idea. Every module declares a key, a `Params` model and its cost. `GET /api/catalog` publishes them as JSON Schema, so the frontend builds its forms without hard-coding any module. Modules only describe themselves in M2. Their behaviour hooks come in M5.

## Done when
- `GET /api/catalog` returns every starter module from backend_plan §5, grouped by kind (phases, features, spells, field effects). Each module has its key, name, description and params JSON Schema, plus cost info for features and spells.
- The system origins `neutral`, `forest`, `volcano`, `ocean` and `mountain` exist after `alembic upgrade head`. Every user can see them, and `PATCH`/`DELETE` on them gives 403.
- **Origins CRUD** works for the user's own origins:
  - list (mine plus system), get, create, patch, delete
  - field effects are validated (at most 3, known keys, valid params)
  - deleting an origin that cards use gives 409 with the list of those cards
- **Cards CRUD** works:
  - list (mine, filtered by `origin_id`, `kind` and group, paginated), get, create, patch, delete
  - validation depends on the kind
  - responses include `suggested_mana_cost` and `balance` (`under`/`balanced`/`over`, shown in the card library). Both are information only: the user always sets the final `mana_cost`, and a card is never rejected because of them.
  - `POST /api/cards/suggest-cost` returns the suggestion for an unsaved draft
- **Card groups** work: create, list (with card counts), rename, delete.
  - a card is in at most one group
  - cards can be listed by group, including "ungrouped"
  - deleting a group moves its cards to ungrouped, and keeps the cards
- Another user's origins, cards and groups give 404 and can't be changed.
- `POST /api/uploads/card-art` and `/api/uploads/origin-art` return a presigned `PUT` URL and an `art_key`. A real upload with that URL works, and the image loads from the bucket's public URL. A wrong type or a size over 2 MB is rejected before anything is signed.
- Migrations run up and down cleanly. `pytest`, `ruff check`, `ruff format --check` and `mypy app tests` pass, with mypy strict on `app/engine`.

## Manual setup (Cloudflare dashboard, needed before the upload tasks)
- [ ] **Public access** on the bucket, through a custom domain or the r2.dev subdomain. Its URL becomes `R2_PUBLIC_BASE_URL`.
- [ ] **A CORS rule** on the bucket allowing `PUT` and `GET` from `http://localhost`, with the `Content-Type` header.

## Tasks
Suggested order: registry → catalog → origins → cards (with cost) → card groups → uploads. Each step can be merged on its own.

### Module registry (`app/engine`, pure, mypy strict)
- [ ] `engine/registry.py`:
  - `ModuleKind` (`phase`, `feature`, `spell`, `field_effect`)
  - base classes with `key`, `name`, `description` and a `Params` Pydantic model
  - registration decorators `@phase`, `@feature`, `@spell` and `@field_effect`; a duplicate key fails at import
  - lookup and `validate_params(kind, key, params)`, which raises specific errors (`unknown_module`, `invalid_params`)
  - phases also declare `interactive` (true for `action_phase`), because the rules editor (F3) and validation (M4) need it
  - spell modules declare how they use the card's `dmg`: `damage` (1–99), `heal` (−99 to −1) or `none` (`null` or 0). The catalog exposes it, so the card editor knows whether and how to show DMG.
- [ ] `engine/modules/<kind>/`: one class for every starter module in backend_plan §5:
  - each has bounded `Params` (for example `stat_bonus` at most +2, and `action_phase.time_limit_s` 10–600 with a default of 90)
  - features and spells also have a cost
  - no behaviour hooks yet (M5)
- [ ] `engine/cost.py`:
  - `suggest_mana_cost` (backend_plan §7.8). Spells count `|dmg|`, so healing costs the same as damage, and the result is clamped to 0–10.
  - `balance(mana_cost, suggested)`: `balanced` only on an exact match, otherwise `under` (cheaper than suggested) or `over`
- [ ] Engine tests:
  - the registry (duplicate key, unknown key, invalid params)
  - every module's params bounds and cost
  - the cost formula and `balance`, as a table of cases the frontend can reuse

### Catalog
- [ ] `schemas/catalog.py`, `services/catalog_service.py` (built once from the registry) and `api/catalog.py` with `GET /api/catalog` (login required).
- [ ] The catalog also lists the allowed origin **colours and icons** (a fixed, colour-blind-safe set), so the backend validates them and the frontend never hard-codes them.

### Origins
- [ ] `models/origin.py` with `origins`:
  - columns as in backend_plan §4
  - `owner_id` is a FK to `users` (NULL for system origins)
  - a `system_key` column (see decisions)
  - `updated_at`
- [ ] Migration for the table, plus a data migration that inserts the five system origins.
- [ ] `schemas/origin.py`:
  - `OriginCreate`, `OriginUpdate` (partial) and `OriginOut` (with `is_system` and `background_art_url`)
  - `field_effects` is a list of `{key, params}` validated through the registry before it's written
- [ ] `services/origin_service.py`:
  - list, get, create, update and delete, with ownership checks
  - system origins are read-only (403 `system_origin_read_only`)
  - deleting an origin in use gives 409 `origin_in_use` with the cards that use it
- [ ] `api/origins.py`: `GET/POST /api/origins`, `GET/PATCH/DELETE /api/origins/{id}`.

### Cards
- [ ] `models/card.py` with `cards`:
  - columns as in backend_plan §4
  - FK to `origins` with `ON DELETE RESTRICT` (the service answers with 409 before that is hit)
  - an index on `(owner_id, origin_id)`
- [ ] Migration.
- [ ] `schemas/card.py`:
  - `CardCreate`, `CardUpdate` (partial) and `CardOut` (with `suggested_mana_cost`, `balance`, `group_id` and `art_url`)
  - `SuggestCostRequest` / `SuggestCostResponse`. The response has only `suggested_mana_cost`, because the editor shows no balance label.
- [ ] `services/card_service.py`:
  - hard bounds: mana 0–10 and hp 1–99
  - a **creature** needs `hp` and `dmg` (0–99), and has 0–2 abilities from the feature modules, with no duplicates
  - a **spell** has no `hp` and exactly one ability from the spell modules, and its `dmg` must match that effect's `dmg` use. `null` and 0 are both accepted for `none` and stored as `null`.
  - the origin must be the user's own or a system origin
  - `PATCH` validates the merged card, so changing `kind` re-checks everything
  - `mana_cost` is saved exactly as the user sets it
- [ ] `api/cards.py`: `GET/POST /api/cards`, `GET/PATCH/DELETE /api/cards/{id}`, and `POST /api/cards/suggest-cost`.

### Card groups
- [ ] `models/card_group.py` with `card_groups`:
  - `id`, `owner_id` (FK to `users`), `name`, `created_at`, `updated_at`
  - `name` is 1–40 characters and unique per owner, ignoring case
- [ ] `cards.group_id`: a nullable FK to `card_groups` with `ON DELETE SET NULL`, so deleting a group moves its cards to ungrouped.
- [ ] Migration.
- [ ] `schemas/card_group.py`: `CardGroupCreate`, `CardGroupUpdate` and `CardGroupOut` (with `card_count`).
- [ ] `services/card_group_service.py`:
  - list, get, create, rename and delete, with ownership checks
  - a duplicate name gives 409 `group_name_taken`
- [ ] `api/card_groups.py`: `GET/POST /api/card-groups`, `GET/PATCH/DELETE /api/card-groups/{id}`.
- [ ] Cards: `group_id` on create and patch must be one of the user's own groups, or `null`. `GET /api/cards` filters by group, including ungrouped.

### Art upload
- [ ] Settings and `.env.example`: `R2_PUBLIC_BASE_URL`, `UPLOAD_MAX_BYTES` (2 MB) and `UPLOAD_URL_TTL_S` (300).
- [ ] `storage/client.py`:
  - object keys `card-art/{user_id}/{uuid}.{ext}` and `origin-art/{user_id}/{uuid}.{ext}`
  - a presigned `PUT` with the signed `Content-Type`
  - `head_object` for verification
  - `public_url(key)`
- [ ] `services/upload_service.py` and `api/uploads.py`:
  - the body is `{content_type, size}`
  - png, jpeg or webp only, and at most 2 MB
  - the response is `{upload_url, art_key, expires_in}`
- [ ] **Check on save:** when a card or origin is saved with an art key, the key must sit under the user's prefix, and a `HEAD` must show the object exists, is at most 2 MB and has an allowed type. Otherwise the save fails with 422 `invalid_art_key`.

### Tests
- [ ] One file per router: `test_catalog.py`, `test_origins.py`, `test_cards.py`, `test_card_groups.py` and `test_uploads.py`. `get_s3` is overridden with a fake S3 client, as in `test_health.py`, so tests never call R2.
- [ ] Ownership: user B can't see, change or delete user A's origins, cards or groups, can't put a card into user A's group, and can't attach user A's art keys.
- [ ] The system origins are present in the test DB, because they come from a migration.

### Docs
- [ ] [backend_plan.md](backend_plan.md):
  - §1 current state
  - §4 `system_key`, and that `is_public` is deferred
  - §5 declarative costs and the spell modules' `dmg` use
  - §8 the catalog shape and the pagination shape
- [ ] [frontend_plan.md](frontend_plan.md), if the catalog shape affects `SchemaForm` or `CostSuggestion`.
- [ ] Record decisions below, and write a session file.

## Out of scope (later milestones)
- Module behaviour hooks and running modules in a game (M5)
- Decks, `deck_cards` and the "card used in a deck" 409 (M3)
- Sharing and importing decks and card groups (M3). Single cards are never shared.
- Rulesets and `/rulesets/validate` (M4). Phase modules are only listed in the catalog for now.
- The `is_public` columns and any public gallery (added with sharing in M3 or later)
- Deleting art objects from R2, cleaning up orphaned uploads, image dimension checks and moderation (backend_plan §13)
- Rate limiting on uploads
- `scripts/seed.py` with starter cards, decks and the default ruleset (M3/M4)
- Frontend work (F1)

## Notes and decisions
- **Carried over from M1:**
  - every route except register and login takes `CurrentUser`
  - ids are UUIDs
  - errors use `{"detail": {"code", "message"}}`, and 422 keeps FastAPI's default body
  - the test DB is created if missing and migrated on every run
- **The cost is only a suggestion.** The user always sets the final `mana_cost`. The server never changes or rejects a card because of the suggestion or the balance label. It only checks the hard bounds.
- **Balance labels appear only in the card library** (decided 2026-10-31). `balance` is `balanced` only when `mana_cost` equals the suggestion. The card editor shows the suggestion and a "Use suggested" button, with no label. Game-wide limits, such as how many cards a deck needs to start a game, belong to the ruleset (`deck.size`, backend_plan §6, built in M4).
- **A spell's `dmg` follows its effect** (decided 2026-10-31): positive for damage, negative for `heal`, and `null` or 0 for effects that don't use it, like `draw_cards`. The suggestion counts `|dmg|`, so healing 3 costs the same as dealing 3 (confirmed 2026-10-31).
- **Spells and creatures share the `abilities` column.** A creature has 0–2 features. A spell has exactly one spell effect. The service validates it by kind.
- **Card groups are folders** (decided 2026-10-31). They keep a user's library tidy. A card is in at most one group, and cards without a group are "ungrouped". A group can mix origins. Deleting a group keeps its cards.
- **Sharing, for M3** (decided 2026-10-31): card content is shared only as a **deck** or a **group**, never as a single card. Importing a group forks its cards and their custom origins (not system origins) into a new group in the importer's library. Rulesets stay shareable as before (UC9, confirmed 2026-11-01).
- **Deck rule, confirmed for M3:** a deck has exactly one origin, and it may contain only cards of that origin or neutral cards. This is why M2 needs a stable way to find `neutral` (see `system_key` below). The ruleset option `allow_neutral` (backend_plan §6) can still forbid neutral cards in a room.
- **Ownership:** another user's origin, card or group gives **404** (not 403), so a request doesn't reveal that an id exists. System origins can be read by everyone, and changing them gives 403.
- **JSONB columns** (`field_effects`, `abilities`) are always validated through the registry's `Params` models before they are written (coding-standards §2).
- **Art objects are never deleted in M2.** M3 imports fork cards and may share the original's `art_key`, so deleting an object could break someone else's copy. Cleanup is future work.
- **Size limits are checked twice,** when the URL is requested and with a `HEAD` on save, because a presigned `PUT` URL can't reliably enforce a maximum size. R2 doesn't support the presigned POST policies (`content-length-range`) that S3 has; confirm this against the R2 docs while planning.
- **Duplicating a system origin** (the frontend's "template" button) needs no endpoint. The client reads the template and `POST`s a copy.
- **Proposed: declarative costs.** Each feature and spell declares its cost as data (a base value plus a weight per param) instead of a Python function. The catalog sends that data, so the frontend computes exactly the same suggestion live (frontend_plan §4.1). Backend_plan §5 describes `cost(params) -> int`; that becomes a method that reads the data.
- **Proposed: system origins** get a nullable unique `system_key` (`neutral`, `forest`, …) and are inserted by a data migration. Every DB, including the test DB, then has them, and M3 can find `neutral` without a hard-coded UUID.
- **Proposed: pagination.** List endpoints take `limit` (default 50, max 100) and `offset`, and return `{items, total}`.

## Open questions
- **From M1: should refresh tokens be revocable** (logout, "log out everywhere")? That needs a `jti` allowlist in Redis. Revisit before the frontend auth pages (F0), which include logout.
