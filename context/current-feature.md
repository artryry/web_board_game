# Current feature: M4 — Rulesets, validation, share and import

**Status:** built 2026-11-12 on the `m4-rulesets` branch, with every check passing; not committed yet. The session is in [sessions/session_2026-11-12_m4-rulesets.md](sessions/session_2026-11-12_m4-rulesets.md).
**Plan reference:** [backend_plan.md §4, §6, §8 and §11](backend_plan.md), [coding-standards.md](coding-standards.md)
**Depends on:** M2 (the module registry with the phase modules) and M3 (share codes and imports). Both are done.
**Unblocks:**
- **F2** (deck builder): it was moved after M4, so its validity panel can use real rulesets. Its plan, with what it needs from M4, is in [features/f2-deck-builder.md](features/f2-deck-builder.md).
- **F3** (rules editor), and M6, where rooms copy a ruleset.

Two earlier features still have follow-ups:
- **Art cleanup:** deploy it, then check Render ([sessions/session_2026-11-11_art-cleanup.md](sessions/session_2026-11-11_art-cleanup.md)).
- **Logging:** the e2e run and the checks by hand ([sessions/session_2026-11-11_logging.md](sessions/session_2026-11-11_logging.md)).

## Goal
A logged-in user can:
- create, read, update and delete their own rulesets (turn-flow rules)
- check a ruleset definition with `POST /api/rulesets/validate`, which answers **errors per field**, with a path the rules editor can point at
- use the **default ruleset**, which is seeded for everyone and read-only
- share a ruleset by code, and preview, revoke and import it like decks and groups

Done when (backend_plan §11): **`/validate` returns errors per field, and the default ruleset is seeded.**

## How it works

### The rules JSON (`RulesetDefinition`, `schemas/rules.py`)
```json
{
  "schema_version": 1,
  "board": { "lanes": 3, "slots_per_section": 3, "section_hp": 20 },
  "deck":  { "size": 30, "max_copies": 2, "allow_neutral": true },
  "mana":  { "start": 1, "per_turn": 1, "max": 10 },
  "hand":  { "max_size": 10, "second_player_bonus_card": true },
  "setup": [ { "key": "draw", "params": { "count": 3 } } ],
  "turn": [
    { "key": "gain_mana", "params": {} },
    { "key": "draw", "params": { "count": 1 } },
    { "key": "action_phase",
      "params": { "actor": "active", "allow": ["play", "move", "attack"], "time_limit_s": 90 } },
    { "key": "end_turn", "params": {} }
  ]
}
```

**Changes from the JSON in backend_plan §6:**
- **No `hand.start_size`.** The starting hand is whatever the setup phases draw, so it is set in one place.
- **Phases use `{key, params}`,** the same `ModuleRef` shape as card abilities and origin field effects. The plan's JSON said `module`.

**Every value has a default.** `RulesetDefinition()` *is* the default ruleset, and a test checks that the seeded row equals it.

**Bounds:**

| Field | Bounds | Default |
|---|---|---|
| `board.lanes` | 1–5 | 3 |
| `board.slots_per_section` | 1–5 | 3 |
| `board.section_hp` | 1–100 | 20 |
| `deck.size` | 10–60, **the exact number of cards** a deck needs to be picked for a room | 30 |
| `deck.max_copies` | 1–4 | 2 |
| `deck.allow_neutral` | bool | true |
| `mana.start` | 0–20, at most `mana.max` | 1 |
| `mana.per_turn` | 1–5 | 1 |
| `mana.max` | 1–20 | 10 |
| `hand.max_size` | 1–15 | 10 |
| `hand.second_player_bonus_card` | bool | true |
| `setup` | 0–5 phases | draw 3 |
| `turn` | 1–12 phases | as above |

**Pipeline rules:**
- Every `key` is a registered phase module, and its `params` pass the module's `Params`. Stored params are normalized, with their defaults filled in, as for abilities.
- **`turn`:**
  - at least one interactive phase (`action_phase`)
  - exactly one `end_turn`, which is last
  - a phase may repeat (two `draw`s are fine), unlike abilities
- **`setup`:** only non-interactive phases, and no `end_turn`. Setup runs once, before the first turn, and stops for no one.
- **`schema_version`** must be 1, the only version so far. A `migrate()` hook, a no-op for now, is where a version 2 would upgrade stored rulesets.
- Unknown keys anywhere are rejected (`extra="forbid"`, as in module params).

**The deck rules, as agreed for the room check (M6) and F2's display check:**
- **`size`:** a deck needs exactly `size` cards to be picked for a room. Unfinished decks can still be saved; the hard bounds stay 1–4 copies and at most 60 cards.
- **`allow_neutral: false`** stops neutral cards from being mixed into a deck of another origin. A neutral deck's cards are its own origin, so a neutral deck still passes.

### Validation errors, per field
One validator (`rules_service.validate_definition`) serves the validate endpoint and the saves. Every problem becomes a `RuleError`:
```json
{ "path": ["turn", 2, "params", "time_limit_s"], "code": "invalid_params", "message": "Must be at most 600" }
```
- **`path`** points into the definition. It is the element's path for a single value (`["board", "lanes"]`), and the list's path for a rule about a whole pipeline (`["turn"]`).
- **Codes:**
  - `invalid_value`: a field out of bounds or of the wrong type, from pydantic
  - `unknown_module`
  - `invalid_params`: one error per param, with the param in the path
  - `turn_needs_interactive_phase`
  - `end_turn_missing`, `end_turn_repeated` and `end_turn_not_last`
  - `setup_phase_not_allowed`
  - `mana_start_above_max`
  - `unsupported_schema_version`
- **Every error is reported at once**, not just the first one, so the editor can show them all.
- **Request bodies take the definition as a plain JSON object.** If FastAPI parsed it into `RulesetDefinition`, a bad definition would get FastAPI's generic 422 body instead of `RuleError`s. Responses carry the typed `RulesetDefinition`, so the generated frontend types still have its shape.

### The table
```
rulesets  id UUID PK, owner_id FK users NULL (ON DELETE CASCADE; NULL = system ruleset),
          system_key UNIQUE NULL ('default'; set only on system rulesets),
          name, definition JSONB, schema_version,
          created_at, updated_at (clock_timestamp())
          CHECK (owner_id IS NULL) = (system_key IS NOT NULL)
          INDEX (owner_id)
```
- The same pattern as `origins`. Code finds the default by `system_key`, never by UUID.
- Names are `ContentName` (1–40 characters) and need not be unique, like decks.
- **Nothing protects a ruleset in use:** a room copies its ruleset when it is created (M6), so deleting one never breaks a game.
- `schema_version` is copied from the definition, so old rulesets can be found with SQL when version 2 comes.

**The default ruleset** is inserted by a data migration with literal JSON, like the system origins, so every database (the test DB too) has it.
- It replaces "`scripts/seed.py` creates a default ruleset" in backend_plan §10. The seed script keeps the starter cards and decks.
- It is read-only: PATCH, DELETE and share give 403 `system_ruleset_read_only`. Users copy it to edit, by `POST`ing its definition under a new name.

### Endpoints
| Method and path | Answer |
|---|---|
| `GET /api/rulesets` | `{items, total}`, paginated like every list: the default first, then mine by name. Each item is a full `RulesetOut`; definitions are small, so F2 and F4 need no second request. |
| `POST /api/rulesets {name, definition}` | 201 `RulesetOut`, or 422 `invalid_ruleset` with `errors: [RuleError]` |
| `GET /api/rulesets/{id}` | mine or the default; any other gives 404 `ruleset_not_found` |
| `PATCH /api/rulesets/{id} {name?, definition?}` | `definition` replaces the whole definition; 403 on the default |
| `DELETE /api/rulesets/{id}` | 204; its share code goes with it (cascade); 403 on the default |
| `POST /api/rulesets/validate {definition}` | always 200: `{valid, errors, definition}`. `definition` is the normalized one (defaults filled in) when it is valid, and null otherwise. |
| `POST /api/rulesets/{id}/share` | `{share_code}`: the existing code if there is one; 403 on the default |
| `DELETE /api/rulesets/{id}/share` | 204, even when there is none (the plan listed only POST) |

`RulesetOut` holds `id`, `name`, `definition`, `is_system`, `system_key`, `share_code`, `created_at` and `updated_at`.

### Sharing and import
- **`share_codes` gets a `ruleset_id` column** (FK, `ON DELETE CASCADE`, unique). Its check becomes `num_nonnulls(deck_id, card_group_id, ruleset_id) = 1`.
- **Preview:** `GET /api/share/{code}` gains a third kind:
  ```json
  { "kind": "ruleset", "code", "name", "author", "definition": RulesetDefinition }
  ```
- **Import:** `POST /api/share/{code}/import` answers `{ "kind": "ruleset", "ruleset": RulesetOut }`.
  - It copies the ruleset under the same name, owned by the importer, without its share code.
  - Like decks and groups, it uses the current content, and importing your own code makes a copy.
- `share_service` and its logging (`share.created`, `share.revoked`, `share.imported`) treat `kind="ruleset"` like the other two kinds.

### Layout
- **New files:**
  - `schemas/rules.py`: `RulesetDefinition`, `RuleError` and `migrate()`
  - `schemas/ruleset.py`: create, update, out, validate request and validate result
  - `models/ruleset.py`
  - `services/rules_service.py`: `validate_definition`, the pipeline rules and the error mapping
  - `services/ruleset_service.py`: CRUD and the system ruleset
  - `api/rulesets.py`
  - two migrations: the table plus the `share_codes` column and check, then the default ruleset's seed
- **The engine stays pure.** `RulesetDefinition` lives in `schemas/` (backend_plan §3) and depends only on the registry. M5's runner will receive the validated model.

### Logging
Nothing new. The share events take `kind="ruleset"`, and a rejected save shows on the access line with `error_code=invalid_ruleset`.

## Done when
- [x] **`RulesetDefinition`:**
  - the bounds and the pipeline rules above
  - `RulesetDefinition()` equals the seeded default
  - stored params are normalized
- [x] **`/validate`:** answers 200 with every error, each with a `path` and a `code`. A valid definition comes back normalized.
- [x] **CRUD:**
  - the list: the default first, then mine by name
  - another user's ruleset gives 404
  - the default answers 403 to PATCH, DELETE and share
  - an invalid save gives 422 `invalid_ruleset` with the same errors
- [x] **The default ruleset is seeded** by a migration in every database, the test DB included, and a test checks it still validates.
- [x] **Sharing:**
  - a ruleset can be shared, previewed, revoked and imported as a copy
  - deleting it deletes its code
  - the check constraint allows exactly one target
- [x] **Checks pass:** `pytest`, `ruff check .`, `ruff format --check .`, `mypy app tests`, and `tests/test_openapi.py`, which checks that no query parameter is an object.
- [x] **Checked by hand:** `alembic upgrade head` on the dev DB, then the endpoints through nginx (`/api/docs`).

## Decisions
Confirmed with the user on 2026-11-11:
- **M4 comes before F2,** so F2's validity panel uses real rulesets.
- **`deck.size` is exact:** a deck needs exactly that many cards to be picked for a room. Saving an unfinished deck stays possible.
- **`allow_neutral: false` still allows a neutral deck.** It only stops neutral cards from being mixed into a deck of another origin.
- **The setup phases decide the starting hand.** `hand.start_size` is dropped.
- **The default ruleset is a system ruleset** (`system_key: "default"`, no owner, read-only), seeded by a migration and listed for everyone, like the system origins.

Proposed by this plan, then confirmed with the user on 2026-11-12 (all kept as written; the default ruleset is named "Default"):
- **Phases are `{key, params}`** (`ModuleRef`), not `{module, params}`, so one shape is used for module references everywhere.
- **Every field has a default,** so `RulesetDefinition()` is the default ruleset.
- **Pipeline rules:** setup takes 0–5 non-interactive phases and no `end_turn`; turn takes 1–12 phases. Phases may repeat.
- **New bounds** for the values §6 didn't bound:
  - `mana.start` 0–20, at most `max`
  - `mana.per_turn` 1–5
  - `hand.max_size` 1–15
- **Saves reject invalid rulesets** (422 `invalid_ruleset`), as §6 says ("on save"). Unlike decks, a ruleset can't be saved half-finished.
- **Requests take the definition as a plain JSON object,** so every error has the `RuleError` shape. Responses are typed.
- **`DELETE /api/rulesets/{id}/share`** exists, to match decks and groups.
- **The list returns full definitions,** not summaries.
- **The validate endpoint returns the normalized definition** when it is valid, so the editor can show the filled-in defaults.

Decided while building (2026-11-12), and written into backend_plan §6:
- **Every error at once, across sections.** The checks that need parsed values (modules, pipeline rules, the mana rule) still run on the sections without shape errors, so a bad `board.lanes` and a missing `end_turn` show together. A section with shape errors skips its other checks.
- **Paths:** `unknown_module` → `[pipeline, i, "key"]`; `invalid_params` → `[pipeline, i, "params", <param>]`; a phase in the wrong place (`setup_phase_not_allowed`, `end_turn_repeated`, `end_turn_not_last`) → `[pipeline, i]`; whole-pipeline rules and length bounds → `[pipeline]`; `mana_start_above_max` → `["mana", "start"]`.
- **Which `end_turn` is kept:** the last phase if it is one, else the first. Every other one is `end_turn_repeated`, and a kept one that isn't last is `end_turn_not_last`.
- **The pipeline rules look only at known phases.** A typo gives `unknown_module` (and maybe the rule it then breaks). A phase with bad params still counts.
- **`schema_version`:** an integer other than 1 gives only `unsupported_schema_version`. Other types get pydantic's `invalid_value`.
- **Unknown keys** are `invalid_value`, with the key in the path.
- **`RuleError.code` is a `Literal`,** so the generated TS type is a union of the ten codes.
- **Revoking a share on the default** gives 403 too, like sharing it.
- **`InvalidParamsError` keeps pydantic's errors** (`.errors`), so the validator goes through `registry.validate_params` and still reports one error per param.

## Tasks
Order:
1. the rules schema and its validator
2. the model and the migrations
3. the service and the API
4. sharing
5. tests
6. docs

Each step comes with its tests.

### Rules
- [x] `schemas/rules.py`: `RulesetDefinition` with its sections, the bounds and defaults, `ModuleRef` phases, `schema_version` and `migrate()`.
- [x] `services/rules_service.py`: `validate_definition(raw) -> (RulesetDefinition | None, list[RuleError])`.
  - It maps pydantic errors to paths, and `InvalidParamsError` to one error per param.
  - It checks the pipeline rules and the cross-field ones.

### Data
- [x] `models/ruleset.py`, and `ruleset_id` on `ShareCode` with the new check constraint.
- [x] A migration for the table, the column and the check constraint.
- [x] A data migration seeding the default ruleset (literal JSON).

### API
- [x] `schemas/ruleset.py`, `services/ruleset_service.py` and `api/rulesets.py`: the endpoints above, including `/validate` and share/revoke. Register them in `api/router.py`.
- [x] `share_service`:
  - the `ruleset` preview kind and its import
  - share and revoke for rulesets
  - `SharePreview` and `ImportResult` get the third kind
- [x] Error codes `ruleset_not_found`, `system_ruleset_read_only` and `invalid_ruleset` (with `errors`).

### Tests
- [x] **`tests/test_rules_schema.py`:**
  - the defaults equal the seeded JSON
  - each bound
  - unknown keys
  - `schema_version`
- [x] **`tests/test_rules_validation.py`:** each error code, with its `path`, and several errors at once.
  - `end_turn` missing, repeated and not last
  - no interactive phase
  - an interactive phase in setup
  - an unknown module
  - a bad param, with its path into `params`
  - `mana.start` above `max`
  - repeated phases are accepted
- [x] **`tests/test_rulesets.py`:**
  - CRUD and its list order
  - 404 for another user's ruleset
  - 403 on the default
  - 422 `invalid_ruleset`
  - `/validate`, valid and invalid
  - the default seed still validates
  - deleting a user deletes their rulesets
- [x] **`tests/test_share.py`:**
  - share, preview, revoke and import a ruleset
  - importing your own code
  - deleting the ruleset deletes its code
  - the default can't be shared
- [x] **`tests/test_user_deletion.py`:** a user's rulesets and their codes go with the user.

### Docs
- [x] [backend_plan.md](backend_plan.md):
  - §1: M4 is done
  - §3: the new files
  - §4: the `rulesets` table, `share_codes.ruleset_id`, and notes on the default ruleset, `deck.size` and `allow_neutral`
  - §6: the new JSON (`key`, no `start_size`), the bounds, the pipeline rules and the error shape
  - §8: the endpoints, the preview and import shapes, and the error codes
  - §10: `seed.py` no longer seeds the ruleset
  - §11: M4 done
- [x] [frontend_plan.md](frontend_plan.md):
  - §4.3: the settings no longer have a start hand size; the setup pipeline draws it
  - §4.2: the validity panel's rules (exact size, the neutral rule)
- [x] [features/f2-deck-builder.md](features/f2-deck-builder.md): its M4 needs and open questions are now answered.
- [x] Update this file, and write the session file.

## Out of scope
- **Running a ruleset.** The engine and the phase behaviour come in M5. M4 only stores and validates.
- **The rules editor UI:** F3.
- **Checking a deck against a ruleset on the server:** M6 does it when a deck is picked for a room. F2 does it in the browser for display.
- **Migrating stored rulesets to a version 2.** The `migrate()` hook is there, but there is only version 1.
- **Starter cards and decks** (`scripts/seed.py`).
- **Rate limits.**

## Notes
- **Already in place:**
  - the phase modules (`engine/modules/phases/`: `draw`, `gain_mana`, `lane_combat`, `discard_to_hand_limit`, `action_phase` and `end_turn`), with their `Params` and `interactive`
  - the catalog lists them
  - `registry.validate_params` raises `UnknownModuleError` or `InvalidParamsError`
- **Patterns to reuse:**
  - from origins: the system rows (`system_key`, the read-only 403, the seed migration with literal data and a test that it still validates)
  - from share: `_get_or_create` and `_revoke` take the target column, so a third column fits
  - `ModuleRef` and `normalize_module_refs` (`services/common.py`)
- **`tests/conftest.py` runs `alembic upgrade head`** on the test DB, so the seed migration is exercised by every test run.

## Open questions
None at the moment.
