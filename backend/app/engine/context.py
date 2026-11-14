"""EngineContext: the only way the runner and the modules change the game.

A context wraps one state while an action (or `start_game`) resolves. It records the events,
builds modules with their params, and counts steps and trigger depth against the limits
(backend_plan §7.7). Going past a limit raises `EngineLimitError`; the runner then drops the
copy it was changing, so the state it was given stays as it was.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import NamedTuple

from app.engine.events import (
    CardDiscarded,
    CardDrawn,
    CreatureDamaged,
    CreatureHealed,
    CreatureMoved,
    CreatureSummoned,
    DeckEmpty,
    Event,
    GameOver,
    ManaChanged,
    SectionConquered,
    SectionHpChanged,
    StatsChanged,
)
from app.engine.registry import (
    NO_CHANGE,
    FeatureModule,
    FieldEffectModule,
    ModuleRef,
    PhaseModule,
    SpellModule,
    registry,
)
from app.engine.seats import SEATS, Seat
from app.engine.snapshots import CardSnapshot
from app.engine.state import (
    CardInstance,
    CreatureInstance,
    EndReason,
    GameState,
    PlayerState,
    Section,
)

MAX_STEPS = 1000
MAX_DEPTH = 20


class EngineLimitError(Exception):
    """An action took more engine steps, or a deeper chain of triggers, than the limits allow."""


class Placed(NamedTuple):
    """A creature and where it stands."""

    section: Section
    slot: int
    creature: CreatureInstance


class EngineContext:
    def __init__(self, state: GameState) -> None:
        self.state = state
        self.events: list[Event] = []
        # Set by the end_turn phase; the runner then starts the other seat's turn.
        self.turn_ended = False
        self._steps = 0
        self._depth = 0
        self._features: dict[str, list[FeatureModule]] = {}
        self._field_effects: dict[Seat, list[FieldEffectModule]] = {}

    # Limits

    def step(self) -> None:
        self._steps += 1
        if self._steps > MAX_STEPS:
            raise EngineLimitError(f"The action took more than {MAX_STEPS} engine steps")

    @contextmanager
    def trigger(self) -> Iterator[None]:
        """Wraps a hook that reacts to something, so chains of reactions are counted."""
        self._depth += 1
        try:
            if self._depth > MAX_DEPTH:
                raise EngineLimitError(f"Triggered effects chained more than {MAX_DEPTH} deep")
            yield
        finally:
            self._depth -= 1

    # Modules

    def current_phase_ref(self) -> ModuleRef:
        pointer = self.state.phase
        rules = self.state.ruleset
        return (rules.setup if pointer.pipeline == "setup" else rules.turn)[pointer.index]

    def current_phase(self) -> PhaseModule:
        return registry.build(PhaseModule, self.current_phase_ref())

    def features(self, creature: CreatureInstance) -> list[FeatureModule]:
        built = self._features.get(creature.uid)
        if built is None:
            built = [registry.build(FeatureModule, ref) for ref in creature.features]
            self._features[creature.uid] = built
        return built

    def field_effects(self, seat: Seat) -> list[FieldEffectModule]:
        built = self._field_effects.get(seat)
        if built is None:
            origin = self.player(seat).origin
            built = [registry.build(FieldEffectModule, ref) for ref in origin.field_effects]
            self._field_effects[seat] = built
        return built

    def spell(self, card: CardSnapshot) -> SpellModule:
        """A spell card's effect: its one ability."""
        return registry.build(SpellModule, card.abilities[0])

    # Reading the state

    def player(self, seat: Seat) -> PlayerState:
        return self.state.players[seat]

    def sections(self, seat: Seat) -> list[Section]:
        return self.state.sections[seat]

    def section(self, seat: Seat, lane: int) -> Section:
        return self.state.sections[seat][lane]

    @property
    def lanes(self) -> int:
        return self.state.ruleset.board.lanes

    def board(self, seat: Seat | None = None) -> list[Placed]:
        """Creatures in board order: seat 0 first, then lane by lane and slot by slot."""
        seats = SEATS if seat is None else (seat,)
        return [
            Placed(section, slot, creature)
            for owner in seats
            for section in self.state.sections[owner]
            for slot, creature in enumerate(section.slots)
            if creature is not None
        ]

    def find(self, uid: str) -> Placed | None:
        return next((placed for placed in self.board() if placed.creature.uid == uid), None)

    def placed(self, creature: CreatureInstance) -> Placed:
        placed = self.find(creature.uid)
        if placed is None:
            raise ValueError(f"Creature {creature.uid} isn't on the board")
        return placed

    def creature(self, uid: str) -> CreatureInstance:
        placed = self.find(uid)
        if placed is None:
            raise ValueError(f"Creature {uid} isn't on the board")
        return placed.creature

    def card_cost(self, seat: Seat, card: CardSnapshot) -> int:
        change = sum(effect.cost_change(card) for effect in self.field_effects(seat))
        return max(0, card.mana_cost + change)

    def spell_damage(self, seat: Seat, card: CardSnapshot) -> int:
        """A damage spell's damage: the card's DMG plus the caster's spell power."""
        bonus = sum(effect.spell_damage_bonus() for effect in self.field_effects(seat))
        return (card.dmg or 0) + bonus

    def move_uses_action(self, seat: Seat) -> bool:
        return all(effect.move_uses_action() for effect in self.field_effects(seat))

    # Changing the state

    def emit(self, event: Event) -> None:
        self.events.append(event)

    def end_turn(self) -> None:
        self.turn_ended = True

    def end_game(self, winner: Seat | None, reason: EndReason) -> None:
        self.state.status = "finished"
        self.state.winner = winner
        self.state.end_reason = reason
        self.emit(GameOver(winner=winner, end_reason=reason))

    def draw(self, seat: Seat, count: int) -> None:
        player = self.player(seat)
        for _ in range(count):
            self.step()
            if not player.deck:
                self.emit(DeckEmpty(seat=seat))
                return
            card = player.deck.pop(0)
            player.hand.append(card)
            self.emit(CardDrawn(seat=seat, card=card))

    def discard_newest(self, seat: Seat) -> None:
        self.step()
        card = self.player(seat).hand.pop()
        self.emit(CardDiscarded(seat=seat, card=card))

    def take_from_hand(self, seat: Seat, uid: str) -> CardInstance:
        hand = self.player(seat).hand
        index = next(i for i, card in enumerate(hand) if card.uid == uid)
        return hand.pop(index)

    def set_mana(self, seat: Seat, mana: int, max_mana: int) -> None:
        """Gives a player their mana for the turn."""
        self.step()
        player = self.player(seat)
        player.mana_started = True
        if (player.mana, player.max_mana) == (mana, max_mana):
            return
        player.mana, player.max_mana = mana, max_mana
        self.emit(ManaChanged(seat=seat, mana=mana, max_mana=max_mana))

    def spend_mana(self, seat: Seat, amount: int) -> None:
        if amount == 0:
            return
        player = self.player(seat)
        player.mana -= amount
        self.emit(ManaChanged(seat=seat, mana=player.mana, max_mana=player.max_mana))

    def new_token_uid(self) -> str:
        uid = f"t{self.state.next_uid}"
        self.state.next_uid += 1
        return uid

    def summon(
        self,
        seat: Seat,
        lane: int,
        slot: int,
        card: CardSnapshot,
        uid: str,
        features: list[ModuleRef],
    ) -> CreatureInstance:
        self.step()
        hp = card.hp or 1
        creature = CreatureInstance(
            uid=uid, card=card, owner=seat, hp=hp, max_hp=hp, dmg=card.dmg or 0, features=features
        )
        # Summoning sickness, unless a feature (charge) says otherwise.
        creature.exhausted = not any(f.ready_when_summoned() for f in self.features(creature))
        section = self.section(seat, lane)
        section.slots[slot] = creature
        self.emit(CreatureSummoned(creature=creature.model_copy(deep=True), lane=lane, slot=slot))
        self.refresh_field_bonus(creature)
        return creature

    def move_creature(self, creature: CreatureInstance, lane: int, slot: int) -> None:
        """Moves a creature to an empty slot on its owner's side."""
        self.step()
        start = self.placed(creature)
        start.section.slots[start.slot] = None
        self.section(creature.owner, lane).slots[slot] = creature
        self.emit(
            CreatureMoved(
                uid=creature.uid,
                seat=creature.owner,
                from_lane=start.section.lane,
                from_slot=start.slot,
                lane=lane,
                slot=slot,
            )
        )
        self.refresh_field_bonus(creature)

    def damage_creature(
        self, creature: CreatureInstance, amount: int, *, through_armor: bool = True
    ) -> int:
        """Lowers HP (death comes later, in `resolve_deaths`). Returns the damage done."""
        self.step()
        if through_armor:
            for feature in self.features(creature):
                amount = feature.damage_taken(amount)
        amount = max(0, amount)
        if amount == 0:
            return 0
        creature.hp -= amount
        self.emit(CreatureDamaged(uid=creature.uid, amount=amount, hp=creature.hp))
        return amount

    def heal_creature(self, creature: CreatureInstance, amount: int) -> int:
        self.step()
        healed = max(0, min(amount, creature.max_hp - creature.hp))
        if healed == 0:
            return 0
        creature.hp += healed
        self.emit(CreatureHealed(uid=creature.uid, amount=healed, hp=creature.hp))
        return healed

    def buff(self, creature: CreatureInstance, hp: int, dmg: int) -> None:
        self.step()
        if hp == 0 and dmg == 0:
            return
        creature.hp += hp
        creature.max_hp += hp
        creature.dmg += dmg
        self._stats_changed(creature)

    def damage_section(self, section: Section, amount: int) -> int:
        """A conquered section takes no damage; damage beyond its HP is lost. At 0 HP it is
        conquered. Returns the HP it lost."""
        self.step()
        if section.conquered:
            return 0
        lost = max(0, min(amount, section.hp))
        if lost == 0:
            return 0
        section.hp -= lost
        self._section_hp_changed(section, -lost)
        if section.hp == 0:
            self._conquer(section)
        return lost

    def heal_section(self, section: Section, amount: int) -> int:
        """A conquered section can't be healed."""
        self.step()
        if section.conquered:
            return 0
        healed = max(0, min(amount, section.max_hp - section.hp))
        if healed == 0:
            return 0
        section.hp += healed
        self._section_hp_changed(section, healed)
        return healed

    def raise_section_max_hp(self, section: Section, amount: int) -> None:
        self.step()
        section.max_hp += amount
        section.hp += amount
        self._section_hp_changed(section, amount)

    def refresh_field_bonus(self, creature: CreatureInstance) -> None:
        """Gives the creature the field bonus of the section it stands in now, and takes back
        the one it had. A conquered section gives none. Losing HP lowers the maximum, and the HP
        only down to it, so losing a bonus never kills."""
        section = self.placed(creature).section
        wanted = NO_CHANGE
        if not section.conquered:
            origin = self.player(creature.owner).origin
            for effect in self.field_effects(creature.owner):
                wanted += effect.field_bonus(creature, origin)
            for feature in self.features(creature):
                wanted += feature.field_bonus(creature, origin)
        had = creature.field_bonus
        if wanted == had:
            return
        hp_change = wanted.hp - had.hp
        creature.max_hp += hp_change
        creature.hp = (
            creature.hp + hp_change if hp_change > 0 else min(creature.hp, creature.max_hp)
        )
        creature.dmg += wanted.dmg - had.dmg
        creature.field_bonus = wanted
        self._stats_changed(creature)

    def _conquer(self, section: Section) -> None:
        section.conquered = True
        self.emit(SectionConquered(seat=section.owner, lane=section.lane))
        for creature in section.slots:
            if creature is not None:
                self.refresh_field_bonus(creature)

    def _section_hp_changed(self, section: Section, delta: int) -> None:
        self.emit(
            SectionHpChanged(
                seat=section.owner,
                lane=section.lane,
                delta=delta,
                hp=section.hp,
                max_hp=section.max_hp,
            )
        )

    def _stats_changed(self, creature: CreatureInstance) -> None:
        self.emit(
            StatsChanged(uid=creature.uid, hp=creature.hp, max_hp=creature.max_hp, dmg=creature.dmg)
        )
