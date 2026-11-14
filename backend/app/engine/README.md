# Game engine (`app/engine`)

The engine runs a card game from a ruleset (`RulesetDefinition`), two deck snapshots and a seed. It is the server's single source of truth for the rules: the frontend only offers moves from `legal_actions` (backend_plan §7, §13).

- **Pure:** no database, Redis, network, clock or logging. It takes data and returns data and events. The service that runs it (M6) logs. `tests/engine/test_no_logging.py` enforces this.
- **Deterministic:** the only randomness is `rng.py`, seeded from the game. The same ruleset, decks, seed and actions always give the same states, so a game can be replayed from its log.
- **Modular:** the rules come from registered modules (phases, features, spells, field effects). The core calls their hooks and **never checks a module's key**.
- **Typed:** `mypy --strict` runs on everything here.

Design reference: [backend_plan.md §7](../../../context/backend_plan.md). Decisions and their history: [current-feature.md](../../../context/current-feature.md).

## Contents
1. [The public API](#the-public-api)
2. [How a game runs](#how-a-game-runs)
3. [Dependencies between the files](#dependencies-between-the-files)
4. [Files, one by one](#files-one-by-one)
5. [Modules](#modules)
6. [Rules to keep when changing the engine](#rules-to-keep-when-changing-the-engine)
7. [Adding a module](#adding-a-module)
8. [Tests](#tests)

## The public API

Import from `app.engine.runner`, never from `app.engine` (that package stays empty, see [Import cycle](#import-cycle)).

```python
start_game(ruleset, decks: tuple[DeckSnapshot, DeckSnapshot], seed) -> (GameState, list[Event])
legal_actions(state, seat) -> list[Action]
apply_action(state, seat, action) -> (GameState, list[Event])   # raises IllegalAction
view_for(state, seat) -> PlayerView
events_for(events, seat) -> list[Event]
replay(ruleset, decks, seed, log) -> list[GameState]
```

- **Seats, not users.** Players are seats `0` and `1`, and seat 0 goes first. M6 maps users to seats.
- **`apply_action` never changes the state it is given.** It returns a new state, or raises `IllegalAction` with a reason and leaves the old one as it was.
- **`GameState` is plain JSON** (`model_dump_json` / `model_validate_json`), so M6 can keep it in Redis.
- **Before sending anything to a player**, pass the state through `view_for` and the events through `events_for`: the raw state holds both hands, both decks and the seed.

## How a game runs

### Starting
```
start_game(ruleset, decks, seed)
  parse every module reference once           (a bad one fails here, not mid-game)
  shuffle deck 0, then deck 1                  (Rng(seed); uids p0-1, p0-2 … follow the shuffle)
  build sections; origins' on_game_start       (section_hp_bonus)
  run Setup: each phase for seat 0, then seat 1
  bonus card for seat 1                        (hand.second_player_bonus_card)
  _start_turn(seat 0) → _advance               (stops at the first interactive phase)
```

### A turn
```
_start_turn(seat)
  turn_number += 1, active_seat = seat, turn_started
  every creature on the board (both players') gets its action back
  the active player's field effects: on_turn_start   (turn_start_heal_section)
  phase = turn[0]

_advance  (a loop)
  phase_changed
  interactive phase?  → reset ready flags, STOP and wait for actions
  automatic phase     → run(ctx, active_seat), resolve deaths, check game over
  end_turn ran?       → _start_turn(other seat)   else → next phase
```

### An action
```
apply_action(state, seat, action)
  check_action      → IllegalAction(reason) if it isn't allowed (state untouched)
  new = state.clone(); ctx = EngineContext(new)
  _resolve:
    surrender   → the other seat wins
    end_phase   → ready (actor: both) or move on → _advance
    play_card   → pay, then summon the creature or resolve the spell
    move        → has_moved, maybe exhausted, move, refresh the field bonus
    attack      → combat.attack
  resolve deaths, check game over
  version += 1, log the action → (new, ctx.events)
  EngineLimitError anywhere → IllegalAction("engine_limit")
```

## Dependencies between the files

```
registry.py   (no runtime import of other engine files; only under TYPE_CHECKING)
   ↑
seats.py, cost.py
   ↑
snapshots.py  (registry, cost, schemas/origin.py)
actions.py    (seats)
   ↑
state.py      (actions, registry, seats, snapshots, schemas/rules.py)
   ↑
events.py     (actions, seats, state)
   ↑
context.py    (events, registry, seats, snapshots, state)
   ↑
targets.py → combat.py   (context)
   ↑
legality.py, views.py    (context, targets)
   ↑
runner.py     (everything above)

modules/*     (registry, context, targets, combat, …), loaded lazily by the registry
```

### Import cycle
`app/schemas/rules.py` imports `app.engine.registry` (for `ModuleRef`), and `state.py` imports `schemas/rules.py`. So:
- `registry.py` must not import engine files at runtime. It imports them only under `TYPE_CHECKING`, and quotes those names in its hook signatures.
- `app/engine/__init__.py` stays empty. If it imported the runner, importing the registry from `schemas/rules.py` would pull in `state.py`, which needs `schemas/rules.py` half-loaded.
- The built-in modules are imported lazily: the registry's loader runs on the first `registry.get` / `all` / `build`, when everything else is already loaded.

## Files, one by one

### `registry.py`: modules and their hooks
The contract between the core and the modules.

**Declarations** (from M2, used by the catalog, the card service and the rules validator):
- `ModuleKind` (`phase`, `feature`, `spell`, `field_effect`) and `DmgUse` (how a spell uses the card's DMG: `damage`, `heal`, `none`).
- `ModuleParams`: the base of every module's `Params` (`extra="forbid"`, frozen). `EmptyParams` for modules without params.
- `ModuleRef`: the stored `{key, params}` shape, used by card abilities, origin field effects and ruleset phases.
- `CostSpec`: a feature's or spell's cost as data (`base + Σ weight × param`), so the frontend computes the same suggestion.
- Errors: `UnknownModuleError` (`unknown_module`) and `InvalidParamsError` (`invalid_params`, with one pydantic error per param).

**Hook value types:**
- `StatDelta(hp, dmg)`: a frozen pydantic model with `+`. `NO_CHANGE` is the zero.
- `ALL_ACTION_KINDS`: `{"play", "move", "attack"}`.
- `PhaseActor`: `"active" | "both"`.

**`Module`:** every module is a class with class-level declarations (`kind`, `key`, `name`, `description`, `Params`) and, since M5, an instance built with its parsed params: `Module(params)` stores `self.params`. The base types `params` as `Any`, so each module can redeclare `params: Params` with its own type, and mypy and Pylance both accept it.

**Base classes and their hooks** (all defaults do nothing):

| Base | Hook | Default | Called by |
|---|---|---|---|
| `PhaseModule` | `interactive` (class var) | `False` | runner: stop and wait? |
| | `run(ctx, seat)` | nothing | runner, for automatic phases |
| | `actor()` | `"active"` | legality, views, `end_phase` |
| | `allowed()` | all kinds | legality, views |
| | `time_limit_s()` | `None` | views (M6 turns it into a deadline) |
| `FeatureModule` | `must_be_attacked_first()` | `False` | targets (taunt) |
| | `ready_when_summoned()` | `False` | `ctx.summon` (charge) |
| | `attack_lanes(lane, lanes)` | `{lane}` | targets (ranged) |
| | `damage_taken(amount)` | `amount` | `ctx.damage_creature` (armor) |
| | `field_bonus(creature, origin)` | `NO_CHANGE` | `ctx.refresh_field_bonus` (field_affinity) |
| | `on_damage_dealt(ctx, creature, amount)` | nothing | combat (lifesteal) |
| | `on_death(ctx, creature, lane)` | nothing | `combat.resolve_deaths` (deathrattle) |
| `SpellModule` | `dmg_use` (class var) | required | catalog, card service |
| | `targets(ctx, caster)` | `[None]` (no target) | legality |
| | `resolve(ctx, caster, card, target)` | raises `NotImplementedError` | runner, on `play_card` |
| `FieldEffectModule` | `on_game_start(ctx, owner)` | nothing | `start_game` (section_hp_bonus) |
| | `on_turn_start(ctx, owner)` | nothing | `_start_turn` (regeneration) |
| | `field_bonus(creature, origin)` | `NO_CHANGE` | `ctx.refresh_field_bonus` (stat_bonus) |
| | `move_uses_action()` | `True` | `ctx.move_uses_action` (free_move) |
| | `cost_change(card)` | `0` | `ctx.card_cost` (mana_discount) |
| | `spell_damage_bonus()` | `0` | `ctx.spell_damage` (spell_power) |
| | `attacker_penalty()` | `NO_CHANGE` | `combat.attack` (attacker_penalty) |

`CostedModule` (features and spells) adds `cost_spec` and `cost(params)`.

**`ModuleRegistry`** (one global `registry`):
- `register(cls, key)`: checks the declaration at import time (`_check_declaration`: name, description, `Params` type, a spell's `dmg_use`, a `cost_spec` whose weights name int params) and refuses a repeated key.
- `get(base, key)`, `all(base)`: lookups by kind; the built-in modules load on the first one.
- `validate_params(base, key, params)`: the parsed `Params`, or `InvalidParamsError`.
- `build(base, ref)`: **the module instance for a `ModuleRef`**, params parsed. This is how the engine gets every module.
- Decorators: `@phase("key")`, `@feature("key")`, `@spell("key")`, `@field_effect("key")`.

### `seats.py`: the two players
`Seat = Literal[0, 1]`, `SEATS = (0, 1)` (seat 0 takes the first turn) and `other(seat)`. It is its own file because `actions.py` and `state.py` both need `Seat`, and `state.py` imports `actions.py`.

### `snapshots.py`: what a game starts from
Frozen copies of the content, taken by M6 when the game starts. Later edits to cards, origins or decks never affect a running game. Ids are strings, to keep the state plain JSON.
- `CardSnapshot`: `card_id`, `name`, `kind` (`creature` / `spell`), `origin_id`, `mana_cost`, `hp`, `dmg`, `abilities` (a creature's features, or a spell's one effect as `abilities[0]`), `art_url` (display only).
- `OriginSnapshot`: `origin_id`, `name`, `color`, `icon`, `field_effects`, `background_art_url`. `color` and `icon` reuse the literals from `schemas/origin.py`.
- `DeckSnapshot`: `origin` and `cards`, **one entry per copy**.

The engine trusts these shapes: M6 checks the ruleset (`validate_definition`) and the decks (the ruleset's deck rules) first. `start_game` still builds every module reference once, so a bad one fails before the game starts.

### `state.py`: the game as data
| Model | Fields | Notes |
|---|---|---|
| `CardInstance` | `uid`, `card` | In a deck or a hand. **Frozen.** Uids `p0-1`, `p0-2`, … follow the shuffled order, so a uid says nothing about the card. |
| `CreatureInstance` | `uid`, `card`, `owner`, `hp`, `max_hp`, `dmg`, `field_bonus`, `exhausted`, `has_moved`, `features` | A creature from the hand keeps its card's uid; tokens get `t1`, `t2`, …. `field_bonus` is the `StatDelta` its section gives it now. `exhausted` means no action left this turn. |
| `Section` | `owner`, `lane`, `hp`, `max_hp`, `slots`, `conquered` | `slots[i]` is a creature or `None`. Field effects aren't stored here: they're read from the owner's origin. |
| `PlayerState` | `origin`, `deck` (top first), `hand` (oldest first), `mana`, `max_mana`, `mana_started` | `mana_started` makes the first Gain mana give `mana.start`. |
| `PhasePointer` | `pipeline` (`setup` / `turn`), `index` | Where the runner is. While a game is playing, it points at an interactive turn phase. |
| `LoggedAction` | `seat`, `action` | One applied action. **Frozen.** |
| `GameState` | `ruleset`, `seed`, `rng_state`, `turn_number`, `active_seat`, `phase`, `ready`, `players`, `sections[seat][lane]`, `status`, `winner`, `end_reason`, `next_uid`, `version`, `log` | `turn_number` is 0 in Setup. `winner` is a seat, or `None` for a draw. `version` is +1 per action. |

Type aliases: `Pipeline`, `GameStatus` (`playing` / `finished`), `EndReason` (`conquered` / `surrender` / `out_of_cards`).

**`GameState.clone()`** is how `apply_action` gets a state it can change. It copies what the engine changes in place (the phase pointer, `ready`, players with their `deck` and `hand` lists, sections with their `slots`, each creature, and the `log` list). It **shares** what the engine never changes in place: the ruleset, snapshots, `ModuleRef`s, `CardInstance`s, `StatDelta`s and log entries. A full deep copy took most of each action's time and grew with the log (about 18 ms per action over a long bot game). With `clone()`, a whole action takes about 0.8 ms.

### `rng.py`: the only randomness
`Rng(state)`: SplitMix64, written here so no Python upgrade can change a shuffle. Its whole state is one 64-bit integer, which `GameState.rng_state` stores.
- `next_u64()`: the next number (checked against the reference implementation's outputs in `test_rng.py`).
- `randbelow(n)`: uniform in `[0, n)`, with rejection sampling, so there's no modulo bias.
- `shuffle(items)`: Fisher–Yates, in place.

In v1 only `start_game` uses it (shuffling deck 0, then deck 1).

### `actions.py`: what players send
All models are frozen, so actions compare and hash by value. `legal_actions` entries can be compared with what a client sent.

**Targets** (discriminated on `kind`):
| Model | Shape | Used for |
|---|---|---|
| `SlotRef` | `{kind: "slot", seat, lane, slot}` | playing a creature, moving, `summon_token` |
| `SectionRef` | `{kind: "section", seat, lane}` | attacks, `damage_section`, `heal` on a section |
| `CreatureRef` | `{kind: "creature", uid}` | attacks, `deal_damage`, `heal`, `buff` |
| `CreatureToSlotRef` | `{kind: "creature_to_slot", uid, to: SlotRef}` | `move_enemy` |

`Target` is the union of all four; `AttackTarget` is creature or section.

**Actions** (discriminated on `type`): `PlayCard(card_uid, target)`, `Move(creature_uid, to)`, `Attack(creature_uid, target)`, `EndPhase()`, `Surrender()`. `Action` is the union, and `action_adapter` parses one from a client message (for M6).

**`IllegalAction(reason, message)`**, with `IllegalReason`:

| Reason | When |
|---|---|
| `game_over` | the game has ended |
| `not_your_turn` | the seat can't act in this phase |
| `not_allowed_now` | the phase's `allow` forbids the kind, or the player is already ready in an `actor: both` phase |
| `unknown_card` | the card isn't in the hand, or the creature isn't the player's |
| `not_enough_mana` | the cost (after discounts) is above the player's mana |
| `slot_occupied` | the slot already has a creature |
| `invalid_target` | anything else not in `legal_actions` |
| `creature_exhausted` | the creature has no action left (just played, already attacked or moved) |
| `already_moved` | the creature moved this turn |
| `engine_limit` | resolving it went past `MAX_STEPS` or `MAX_DEPTH` |

`ActionKind` (`play` / `move` / `attack`) lives here too, since `action_phase`'s `allow` and the registry's hooks use it.

### `events.py`: what happened
One frozen model per event type, discriminated on `type`. They are **copies**: a creature in an event shows it as it was at that moment. The frontend plays them as animations.

| Type | Model | Fields |
|---|---|---|
| `game_started` | `GameStarted` | — |
| `turn_started` | `TurnStarted` | `seat`, `turn_number` |
| `phase_changed` | `PhaseChanged` | `pipeline`, `index`, `key` |
| `card_drawn` | `CardDrawn` | `seat`, `card` (**hidden**) |
| `deck_empty` | `DeckEmpty` | `seat` |
| `card_discarded` | `CardDiscarded` | `seat`, `card` (**hidden**) |
| `mana_changed` | `ManaChanged` | `seat`, `mana`, `max_mana` |
| `card_played` | `CardPlayed` | `seat`, `card`, `cost`, `target` |
| `creature_summoned` | `CreatureSummoned` | `creature`, `lane`, `slot` |
| `creature_moved` | `CreatureMoved` | `uid`, `seat`, `from_lane`, `from_slot`, `lane`, `slot` |
| `attack` | `AttackMade` | `uid`, `target` |
| `damage` | `CreatureDamaged` | `uid`, `amount`, `hp` |
| `heal` | `CreatureHealed` | `uid`, `amount`, `hp` |
| `stats_changed` | `StatsChanged` | `uid`, `hp`, `max_hp`, `dmg` |
| `creature_died` | `CreatureDied` | `uid`, `seat`, `lane`, `slot` |
| `section_hp_changed` | `SectionHpChanged` | `seat`, `lane`, `delta` (negative for damage), `hp`, `max_hp` |
| `section_conquered` | `SectionConquered` | `seat`, `lane` |
| `player_ready` | `PlayerReady` | `seat` |
| `game_over` | `GameOver` | `winner` (a seat, or `None` for a draw), `end_reason` |

`events_for(events, seat)` copies the list and removes the `card` (and with it the uid) from the other seat's `card_drawn` and `card_discarded`. Damage and heals that change nothing (0) emit no event.

### `context.py`: `EngineContext`
**The only way the runner and the modules change the game.** One context wraps one state while an action (or `start_game`) resolves. It keeps the events, caches built modules, and counts the limits.

- **Limits:** `MAX_STEPS = 1000` per action, `MAX_DEPTH = 20` for chains of triggers.
  - `step()` counts one unit of work. Every state change and every phase run calls it.
  - `with ctx.trigger():` wraps a hook that reacts to something (spell resolution, turn-start effects, lifesteal, death hooks).
  - Going past either raises `EngineLimitError`, which `apply_action` turns into `IllegalAction("engine_limit")`. The limits are module globals read at call time, so tests can lower them with `monkeypatch`.
- **Modules:**
  - `current_phase_ref()`, `current_phase()`: the phase the pointer is on.
  - `features(creature)`: cached per uid.
  - `field_effects(seat)`: the seat's origin effects, cached.
  - `spell(card)`: the spell's effect, `abilities[0]`.
- **Reading:**
  - `player(seat)`, `sections(seat)`, `section(seat, lane)`, `lanes`
  - `board(seat=None)`: `Placed(section, slot, creature)` in board order (seat 0 first, then lane and slot)
  - `find(uid)`, `placed(creature)`, `creature(uid)`
  - `card_cost(seat, card)`: `mana_cost + Σ cost_change`, never below 0
  - `spell_damage(seat, card)`: card DMG plus `Σ spell_damage_bonus`
  - `move_uses_action(seat)`: false if any origin effect says so
- **Changing** (each emits its events):

| Method | What it does |
|---|---|
| `emit(event)` | records an event |
| `end_turn()` | flags the end of the turn; the runner starts the next one |
| `end_game(winner, reason)` | `status: finished`, `winner`, `end_reason`, `game_over` |
| `draw(seat, count)` | top card to the hand; an empty deck draws nothing and emits `deck_empty` |
| `discard_newest(seat)` | the last card of the hand |
| `take_from_hand(seat, uid)` | removes and returns a hand card |
| `set_mana(seat, mana, max_mana)` | gives the turn's mana and marks `mana_started` |
| `spend_mana(seat, amount)` | pays for a card |
| `new_token_uid()` | `t1`, `t2`, … from `next_uid` |
| `summon(seat, lane, slot, card, uid, features)` | puts a creature on the board, exhausted unless a feature is `ready_when_summoned`, then refreshes its field bonus |
| `move_creature(creature, lane, slot)` | to a slot on its owner's side, then refreshes its field bonus |
| `damage_creature(creature, amount, through_armor=True)` | lowers HP through `damage_taken` (or around it); death comes later |
| `heal_creature(creature, amount)` | up to `max_hp` |
| `buff(creature, hp, dmg)` | raises HP, max HP and DMG |
| `damage_section(section, amount)` | a conquered section takes nothing; damage beyond its HP is lost; at 0 the section is conquered and its creatures' bonuses are refreshed |
| `heal_section(section, amount)` | up to `max_hp`, never a conquered section |
| `raise_section_max_hp(section, amount)` | HP and max HP (`section_hp_bonus`) |
| `refresh_field_bonus(creature)` | see below |

**`refresh_field_bonus`** is how field bonuses follow the section a creature stands in. It runs on summon, on every move (`move_enemy` included) and on conquest.
1. **Wanted bonus:** `NO_CHANGE` in a conquered section. Otherwise the sum of `field_bonus` over the owner's origin effects (`stat_bonus`) and the creature's features (`field_affinity`).
2. **Apply the difference** from the stored `field_bonus`:
   - DMG changes by the difference.
   - Gaining HP raises HP and max HP.
   - Losing HP lowers max HP, and HP only down to the new max, so **losing a bonus never kills**.
3. **Emit** `stats_changed`.

### `targets.py`: who and what can be targeted
Read-only helpers on a context:
- `creatures(ctx, seat)`, `empty_slots(ctx, seat)`, `live_sections(ctx, seat)` (not conquered).
- `attack_lanes(ctx, creature)`: its own lane plus whatever its features add (`ranged`), within the board, sorted.
- `attack_targets(ctx, creature)`: for each attack lane, in order:
  1. the enemy section's taunt creatures, if it has any
  2. else all its creatures
  3. else the section itself, unless it is conquered
- `lane_combat_target(ctx, creature)`: the first of those, own lane first. When the own lane has nothing to hit, it tries the other attack lanes, lowest index first.
- `expect(target, Kind)`: narrows a spell's target to the type it needs. `legal_actions` only offers valid targets, so a wrong one is a bug, and it raises.

### `combat.py`: attacks, deaths and the end of the game
- **`attack(ctx, attacker, target)`:** the attacker is exhausted and `attack` is emitted.
  - **Creature target:** both hit at once with their DMG, through armor. Then each one's `on_damage_dealt` runs (lifesteal heals by the hit after armor).
  - **Section target:** the defending owner's `attacker_penalty` hooks are summed. The section takes `max(0, dmg − penalty.dmg)`, the attacker takes `penalty.hp` (not through armor), and lifesteal heals by the section hit.
  - Then `resolve_deaths`.
- **`resolve_deaths(ctx)`:**
  1. removes every creature at 0 HP or less, in board order, with `creature_died`
  2. runs their `on_death` hooks inside one `trigger()`
  3. resolves any deaths those cause one level deeper, so an endless chain hits `MAX_DEPTH`
- **`check_game_over(ctx)`** (does nothing once the game is over):
  - **conquered:** a player with every section conquered loses. Both at once is a draw (`winner: None`).
  - **out of cards:** both decks and hands are empty, and no creature is on the board. The player with more sections that aren't conquered wins; the same number is a draw.
  - (Surrender is handled by the runner.)

  It is called after every action, every automatic phase and every `lane_combat` attack.

### `legality.py`: which actions are legal, and why not
- **`can_act(state, phase, seat)`:** the game is playing, the phase is interactive, and either the actor is `active` and the seat is the active one, or the actor is `both` and the seat isn't ready yet.
- **`legal_actions(state, seat)`:** nothing once the game is over. Otherwise `Surrender()` always, and, when the seat can act:
  - `EndPhase()`
  - `play`: each affordable hand card × each target (every empty own slot for a creature, every `targets()` entry for a spell)
  - `move`: each creature that may move × each empty own slot. Without `free_move`, it needs to be not exhausted and not moved yet; with `free_move`, only not moved yet.
  - `attack`: each creature that isn't exhausted × each `attack_targets` entry

  Only the kinds the phase's `allowed()` lists are included, in a fixed order, one entry per target, so the frontend's drag-and-drop index comes straight from it.
- **`check_action(state, seat, action)`:** raises `IllegalAction`, checking the specific reasons first so the message says why: game over, turn, `allow`, card or creature, mana, moved or exhausted, slot. Then it requires `action in legal_actions(state, seat)` (otherwise `invalid_target`), **so the checks and the list can never disagree**.

### `views.py`: what one player may see
`view_for(state, seat) -> PlayerView`:

| Field | Content |
|---|---|
| `seat`, `version`, `status`, `winner`, `end_reason`, `turn_number`, `active_seat` | as in the state |
| `phase` (`PhaseView`) | `pipeline`, `index`, `key`, `interactive`, and for interactive phases `actor`, `allow`, `time_limit_s` |
| `ready` | the `actor: both` flags |
| `players` (`PlayerSummary` per seat) | `origin`, `mana`, `max_mana`, `deck_count`, `hand_count`, and `hand` for the viewer only: `HandCard(uid, card, cost)`, where `cost` already has discounts in it |
| `sections` | the board, with creatures (copied) |

Both decks are counts, so nobody sees a deck's order or contents. The seed and `rng_state` are never in a view.

### `runner.py`: the entry points
Public: `start_game`, `apply_action`, `replay`, and re-exports of `legal_actions`, `view_for`, `events_for` and `PlayerView`. The private steps:

| Function | Role |
|---|---|
| `_build_every_module` | builds every phase, origin effect and card ability once, so a bad reference fails at the start |
| `_player`, `_sections` | shuffle a deck and give the uids; build a seat's sections |
| `_run_setup` | each Setup phase, for seat 0 then seat 1 |
| `_run_automatic` | one automatic phase: `step`, `run`, deaths, game-over check |
| `_start_turn` | turn number, active seat, refresh every creature, turn-start effects, phase 0 |
| `_advance` | the turn loop (see [A turn](#a-turn)) |
| `_resolve` | dispatches an action, then deaths and the game-over check |
| `_end_phase` | ready in `actor: both` (moves on when both are), else moves on |
| `_play` | take the card, pay, `card_played`; summon the creature, or resolve the spell inside `trigger()` |
| `_move` | `has_moved`; `exhausted` unless `free_move`; move |

`replay(ruleset, decks, seed, log)` returns the state after the start and after each logged action. That is all M7 needs to show a past game step by step.

### `cost.py`: the mana-cost suggestion
Not part of the game rules: it is the card editor's advice (backend_plan §7.8). `card_points(kind, hp, dmg, ability_costs)`, `suggest_mana_cost(points)` (`ceil((points − 1) / 2)`, at least 0), `balance(mana_cost, suggested)`, and the card cost bounds `MIN_MANA_COST` / `MAX_MANA_COST`. The frontend mirrors it and runs the same cases from `tests/fixtures/cost_cases.json`.

## Modules
`modules/<kind>/<key>.py`, one class per file, registered with a decorator. `modules/__init__.py` and each kind's `__init__.py` import them all, which is what registers them.

### Phases (`modules/phases/`)
| Key | Interactive | `run` / hooks |
|---|---|---|
| `draw` | no | `ctx.draw(seat, count)`; in Setup, both seats draw |
| `gain_mana` | no | first time: `mana.start` (max `start` in `grow`, `mana.max` in `restore`); then `grow` (max +`per_turn` up to `max`, refill) or `restore` (+`per_turn` up to `max`, unspent kept) |
| `action_phase` | **yes** | `actor()`, `allowed()`, `time_limit_s()` from its params |
| `lane_combat` | no | each ready creature of the seat, lane by lane and slot by slot, attacks `lane_combat_target`; stops when the game ends |
| `discard_to_hand_limit` | no | discards the newest cards while the hand is above `hand.max_size` |
| `end_turn` | no | `ctx.end_turn()` |

### Features (`modules/features/`)
| Key | Params | Hook |
|---|---|---|
| `taunt` | — | `must_be_attacked_first` → `True` |
| `charge` | — | `ready_when_summoned` → `True` |
| `ranged` | — | `attack_lanes` → the lane and its neighbours on the board |
| `armor` | `amount` 1–5 | `damage_taken` → `max(0, amount − armor)` |
| `lifesteal_section` | — | `on_damage_dealt` → heals its own section in its lane |
| `deathrattle_damage` | `amount` 1–5 | `on_death` → damages the enemy section in the lane it died in |
| `field_affinity` | `bonus` 1–2 | `field_bonus` → +bonus HP and DMG when the card's origin is the deck origin |

### Spells (`modules/spells/`)
| Key | DMG use | `targets` | `resolve` |
|---|---|---|---|
| `deal_damage` | damage | enemy creatures (`target: any_creature` adds own ones) | `spell_damage` to the creature, through armor |
| `damage_section` | damage | enemy sections that aren't conquered | `spell_damage` to the section |
| `heal` | heal | own creatures, or own live sections (`target: section`) | heals `−dmg` |
| `draw_cards` | none | none | draws `count` |
| `buff` | none | own creatures | `+dmg`, `+hp` to HP and max HP |
| `summon_token` | none | empty own slots | a token (the spell's name and art, the caster's origin, `hp`/`dmg` from params, no features, summoning-sick) |
| `move_enemy` | none | each enemy creature × each empty enemy slot | moves it (its field bonus is refreshed; it doesn't count as its own move) |

### Field effects (`modules/field_effects/`)
They come from a player's deck origin and belong to that player.

| Key | Params | Hook |
|---|---|---|
| `stat_bonus` | `applies_to` own_origin\|all_own, `hp` 0–2, `dmg` 0–2 | `field_bonus` |
| `attacker_penalty` | `hp` 0–2, `dmg` 0–2 | `attacker_penalty` |
| `section_hp_bonus` | `amount` 1–10 | `on_game_start` → +amount HP and max HP on every own section |
| `free_move` | — | `move_uses_action` → `False` |
| `mana_discount` | `card_kind` creature\|spell, `amount` 1–2 | `cost_change` → −amount for that kind |
| `turn_start_heal_section` | `amount` 1–3 | `on_turn_start` → heals every own live section |
| `spell_power` | `amount` 1–2 | `spell_damage_bonus` → +amount |

## Rules to keep when changing the engine
- **Change the state only through `EngineContext`** (or the runner's own bookkeeping), and only on the clone `apply_action` made.
- **Never change a shared part in place:** `RulesetDefinition`, snapshots, `ModuleRef`s, `CardInstance`s, `StatDelta`s and `LoggedAction`s are shared between states. Replace them instead. If you add a field that the engine changes in place, add it to `GameState.clone()`. The random-game test checks on every step that `apply_action` leaves its input unchanged.
- **No key checks in the core.** If the core needs to know something about a module, add a hook with a do-nothing default to the base class in `registry.py`.
- **No randomness, clock, I/O or logging** (`test_no_logging.py`). Randomness goes through `Rng` and its state in `GameState`.
- **Keep it deterministic:** iterate in board order (seat, lane, slot) and sort sets before using their order.
- **Keep `legal_actions` the source of truth.** A new action kind needs an entry in `legal_actions`, a reason check in `check_action`, a branch in `runner._resolve`, and the frontend must be able to drag it.
- **Wrap reactions in `ctx.trigger()`** and count work with `ctx.step()`, so the limits keep protecting the server.
- **A rules change shows up in the golden replays.** Rewrite them with `UPDATE_GOLDEN=1` and review the diff.

## Adding a module
1. Add `modules/<kind>/<key>.py` with a class registered by the kind's decorator:
   - `name`, `description` and a `Params(ModuleParams)` whose fields fit `SchemaForm` (bounded ints, `Literal` enums, bools, arrays of enums)
   - for a feature or spell, a `cost_spec`; for a spell, a `dmg_use`
   - `params: Params`, if it reads its params
2. Override the hooks it needs. If none fits, add a new hook to the base class with a do-nothing default, and call it from the core.
3. Import it in the kind's `__init__.py`.
4. Add its key to `STARTER_KEYS` in `tests/engine/test_modules.py`, and test its hooks (`test_features.py`, `test_spells.py`, `test_field_effects.py` or `test_phases.py`).
5. Update the module table in backend_plan §5. The catalog and the frontend forms pick it up on their own.

## Tests
All in `backend/tests/engine/`:

| File | Covers |
|---|---|
| `builders.py` | snapshot, deck and ruleset builders; `new_game`, `put_creature`, `give_card`; the greedy bot (`play_out`) |
| `scenarios.py` | the card pool, origins and rulesets of the full-game tests |
| `test_rng.py`, `test_state.py` | reference outputs and shuffles; the JSON round trip and `clone()` |
| `test_runner.py` | Setup, the bonus card, uids, turns, both mana modes, `actor: both`, the hand limit, an empty deck, surrender, every way a game ends |
| `test_combat.py`, `test_targets.py`, `test_field_bonus.py` | fights, armor, lifesteal, penalties, deathrattle, conquest; taunt, ranged, lane-combat targets; bonuses on summon, move and conquest |
| `test_legality.py`, `test_limits.py`, `test_views.py` | every refusal reason, `free_move`, discounts; the step and depth limits; hidden information |
| `test_phases.py`, `test_features.py`, `test_spells.py`, `test_field_effects.py`, `test_modules.py`, `test_registry.py`, `test_cost.py` | each module's hooks and declaration; the registry; the cost suggestion |
| `test_board_sizes.py` | bot games on 1, 3 and 5 lanes reach game over |
| `test_golden_replays.py` | three recorded games (`tests/fixtures/replays/`) replay to the same final state |
| `test_random_games.py` | 24 seeded random games: legal actions are accepted, changed ones are refused exactly when illegal, the input never changes, the state survives JSON |
| `test_no_logging.py` | no logging, clock, I/O or outside randomness in this folder |
