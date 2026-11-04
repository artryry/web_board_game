# Current feature: M2 — Module registry, catalog, origins, cards, card groups and art upload

**Status:** done (2026-11-01), except one manual step: the R2 bucket's CORS rule (see "Manual setup"). See [sessions/session_2026-11-01.md](sessions/session_2026-11-01.md).
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
- [x] `GET /api/catalog` returns every starter module from backend_plan §5, grouped by kind (phases, features, spells, field effects). Each module has its key, name, description and params JSON Schema, plus cost info for features and spells.
- [x] The system origins `neutral`, `forest`, `volcano`, `ocean` and `mountain` exist after `alembic upgrade head`. Every user can see them, and `PATCH`/`DELETE` on them gives 403.
- [x] **Origins CRUD** works for the user's own origins:
  - list (mine plus system), get, create, patch, delete
  - field effects are validated (at most 3, known keys, valid params)
  - deleting an origin that cards use gives 409 with the list of those cards
- [x] **Cards CRUD** works:
  - list (mine, filtered by `origin_id`, `kind` and group, paginated), get, create, patch, delete
  - validation depends on the kind
  - responses include `suggested_mana_cost` and `balance` (`under`/`balanced`/`over`, shown in the card library). Both are information only: the user always sets the final `mana_cost`, and a card is never rejected because of them.
  - `POST /api/cards/suggest-cost` returns the suggestion for an unsaved draft
- [x] **Card groups** work: create, list (with card counts), rename, delete.
  - a card is in at most one group
  - cards can be listed by group, including "ungrouped"
  - deleting a group moves its cards to ungrouped, and keeps the cards
- [x] Another user's origins, cards and groups give 404 and can't be changed.
- [x] `POST /api/uploads/card-art` and `/api/uploads/origin-art` return a presigned `PUT` URL and an `art_key`. A real upload with that URL works, and the image loads from the bucket's public URL. A wrong type or a size over 2 MB is rejected before anything is signed.
- [x] Migrations run up and down cleanly. `pytest`, `ruff check`, `ruff format --check` and `mypy app tests` pass, with mypy strict on `app/engine`.

## Manual setup (Cloudflare dashboard)
- [x] **Public access** on the bucket, through a custom domain or the r2.dev subdomain. Its URL becomes `R2_PUBLIC_BASE_URL`. Verified: an uploaded image loads from the r2.dev URL.
- [ ] **A CORS rule** on the bucket allowing `PUT` and `GET` from `http://localhost`, with the `Content-Type` header. **Still missing:** a preflight (`OPTIONS` with `Origin: http://localhost`) to a presigned URL got 403 with no `Access-Control-Allow-Origin`. Server-side and curl uploads work, but browser uploads (F1) will fail until the rule exists. The API token can't read bucket CORS settings, so check it in the dashboard:
  ```json
  [{ "AllowedOrigins": ["http://localhost"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3600 }]
  ```

## Tasks
Order followed: registry → catalog → shared plumbing → origins → cards → card groups → uploads (written before the card and origin services, so they were written once with art keys).

### Module registry (`app/engine`, pure, mypy strict)
- [x] `engine/registry.py`: `ModuleKind`, `DmgUse`, `ModuleParams`, `CostSpec`, `ModuleRef`, base classes, `ModuleRegistry` (typed `get`/`all`/`validate_params`, lazy loading of built-ins) and the `@phase`/`@feature`/`@spell`/`@field_effect` decorators. A duplicate key or an incomplete module fails at import.
- [x] `engine/modules/<kind>/`: one file for each of the 26 starter modules, with bounded `Params`, declarative costs, `dmg_use` and `interactive`.
- [x] `engine/cost.py`: `card_points`, `suggest_mana_cost` (integer maths, clamped 0–10) and `balance`.
- [x] Engine tests: `tests/engine/test_registry.py`, `test_modules.py` (bounds, costs, dmg use, schema contract) and `test_cost.py` with the shared `tests/fixtures/cost_cases.json`.

### Catalog
- [x] `schemas/catalog.py`, `services/catalog_service.py` (cached) and `api/catalog.py` (login required).
- [x] Origin colours (Okabe–Ito plus grey) and icons in `schemas/origin.py`, listed in the catalog.

### Origins
- [x] `models/origin.py` (`system_key`, check constraint, `TimestampMixin`), plus the table migration and the seed data migration.
- [x] `schemas/origin.py`, `services/origin_service.py`, `api/origins.py`.

### Cards
- [x] `models/card.py` (FK RESTRICT to origins, index `(owner_id, origin_id)`) and its migration.
- [x] `schemas/card.py`, `services/card_service.py` (`validate_content` holds the kind rules), `api/cards.py`.

### Card groups
- [x] `models/card_group.py` (`card_count` as a `column_property`, case-insensitive unique name per owner); the migration also adds `cards.group_id` (`ON DELETE SET NULL`).
- [x] `schemas/card_group.py`, `services/card_group_service.py`, `api/card_groups.py`; `group_id` on cards is checked against the user's own groups.

### Art upload
- [x] Settings and `.env.example`: `R2_PUBLIC_BASE_URL`, `UPLOAD_MAX_BYTES`, `UPLOAD_URL_TTL_S`.
- [x] `storage/client.py`: `ArtKind`, `make_art_key`, `presign_put`, `head_object`, `public_url`; the client signs with SigV4.
- [x] `services/upload_service.py` and `api/uploads.py`.
- [x] Check on save: the key's prefix, then a `HEAD` (exists, size, type), only when the key changes.

### Tests
- [x] `test_catalog.py`, `test_origins.py`, `test_cards.py`, `test_card_groups.py`, `test_uploads.py`, with a `FakeS3` override of `get_s3`.
- [x] Ownership across users, including other users' groups and art keys.
- [x] System origins come from the migration, and a test checks their stored effects still validate.

### Docs
- [x] [backend_plan.md](backend_plan.md) §1, §3, §4, §5, §7.8, §8, §10.
- [x] [frontend_plan.md](frontend_plan.md) §2 (`SchemaForm`), §4.0 (colours and icons), §4.1 (`dmg_use`, `CostSuggestion`, shared cost cases).
- [x] Decisions recorded below; session file written.

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
  - errors use `{"detail": {"code", "message"}}`, and 422 keeps FastAPI's default body for malformed input
  - the test DB is created if missing and migrated on every run
- **The cost is only a suggestion.** The user always sets the final `mana_cost`. The server never changes or rejects a card because of the suggestion or the balance label. It only checks the hard bounds.
- **Balance labels appear only in the card library** (decided 2026-10-31). `balance` is `balanced` only when `mana_cost` equals the suggestion.
- **A spell's `dmg` follows its effect** (decided 2026-10-31): positive for damage, negative for `heal`, and `null` or 0 for effects that don't use it. The suggestion counts `|dmg|`.
- **Spells and creatures share the `abilities` column.** A creature has 0–2 features. A spell has exactly one spell effect.
- **Card groups are folders** (decided 2026-10-31).
- **Sharing, for M3** (decided 2026-10-31): card content is shared only as a deck or a group.
- **Deck rule, confirmed for M3:** a deck has exactly one origin, plus neutral cards (found by `system_key = 'neutral'`).
- **Ownership:** another user's origin, card or group gives **404**. System origins can be read by everyone, and changing them gives 403.
- **Art objects are never deleted in M2.** M3 imports may share the original's `art_key`.
- **Decided in M2 (2026-11-01):**
  - **Declarative costs** (adopted): `CostSpec(base, per_param)` on each feature and spell. The catalog sends it, and the frontend computes the same suggestion.
  - **`system_key`** (adopted): system origins are found by key, inserted by a data migration with literal JSON. A check constraint keeps `owner_id` and `system_key` exclusive.
  - **Pagination** (adopted): `limit` (default 50, max 100) and `offset`, returning `{items, total}`.
  - **Starter module params and costs** are the table in backend_plan §5. They are starting values, to be tuned.
  - **Content-rule errors are `AppError` 422s with specific codes**; schema-level errors keep FastAPI's body. The codes are listed in backend_plan §8.
  - **`AppError(extra=...)`** adds fields to the error body; `origin_in_use` uses it for the card list.
  - **PATCH merges and re-validates** the whole object. Null clears optional fields and is rejected for required ones.
  - **A field effect can't appear twice on one origin**, like abilities on a card.
  - **Content timestamps use `clock_timestamp()`**, so rows created in one transaction still sort by creation time.
  - **Art keys are re-checked only when they change**, so editing a card's name doesn't call R2.
  - **R2 limits confirmed:** presigned URLs support GET/HEAD/PUT/DELETE only (no POST policy). The signed `Content-Type` is enforced: a PUT with another type gets 403 `SignatureDoesNotMatch`.

## Open questions
- **From M1: should refresh tokens be revocable** (logout, "log out everywhere")? That needs a `jti` allowlist in Redis. Revisit before the frontend auth pages (F0), which include logout.
