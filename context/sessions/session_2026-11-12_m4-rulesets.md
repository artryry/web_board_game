# Session 2026-11-12: M4 rulesets (rules JSON, validation, share and import)

## Summary
We built backend M4 on the `m4-rulesets` branch. Nothing is committed yet.
- **Before:** there were no rulesets. The phase modules and the registry existed (M2), but nothing stored or checked turn-flow rules.
- **Now:**
  - A logged-in user can create, read, update and delete their own rulesets under `/api/rulesets`.
  - `POST /api/rulesets/validate` answers 200 with **every** problem at once, each a `RuleError` with a `path` into the definition and one of ten codes. A valid definition comes back normalized.
  - Saving an invalid ruleset gives 422 `invalid_ruleset` with the same errors.
  - The **default ruleset** ("Default", `system_key: "default"`) is seeded by a migration, listed first for everyone, and read-only (403 `system_ruleset_read_only`).
  - Rulesets can be shared, previewed, revoked and imported as a copy, like decks and groups.
- **F2 (deck builder) is unblocked.**

## How it went
1. **Plan.** The user asked for an implementation plan of current-feature.md. Three explore passes covered the origin and share patterns, the registry and errors, and the tests and conventions.
   - Two questions: the user kept every decision marked "proposed" in current-feature.md (invalid saves are rejected, no half-finished rulesets), and named the default ruleset "Default".
   - The plan settled the details the spec left open (paths, which `end_turn` is kept, schema version types). They are in current-feature.md under "Decided while building".
2. **Rules:** `schemas/rules.py` and `services/rules_service.py`, plus `InvalidParamsError.errors` in the registry. 72 tests (with the registry tests) passed before moving on.
3. **Data:** `models/ruleset.py`, `ShareCode.ruleset_id`, and two migrations. Autogenerate doesn't compare check constraints, so the `share_codes` check was rewritten by hand.
4. **API and sharing:** `schemas/ruleset.py`, `services/ruleset_service.py`, `api/rulesets.py`, and the third kind in `share_service` and `schemas/share.py`.
5. **Tests:** `test_rulesets.py`, plus ruleset cases in `test_share.py` and `test_user_deletion.py`.
6. **Checks:** ruff, format, mypy, the full pytest run, migrations on the dev DB, and every endpoint by hand through nginx.
7. **Docs:** backend_plan, frontend_plan, f2-deck-builder.md and current-feature.md.

## Decisions made
| Topic | Decision |
|---|---|
| Proposed decisions | All kept as written (confirmed by the user): `{key, params}` phases, a default for every field, setup 0–5 and turn 1–12 phases, the new mana and hand bounds, invalid saves rejected, plain-object request bodies, `DELETE .../share`, full definitions in the list, the normalized definition from `/validate`. |
| Default ruleset name | "Default" (confirmed by the user). |
| Every error at once | The checks that need parsed values run on every section without shape errors: the definition is parsed again with the broken top-level keys dropped. So a bound and a pipeline rule show together. |
| Paths | `unknown_module` → `[pipeline, i, "key"]`; `invalid_params` → `[pipeline, i, "params", <param>]`; a phase in the wrong place → `[pipeline, i]`; whole-pipeline rules → `[pipeline]`; `mana_start_above_max` → `["mana", "start"]`. |
| `end_turn` | The kept one is the last phase if it is an `end_turn`, else the first. The others are `end_turn_repeated`; a kept one that isn't last is `end_turn_not_last`. |
| Unknown phases | The pipeline rules look only at known phases. A phase with bad params still counts. |
| `schema_version` | An integer other than 1 gives only `unsupported_schema_version`. Other types are pydantic's `invalid_value` (pydantic accepts `true` and `1.0` as 1). |
| Error codes in the schema | `RuleError.code` is a `Literal`, so the generated TS type is a union. |
| Registry | `InvalidParamsError` keeps pydantic's structured errors, so the validator reuses `registry.validate_params`. |
| List | `GET /api/rulesets` is paginated like every list. |
| Revoke on the default | 403, like share. |
| §11 | The milestone table has no status column, so a line under it says M0–M4 are done (§1 lists them). |

## Files changed
- **New:**
  - `backend/app/schemas/rules.py`: `BoardRules`, `DeckRules`, `ManaRules`, `HandRules`, the pipelines, `RulesetDefinition`, `RuleError` and `migrate()`
  - `backend/app/schemas/ruleset.py`: create, update, out, validate request and result
  - `backend/app/services/rules_service.py`: `validate_definition`
  - `backend/app/services/ruleset_service.py`: CRUD, `get_own_ruleset` (403 on the default), `ruleset_out`
  - `backend/app/models/ruleset.py`
  - `backend/app/api/rulesets.py`
  - `backend/alembic/versions/b4b30db144a1_add_rulesets.py` and `055b2bf99518_seed_default_ruleset.py`
  - `backend/tests/test_rules_schema.py`, `test_rules_validation.py` and `test_rulesets.py`
  - this file
- **Backend:**
  - `app/engine/registry.py`: `InvalidParamsError.errors`
  - `app/models/share_code.py`: `ruleset_id` and the three-column check
  - `app/models/__init__.py`: `Ruleset`
  - `app/schemas/share.py`: `RulesetPreview` and `RulesetImported` in the unions
  - `app/services/share_service.py`: `share_ruleset`, `revoke_ruleset`, the ruleset preview and import, and the `share_not_found` message
  - `app/api/router.py`: the rulesets router
- **Tests:**
  - `tests/helpers.py`: `default_ruleset_id` and `create_ruleset`
  - `tests/engine/test_registry.py`: one error per param
  - `tests/test_share.py`: ruleset share, revoke, preview, import, logging, the default can't be shared, and the one-target check
  - `tests/test_user_deletion.py`: a user's rulesets and codes go; the default stays
- **Docs:** `context/backend_plan.md` (§1, §3, §4, §6, §8, §10, §11), `context/frontend_plan.md` (§4.2, §4.3), `context/features/f2-deck-builder.md` and `context/current-feature.md`

## Verification
- `ruff check .`, `ruff format --check .` and `mypy app tests`: pass.
- `pytest`: 564 passed (88 new). This includes `test_openapi.py` and `test_migrations.py`, which downgrades to base and back.
- `alembic check`: no differences between the models and the migrations.
- **The dev DB:** `alembic upgrade head`, then down to `0ea15a74de55` and up again. The default ruleset is there, and the check is `num_nonnulls(deck_id, card_group_id, ruleset_id) = 1`.
- **By hand through nginx** (`http://localhost/api`), with two throwaway users:
  - the list showed only "Default"; a broken definition gave 7 errors with paths from `/validate`, and 422 `invalid_ruleset` on save
  - copying the default, PATCH, and 403 on PATCH, DELETE and share of the default
  - the other user got 404, then previewed and imported a shared copy (no share code on the copy)
  - deleting the ruleset made its code 404
  - the access line had `error_code=invalid_ruleset`, and `share.imported` had `kind=ruleset`
  - `/api/docs` answers 200, and the OpenAPI lists the four ruleset paths and the ten codes
- The two users were deleted afterwards, and the uvicorn started for the check was stopped.
- **Not verified:** the frontend (nothing changed there; `schema.d.ts` is regenerated in F2) and anything on Render.

## Notes
- **The uncommitted `.github/workflows/ci.yml` change** from before this session adds trailing spaces on its blank lines and after "Run format checks". This session didn't touch it.
- **The docker stack** was already running and is still running.

## Next steps
1. Review, commit and merge `m4-rulesets`. The two migrations run on deploy (`scripts/start.sh`).
2. F2: `npm run gen:api` first, then the plan in [current-feature.md](../current-feature.md) (it was `features/f2-deck-builder.md`).
3. Leftovers from earlier sessions: the art cleanup check on Render ([session_2026-11-11_art-cleanup.md](session_2026-11-11_art-cleanup.md)) and the logging e2e run ([session_2026-11-11_logging.md](session_2026-11-11_logging.md)).
