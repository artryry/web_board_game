# Current feature: M5 — Engine core

**Status:** built on 2026-11-14 on `m5-engine`, not committed yet ([sessions/session_2026-11-14_m5-engine.md](sessions/session_2026-11-14_m5-engine.md)). Every decision was confirmed on 2026-11-14 (see Decisions).
**Plan reference:**
- [backend_plan.md](backend_plan.md): §0 (the game), §5 (modules), §6 (rules JSON), §7 (engine), §11 and §12 (tests)
- [coding-standards.md](coding-standards.md): §2 (a pure engine, mypy strict, modules extend the game) and §4 (tests)

**Depends on:** M2 (the registry and every starter module) and M4 (`RulesetDefinition`, with `mana.mode` since F3). Both are done.
**Unblocks:**
- M6, whose rooms run games through the engine
- F5, whose board needs the state, `legal_actions` and events

On the engine side it covers UC7 (play a game).

Earlier features still have follow-ups:
- **F3:** committed on `f3-rules-editor` (`c065f09`), not merged or pushed. Still to do: a look by hand in a real browser ([sessions/session_2026-11-13_f3-rules.md](sessions/session_2026-11-13_f3-rules.md)).
- **F2:** committed on `f2-decks` (`716a793`), not merged or pushed. Still to check by hand: the copied art on imported cards, and a look in two real browsers ([sessions/session_2026-11-12_f2-decks.md](sessions/session_2026-11-12_f2-decks.md)).
- **M4:** `c8cf578` is on `master` locally, not pushed yet. Its two migrations run on deploy ([sessions/session_2026-11-12_m4-rulesets.md](sessions/session_2026-11-12_m4-rulesets.md)).
- **Dev nginx:** page loads through it stall (an unreachable IPv6 `host.docker.internal`), so `npm run e2e` needs `--workers=1`, and on 2026-11-13 even that needed `--retries=2`. Not fixed; see the F2 and F3 session files.
- **Art cleanup:** deploy it, then check Render ([sessions/session_2026-11-11_art-cleanup.md](sessions/session_2026-11-11_art-cleanup.md)).
- **Logging:** the checks by hand ([sessions/session_2026-11-11_logging.md](sessions/session_2026-11-11_logging.md)).

## Goal
A pure, deterministic game engine in `backend/app/engine` that:
- starts a game from a ruleset, two deck snapshots and a seed
- runs the Setup and Turn pipelines, and stops at interactive phases to wait for the players
- lists every legal action with its targets, applies actions, and reports what happened as events
- runs every starter module (6 phases, 7 features, 7 spells, 7 field effects, `attacker_penalty` included) through hooks, with no module key in the core
- hides each player's secrets in their view, and replays a game exactly from its seed and actions

Done when (backend_plan §11): **the full starter module set works; golden replay tests pass.**

There is no API, DB, Redis or timer in M5. M6 calls the engine from rooms.

## How it works

### Files (backend_plan §3)
```
app/engine/
  state.py        GameState, PlayerState, Section, CreatureInstance, CardInstance, PhasePointer
  snapshots.py    DeckSnapshot, CardSnapshot, OriginSnapshot (what start_game takes)
  rng.py          the seeded PRNG
  actions.py      the Action types and IllegalAction
  events.py       the Event types and per-player filtering
  context.py      EngineContext: the only way the runner and modules change the state
  combat.py       attacks, damage, healing, deaths, conquering
  targets.py      who and what can be targeted
  legality.py     legal_actions and the checks behind IllegalAction
  views.py        PlayerView and view_for
  runner.py       start_game, apply_action, replay (and re-exports legal_actions, view_for)
  modules/        the existing modules, now with their behaviour hooks
```
- **Imports:** the engine imports what it needs, for example `RulesetDefinition` from `app.schemas.rules` (confirmed 2026-11-14). It stays pure, as coding-standards §2 asks: no I/O, no clock, no logging.
- **`app.engine.*` is checked with `mypy --strict`** (already set in `pyproject.toml`).

### What a game starts from
```python
start_game(ruleset: RulesetDefinition, decks: tuple[DeckSnapshot, DeckSnapshot], seed: int)
    -> tuple[GameState, list[Event]]
```
- **Seats, not users (confirmed).** The engine knows seats 0 and 1. Seat 0 goes first. M6 maps users to seats and picks who sits in seat 0. This changes backend_plan §7.2's `user_id` in the player state.
- **`DeckSnapshot`:** `{origin: OriginSnapshot, cards: list[CardSnapshot]}`
  - Each copy of a card is listed separately, so a card with 2 copies appears twice.
  - `CardSnapshot`: `card_id`, `name`, `kind`, `origin_id`, `mana_cost`, `hp`, `dmg`, `abilities` and `art_url`. `art_url` is for display only.
  - A spell's effect is its one ability (`abilities[0]`), as cards store it today.
- **`OriginSnapshot`:** `origin_id`, `name`, `color`, `icon`, `field_effects` and `background_art_url`.
- **The engine trusts the shapes it's given:** M6 checks the ruleset (`validate_definition`) and the decks (the ruleset's deck rules) before it starts a game. Module params are still parsed through the registry, so a bad one fails loudly.

### Determinism
- **Our own small PRNG (SplitMix64) in `rng.py` (confirmed).** Its state is one integer in `GameState`, so a saved state resumes exactly, and no Python upgrade changes the numbers. Python's `random` guarantees only `random()` across versions, not `shuffle`.
- **The only random thing in v1 is shuffling both decks** at the start (Fisher–Yates). Who goes first is M6's choice of seats.
- **No clock:** an interactive phase reports its `time_limit_s`. M6 turns that into a deadline.

### State (backend_plan §7.2)
- **`GameState`:**
  - `ruleset`, `seed`, `rng_state`
  - `turn_number` (0 during setup, then 1, 2, …), `active_seat`
  - `phase` (`{pipeline: "setup" | "turn", index}`) and `ready` flags for `actor: both` phases
  - `players[2]`, `sections[2][lanes]`
  - `status` (`playing` or `finished`), `winner` (a seat, or null for a draw), `end_reason` (`conquered`, `surrender` or `out_of_cards`)
  - `next_uid`, `version` (+1 per applied action) and `log` (the applied actions with their seats)
- **`PlayerState`:**
  - `deck` (top first) and `hand` (oldest first), both `CardInstance`s
  - `mana`, `max_mana`, `mana_started` (for the first Gain mana, §7.3)
  - the `origin` snapshot
- **`Section`:** `owner`, `lane`, `hp`, `max_hp`, `slots` (a creature or empty) and `conquered`.
  - Its field effects are the owner's origin's, read from there rather than copied into each section (confirmed; §7.2 listed them per section).
  - A conquered section has none (confirmed): the opponent has taken it.
- **`CreatureInstance`:**
  - `uid` and the `card` snapshot
  - `hp`, `max_hp`, `dmg`, `owner`
  - `field_bonus` (the HP and DMG it has now from its section, so a change of section or a conquest can take it back; see Features and field effects)
  - `exhausted` (no action left this turn), `has_moved`
  - `features` (its parsed abilities)
- **Ids:** deck cards get `p0-1`, `p0-2`, …; tokens get `t1`, `t2`, … from `next_uid`.
- **Round-trip:** the whole state is JSON. A test serializes it and reads it back unchanged, since M6 keeps it in Redis.

### The runner (backend_plan §7.3)
- **`start_game`:**
  1. shuffle both decks
  2. build the sections (`section_hp`, plus any `section_hp_bonus`)
  3. run Setup
  4. if `hand.second_player_bonus_card`, seat 1 draws one more card (confirmed: right after Setup)
  5. start turn 1 for seat 0
- **Setup runs each automatic phase for both players, seat 0 first (confirmed).** It already has no interactive phase and no `end_turn` (§6).
- **A turn starts:**
  - `turn_started`
  - every creature on the board gets its action back, both players' creatures (confirmed), since `actor: both` phases let the other player act too
  - the field effects' turn-start hooks run (`turn_start_heal_section`)
  - the Turn pipeline walks from index 0
- **Walking the pipeline:**
  - an automatic phase runs its hook and the runner moves on
  - an interactive phase stops the runner, which waits for actions
  - `end_phase` moves past the interactive phase (in `actor: both`, once both are ready)
  - `end_turn` passes the turn to the other seat and starts the next turn
- **Game over** stops everything: `status: finished`, and there are no legal actions after it. See Combat and damage for the ways a game ends.

### Phases
| Phase | What it does |
|---|---|
| `draw` | The active player draws `count` cards (in Setup, both do). **From an empty deck nothing happens**, and a `deck_empty` event says so (confirmed). Draws never fail on a full hand. |
| `gain_mana` | §7.3: the first one gives `mana.start`; later ones `grow` (the maximum +`per_turn` up to `max`, then refill) or `restore` (+`per_turn` up to `max`, unspent kept). |
| `action_phase` | Interactive. `actor: active` lets only the active player act; `both` lets both act, each with their own mana and creatures, until both are ready. `allow` limits the action kinds. |
| `lane_combat` | **The active player's creatures that can still attack attack on their own** (confirmed): lane by lane, slot by slot, at a taunt creature first, else the first enemy creature in the lane, else the enemy section. A ranged creature with nothing to hit in its own lane tries its other attack lanes, lowest index first, in the same order (confirmed). |
| `discard_to_hand_limit` | **The active player discards their newest cards down to `hand.max_size`** (confirmed). Without this phase in the rules, a hand has no limit. |
| `end_turn` | Ends the turn. |

### Actions (backend_plan §7.4)
- **`play_card`:**
  - It costs `mana_cost` minus any `mana_discount`, never below 0, and needs that much mana.
  - A creature goes into an empty slot of any of its owner's sections, a conquered one too (confirmed). In a conquered section it gets no bonus from its origin (see Features and field effects).
  - A player's creatures never leave their own half of the board: playing, moving and `move_enemy` all stay on the owner's side.
  - A spell takes its effect's target (see Spells).
- **`move`:**
  - to any empty slot in its owner's sections, once per turn (confirmed)
  - It needs the creature's action and uses it, unless the owner's origin has `free_move`.
  - With `free_move` a move needs only that the creature hasn't moved this turn: right after it's played, before or after attacking (confirmed).
- **`attack`:**
  - **Who can attack:** a creature that isn't exhausted. A creature played this turn is exhausted (summoning sickness) unless it has `charge`; tokens are too.
  - **What it can hit,** in its lane (and, with `ranged`, a neighbouring lane):
    - a taunt creature, if the enemy section there has any
    - else any creature there
    - else the section itself, unless it is conquered
- **`end_phase`:** ends an interactive phase; in an `actor: both` phase it means ready.
- **`surrender`:** either player, at any time.
- **One action per creature per turn (confirmed):** an attack or a move uses it, except a move with `free_move`.
- **`legal_actions(state, seat)`** lists every action with every valid target, one entry each, so the frontend can drag only what is allowed (frontend_plan §5).

### Combat and damage (backend_plan §7.5)
- Creatures fight at the same time: both deal their `dmg`.
- **`armor`** lowers each hit it takes by its `amount`, never below 0.
- **`lifesteal_section`:** damage the creature deals, attacking or defending, heals its owner's section in its lane, unless that section is conquered.
- **Deaths:** a creature at 0 HP dies after the hit is resolved, so both fighters can die. Then its `on_death` hooks run (`deathrattle_damage` hits the enemy section in its lane).
- **Sections:**
  - A section at 0 HP is conquered. Extra damage is lost.
  - A conquered section can't be healed or damaged again.
  - Its creatures stay and still act, but they lose the bonuses its field gave them (see Features and field effects).
- **Game over:**
  - **Conquered:** when all of a player's sections are conquered, the other player wins. If both lose their last section in one chain, it's a draw (`winner: null`, confirmed).
  - **Out of cards (confirmed):**
    - The trigger: both players have no cards left (deck and hand empty) and there are no creatures on the board. Then nothing can change the sections any more.
    - The player with more sections not conquered wins; with the same number, it's a draw (`winner: null`).
    - `end_reason` is `out_of_cards`. It's checked after every action and every automatic phase.
  - **Surrender:** the other player wins.
- Healing never goes above `max_hp`.

### Spells
| Spell | Target | Effect |
|---|---|---|
| `deal_damage` | an enemy creature (or any creature, by `target`) | the card's `dmg` plus `spell_power`; armor applies |
| `damage_section` | an enemy section that isn't conquered | the card's `dmg` plus `spell_power` |
| `heal` | one of the caster's creatures, or one of their sections that isn't conquered (by `target`) | heals `-dmg` |
| `draw_cards` | — | draws `count` cards |
| `buff` | one of the caster's creatures | `+dmg`, and `+hp` to both its HP and maximum |
| `summon_token` | an empty slot of the caster's | a token creature (`hp`, `dmg`, the caster's origin, no features) |
| `move_enemy` | an enemy creature, and an empty slot on the enemy's side | moves it there |

`spell_power` adds to the spells whose `dmg_use` is `damage`.

### Features and field effects
- **Features:**
  - `taunt` (attacked first)
  - `charge` (no summoning sickness)
  - `ranged` (also a neighbouring lane; no extra effect with one lane)
  - `armor`, `deathrattle_damage`, `lifesteal_section`
  - `field_affinity` (+`bonus` DMG and HP while it stands in a section of its owner's that isn't conquered, when the card's origin is its owner's deck origin)
- **Field effects** (from the owner's origin):
  - `stat_bonus` (`own_origin` or `all_own`; `enemy` moves to `attacker_penalty`)
  - `attacker_penalty` (new, confirmed): when an enemy creature attacks one of the owner's sections that isn't conquered (the section itself, not a creature in it), the attacker takes `hp` damage (armor doesn't reduce it; it can die) and deals `dmg` less to the section, never below 0. Params `hp` 0–2 and `dmg` 0–2. A data migration turns stored `stat_bonus` with `applies_to: enemy` into it.
  - `section_hp_bonus` (at the start)
  - `free_move`
  - `mana_discount`
  - `turn_start_heal_section` (each of the owner's turns, sections that aren't conquered)
  - `spell_power`
- **Field bonuses follow the section a creature stands in (confirmed):**
  - **Which bonuses:** `stat_bonus` (`own_origin`: the card's origin is the deck's; `all_own`) and `field_affinity`.
  - **When they're counted:** when a creature is summoned or moved into a section. A section that isn't conquered gives them; a conquered one doesn't, since the opponent has taken it.
  - **When they're lost:** when a section is conquered, its creatures lose them at once. Moving out of a conquered section brings them back.
  - **How:** the creature keeps its current `field_bonus`, and the engine applies the difference.
    - Gaining HP raises both HP and maximum HP.
    - Losing HP lowers the maximum, and HP only down to it, so losing a bonus never kills (confirmed, as Hearthstone does).
    - Each change emits `stats_changed`.
  - **No negative bonuses:** penalties from the opponent's origin are `attacker_penalty`, which acts on attacks, not on stats.
  - **Player-wide effects:** `free_move`, `mana_discount` and `spell_power` belong to the player, not a section, so a conquest doesn't change them.

### Hooks: how modules plug in
The core never checks a module's key (coding-standards §2). The base classes get hook methods with do-nothing defaults, and the core calls them for every module involved:
- **`PhaseModule`:**
  - `run(ctx, params)` for automatic phases
  - for interactive ones, who may act and which action kinds are allowed, both read from `params`
- **`FeatureModule`:**
  - `must_be_attacked_first` (taunt) and `ready_when_summoned` (charge)
  - `attack_lanes` (ranged)
  - `damage_taken` (armor)
  - `field_bonus(creature, section)` (field_affinity), `on_damage_dealt` (lifesteal) and `on_death` (deathrattle)
- **`SpellModule`:** `targets(ctx, caster)` and `resolve(ctx, caster, card, target)`.
- **`FieldEffectModule`:**
  - `on_game_start` (section_hp_bonus)
  - `field_bonus(creature, section)` (stat_bonus), asked again whenever a creature changes section or its section is conquered
  - `move_uses_action` (free_move)
  - `cost_change` (mana_discount)
  - `on_turn_start` (regeneration)
  - `spell_damage_bonus` (spell_power)
  - `attacker_penalty` (attacker_penalty)
- **`EngineContext`** is the only thing hooks use to change the game: draw, damage, heal, summon, move, destroy, change mana, emit an event. It also counts steps and trigger depth (§7.7).

The exact signatures are settled while building.

### Events (backend_plan §7.6)
- **Types:**
  - `game_started`, `turn_started`, `phase_changed`
  - `card_drawn`, `deck_empty`, `card_discarded`, `mana_changed`, `card_played`
  - `creature_summoned`, `creature_moved`, `attack`, `damage`, `heal`, `stats_changed`, `creature_died`
  - `section_hp_changed`, `section_conquered`
  - `player_ready`, `game_over` (`winner`, a seat or null for a draw, and `end_reason`)
- **Hidden information:** an event that reveals it (the card in `card_drawn` and `card_discarded`) carries the seat that may see it. `events_for(events, seat)` gives the other seat the event without the card.

### Views and replays (backend_plan §7.9)
- **`view_for(state, seat)`:**
  - the player's own hand in full
  - the opponent's hand as a count
  - both decks as counts (confirmed: the own deck's contents stay hidden too)
  - the board, both players' mana, the turn, the active seat
  - the current phase (key, interactive, actor, allowed kinds, `time_limit_s`) and the ready flags
  - the status and winner, and `version`
- **Replays:** the ruleset, both deck snapshots, the seed and the action log give back every state. `replay(...)` reruns them.

### Errors and limits (backend_plan §7.7)
- **`IllegalAction(reason)`:** `game_over`, `not_your_turn`, `not_allowed_now` (the phase or `allow` forbids it), `unknown_card`, `not_enough_mana`, `slot_occupied`, `invalid_target`, `creature_exhausted` and `already_moved`.
- **Limits:**
  - at most 1000 engine steps per action, and a trigger chain at most 20 deep
  - Going past either rejects the action with `engine_limit`, and leaves the state as it was.
  - The engine doesn't log (M6's service logs it).
- **`apply_action` never changes the state it's given;** it returns a new one.

### Tests (backend_plan §12)
- **Unit, in `tests/engine/`:**
  - every module's hooks
  - the runner: Setup for both players, the bonus card, turn flow, both mana modes, `actor: both`, the hand limit, an empty deck, surrender, game over
  - running out of cards: a win on sections left, and a draw
  - field bonuses: on summon, on a move in and out of a conquered section, and lost when a section is conquered (HP never dropping below 1)
  - combat, targeting and the limits
- **Board sizes:** scripted full games with 1, 3 and 5 lanes reach `game_over`, with `ranged` at the edges.
- **Golden replays:** `tests/fixtures/replays/*.json`, each with the ruleset, decks, seed, actions and the expected final state. `UPDATE_GOLDEN=1 pytest …` rewrites them, so changes show in review (confirmed).
- **Random games (property test):**
  - seeded random games, with no new dependency such as Hypothesis
  - every action from `legal_actions` is accepted
  - random other actions get `IllegalAction`
  - the state survives a JSON round-trip
- **Builders:** `tests/engine/builders.py` makes snapshots, decks and states for tests.

### Logging
None: the engine is pure. `tests/engine/test_no_logging.py` already checks it. M6's service logs the engine's results.

## Done when
- [x] `start_game`, `legal_actions`, `apply_action` and `view_for` play the default ruleset with two decks to `game_over`.
- [x] Every starter module works, with unit tests: 6 phases, 7 features, 7 spells, 7 field effects.
- [x] `attacker_penalty` replaces `stat_bonus` on `enemy`, and the migration converts stored origins.
- [x] Both mana modes, `actor: both` phases, the hand limit and empty decks work as decided.
- [x] A game whose players run out of cards and creatures ends on sections left, or in a draw.
- [x] Field bonuses follow the section: counted on summon and move, lost on conquest.
- [x] Full games with 1, 3 and 5 lanes reach `game_over`.
- [x] Golden replay tests pass, and the random-game test passes.
- [x] The engine stays pure (no I/O, clock or logging).
- [x] **Checks pass:** `pytest`, `ruff check .`, `ruff format --check .` and `mypy app tests`.

## Decisions
Confirmed with the user on 2026-11-13:
- **An empty deck:** a draw from it does nothing; a `deck_empty` event says so. No fatigue.
- **The hand limit:** draws never fail; the `discard_to_hand_limit` phase discards the newest cards down to the maximum. Without it there's no limit.
- **`lane_combat`:** the active player's creatures that can still attack do so on their own, lane by lane (taunt first, then the first creature, then the section).
- **Moving:** to any empty slot of the owner's, once per turn.
- **Mana modes** (with F3): `grow` and `restore`, and a player's first turn has `mana.start` (backend_plan §7.3).

Confirmed with the user on 2026-11-14 (comments on this spec):
- **Imports:** no special limit beyond coding-standards §2; the engine imports what it needs.
- **Out of cards:** when both players have no cards in deck or hand and no creatures are on the board, the player with more sections left wins; the same number is a draw.
- **Conquered sections** still take their owner's creatures, but give them no origin bonus. A player's creatures never leave their half of the board.
- **Field bonuses follow the section:** counted when a creature is summoned or moved in, and lost when the section is conquered.

Confirmed with the user on 2026-11-14 (the spec's proposals, second round):
- **Seats, not users:** seat 0 goes first, and M6 decides who sits where.
- **Our own PRNG** (SplitMix64), its state an integer in `GameState`.
- **Setup runs for both players,** seat 0 first; the second player's bonus card comes right after Setup.
- **One action per creature per turn** (an attack or a move). Every creature gets its action back at the start of each turn, either player's.
- **`free_move`:** a move needs only that the creature hasn't moved this turn (changed from the proposal).
- **Summoning sickness** unless `charge`, tokens included.
- **Losing an HP bonus never kills:** HP drops only to the new maximum, and never below 1.
- **Penalties from the opponent's origin** become a new field effect, `attacker_penalty`, which hits a creature that attacks a section that isn't conquered (changed from the proposal; see Features and field effects). `stat_bonus` keeps `own_origin` and `all_own`.
- **Conquered sections** can't be healed or damaged again.
- **Both players losing their last section at once** is a draw (changed from the proposal).
- **`lane_combat` and `ranged`:** the own lane first, then the other attack lanes when the own lane has nothing to hit (changed from the proposal).
- **Views show both decks as counts,** the player's own included.
- **Golden fixtures** are rewritten with `UPDATE_GOLDEN=1`.
- **The random-game test uses fixed seeds**, with no Hypothesis.

Choices made while planning (2026-11-14):
- Module hooks are instance methods on a module built with its parsed params (`registry.build`).
- Deck uids are given after the shuffle, and `events_for` hides the uid with the card, so a uid never reveals a card.
- A token copies the spell's name and art, with the caster's origin and no abilities.
- Lifesteal heals the size of the hit after armor or the penalty.
- The own hand in `view_for` carries each card's current cost (after `mana_discount`).
- `apply_action` checks the specific reasons first, then requires the action to be in `legal_actions`.
- `legal_actions` and its checks live in `legality.py`, and the view in `views.py`; `runner.py` re-exports them.

## Tasks
Order:
1. snapshots, state and the PRNG
2. events, actions, `IllegalAction` and `EngineContext`
3. the runner: `start_game`, walking the pipelines, the phases and the turn flow
4. combat and targeting
5. the hooks: features, spells and field effects
6. `legal_actions`, `apply_action` and the limits
7. `view_for`, event filtering and `replay`
8. board-size, golden and random-game tests
9. docs

Each step comes with its tests.

### Engine
- [x] `attacker_penalty`, `stat_bonus` without `enemy`, and the data migration for stored origins.
- [x] `snapshots.py`, `state.py`, `rng.py` (with a test that a seed gives a fixed sequence).
- [x] `events.py`, `actions.py`, `context.py`.
- [x] `runner.py`: `start_game`, Setup, the bonus card, turns, the six phases.
- [x] `combat.py`, `targets.py`.
- [x] The hooks on the module base classes in `registry.py`, and in every module file.
- [x] `legal_actions`, `apply_action`, the step and depth limits, `view_for`, `events_for`, `replay`.

### Tests
- [x] Unit tests per module and for the runner, combat and targeting.
- [x] Board sizes 1, 3 and 5.
- [x] Golden replays (two or three: the default rules, `restore` mana with `actor: both`, a 1-lane game with ranged and taunt).
- [x] Random games with fixed seeds, and the JSON round-trip.

### Docs
- [x] [backend_plan.md](backend_plan.md):
  - §0 (win condition): the out-of-cards ending and draws
  - §1 and §11: M5 done
  - §3: the engine's files
  - §7.2: seats, field effects read from the origin, and `field_bonus`
  - §7.3: Setup for both players, the turn start, the bonus card
  - §7.4: one action per creature, and moving
  - §7.5: `lane_combat`, the hand limit, empty decks, conquered sections, bonuses that follow the section, and the ways a game ends
  - §7.6: the event list
  - §7.7: the reasons
  - §9.2: `game_over`'s `winner` can be null (a draw)
  - §12: rewriting golden fixtures
- [x] [frontend_plan.md](frontend_plan.md): the game-over screen (F5) shows a draw, and the board shows the field bonus a creature loses on a conquered section.
- [x] Module descriptions that the decisions sharpen, for example `discard_to_hand_limit` ("the newest cards").
- [x] Update this file, and write the session file.

## Out of scope
- **Rooms, WebSocket, Redis, timers and reconnects** (M6). M6 also checks the ruleset and decks when a game starts, and turns `time_limit_s` into a deadline.
- **Saving finished games** and their replay endpoint (M7). The `games` table will need a nullable winner for draws.
- **The game board** (F5).
- **New modules,** fatigue, burning cards, and commit-reveal for `actor: both` (backend_plan §13).
- **Balancing** module numbers.

## Notes
- **Coding standards for the engine:**
  - no clock, no I/O, no logging
  - randomness only through `rng.py`
  - the core never branches on a module key
  - modules come with tests
- **What exists:**
  - `registry.py` (the module classes, `ModuleRef`, `validate_params`) and every starter module's declaration, with no behaviour yet
  - `cost.py`, `tests/engine/test_registry.py`, `test_modules.py` and `test_no_logging.py`
- **Cards:** a creature has 0–2 features in `abilities`; a spell has exactly one effect there (`card_service`).
- **The default ruleset** is `RulesetDefinition()`: 3 lanes of 3 slots, 20 HP per section, 30-card decks, mana 1 / 1 / 10 `grow`, Setup draws 3, and the turn is Gain mana, Draw 1, Action phase (90 s), End turn.

## Open questions
None.
