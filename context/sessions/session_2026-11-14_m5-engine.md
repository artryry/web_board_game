# Session 2026-11-14: M5 engine core

## Summary
We built backend M5 on the `m5-engine` branch. Nothing is committed yet.
- **Before:** the engine had only declarations: the registry and 26 starter modules with params, no behaviour.
- **Now:**
  - **The engine API** in `backend/app/engine/runner.py`: `start_game`, `legal_actions`, `apply_action`, `view_for`, `events_for` and `replay`.
    - It is pure and deterministic: a seed plus the actions give the same game.
    - It plays every starter module through hooks, with no module key in the core.
  - **A new field effect, `attacker_penalty`,** replaces `stat_bonus` with `applies_to: enemy`. A migration converts stored origins.
  - **Full games end:** bot games on 1, 3 and 5 lanes finish, and three golden replays reproduce their final state exactly.
  - **Random games keep the engine's contract:** every legal action is accepted; changed actions are refused exactly when illegal, and leave the state unchanged.
- **M6 (rooms) and F5 (board) are unblocked.**

## How it went
1. **Plan.** The user asked for a plan of current-feature.md, with questions where needed. They answered four rounds of questions and went through every "proposed" decision; four changed (see the table). The plan is in current-feature.md's Decisions.
2. **`attacker_penalty` and the migration** came first, with a migration test that converts a row both ways.
3. **The core:** `seats`, `rng`, `snapshots`, `state`, `actions`, `events`, `context`, `targets`, `combat`, `legality`, `views` and `runner`, plus the hook base classes in `registry.py` and the hooks in every module. mypy strict passed on the first run.
4. **A smoke game** showed two problems:
   - **Too slow:** 18 ms per action, because the full deep copy grew with the action log. `GameState.clone()` copies only what the engine changes in place. Now about 0.8 ms.
   - **Stuck games:** the test bot never moved its creatures out of lanes with nothing left to hit. The bot now moves them.
5. **Tests:** 308 engine tests in 17 files, then the golden fixtures (`UPDATE_GOLDEN=1`).
6. **Self-review:** `CardInstance` and `LoggedAction` became frozen, so what clones share can't be changed in place. The phase-ref lookup moved into `EngineContext`.
7. **Docs:** backend_plan, frontend_plan and current-feature.md. The frontend's catalog test fixture lost `enemy` and gained `attacker_penalty`.

## Decisions made
| Topic | Decision |
|---|---|
| Double loss | Both players losing their last section in one chain is a **draw** (changed from the spec's "the player who acted wins"). |
| `free_move` | A move needs only that the creature hasn't moved this turn: right after it's played, before or after attacking (changed). |
| Enemy penalties | **A new field effect, `attacker_penalty`** (changed): an enemy creature that attacks one of the owner's live sections loses `hp` HP (armor doesn't help) and hits `dmg` softer. It triggers only on attacks at the section itself. `stat_bonus` keeps `own_origin` and `all_own`. |
| `lane_combat` and ranged | The own lane first; if nothing there can be hit, the other attack lanes, lowest first (changed). |
| Everything else proposed | Confirmed as written: seats, SplitMix64, Setup for both seats then the bonus card, both players' creatures refreshed each turn, summoning sickness for tokens, losing a bonus never kills, conquered sections final, both decks as counts, `UPDATE_GOLDEN=1`, fixed-seed random games. |
| Hooks | Instance methods on a module built with its params (`registry.build`). The base `params` is `Any`, so each module's narrower `params: Params` type-checks in mypy and Pylance. |
| Copying | `GameState.clone()` instead of a deep copy: it shares the frozen parts (ruleset, snapshots, cards, log entries). The random-game test checks on every step that the input state is unchanged. |
| Validation | `check_action` names the reason, then requires membership in `legal_actions`. |
| Smaller choices | Deck uids after the shuffle; a token copies the spell's name and art; lifesteal heals the hit after armor; the own hand in the view carries its current cost; `seats.py` added (actions and state both need `Seat`). |

## Files changed
- **New (engine):** `backend/app/engine/` `seats.py`, `rng.py`, `snapshots.py`, `state.py`, `actions.py`, `events.py`, `context.py`, `targets.py`, `combat.py`, `legality.py`, `views.py`, `runner.py`, `modules/field_effects/attacker_penalty.py`
- **New (migration):** `backend/alembic/versions/9c4e2a7d1b85_move_enemy_stat_bonus_to_attacker_penalty.py`
- **New (tests):**
  - `backend/tests/engine/`: `builders.py`, `scenarios.py`, and the test files for the runner, state, rng, combat, targets, field bonus, legality, phases, features, spells, field effects, limits, views, board sizes, golden replays and random games
  - `backend/tests/fixtures/replays/` `default_rules.json`, `restore_both.json`, `one_lane_ranged_taunt.json`
- **Changed (backend):**
  - `app/engine/registry.py`: `StatDelta`, the hook base classes, `Module.__init__`, `registry.build`
  - every module file: its hooks. `action_phase.py` now imports `ActionKind` from `actions.py`.
  - `stat_bonus.py`: no `enemy`
  - `tests/engine/test_modules.py`, `test_no_logging.py` (now also forbids clock, I/O and outside randomness) and `tests/test_migrations.py`
- **Changed (frontend):** `src/test/catalogFixture.ts`, `src/catalog/SchemaForm.test.tsx`, `src/catalog/schemaFields.test.ts`
- **Docs:** `context/backend_plan.md` (§0, §1, §3, §4, §5, §7.2–7.7, §7.9, §9.2, §11, §12), `context/frontend_plan.md` (§5.1, §5.2), `context/current-feature.md`, this file

## Verification
- **Backend:** `ruff check .`, `ruff format --check .` and `mypy app tests` pass. `pytest`: 710 passed, the migration tests included.
- **Engine tests:** 308 in about 13 s; the random games take most of it.
- **Random games:**
  - Over 24 seeds, the changed actions hit every refusal reason. About 2,000 of them were still legal, and were accepted.
  - 9 of the 24 games finished within 250 steps.
- **Golden replays:** the default rules, `restore` mana with `actor: both` and lane combat, and a 1-lane game with ranged and taunt. All three end in conquest.
- **Dev DB:** `alembic upgrade head`, down to `055b2bf99518` and up again. The dev DB has only the 5 system origins, so there was nothing to convert; the migration test covers the conversion.
- **Frontend:** `npm run format:check`, `lint`, `typecheck` and `npm test` pass.
- **Not verified:** nothing runs the engine outside tests yet (M6), and nothing on Render.

## Notes
- **The test bot moves creatures** only out of lanes where nothing is left to hit. A game where neither side can reach the other could go on forever; humans have timers and surrender.
- **The docker stack** was started for the tests and is still running.

## Next steps
1. Review and commit `m5-engine`. The new migration runs on deploy.
2. M6: rooms, WebSocket, Redis and timers on top of `app.engine.runner`.
3. Leftovers from earlier features are listed at the top of [current-feature.md](../current-feature.md).
