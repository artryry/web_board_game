import type { Card, CardBody, CardKind } from "@/api/hooks/useCards";
import type { CardGroup } from "@/api/hooks/useCardGroups";
import type { Origin } from "@/api/hooks/useOrigins";
import { findModule, type Catalog, type ModuleRef } from "@/catalog/useCatalog";

import { abilityCost, cardPoints, suggestManaCost } from "./cost";

// The card editor's values and the one place for the kind and `dmg_use` rules: what HP and DMG
// mean for each kind and spell effect, as the body, the cost and the card frame need them.

export type DmgUse = Catalog["spells"][number]["dmg_use"];

export interface CardFormValues {
  kind: CardKind;
  name: string;
  origin_id: string;
  mana_cost: number;
  hp: number;
  /** A creature's DMG, or a spell's damage or heal amount. Always typed as a positive number. */
  dmg: number;
  /** A creature's abilities, or a spell's one effect. */
  abilities: ModuleRef[];
  /** "" for no group. */
  group_id: string;
  art_key: string | null;
}

/** HP, DMG and abilities as the server stores them. */
export interface CardContent {
  kind: CardKind;
  hp: number | null;
  dmg: number | null;
  abilities: readonly ModuleRef[];
}

/** A new card: a 1/1 creature, in the origin and group the library was showing, if any. */
export function emptyCard(
  starts: { origin: string | null; group: string | null },
  origins: readonly Origin[],
  groups: readonly CardGroup[],
): CardFormValues {
  const origin =
    origins.find((candidate) => candidate.id === starts.origin) ??
    origins.find((candidate) => candidate.system_key === "neutral") ??
    origins[0];
  const group = groups.find((candidate) => candidate.id === starts.group);
  return {
    kind: "creature",
    name: "",
    origin_id: origin?.id ?? "",
    mana_cost: 1,
    hp: 1,
    dmg: 1,
    abilities: [],
    group_id: group?.id ?? "",
    art_key: null,
  };
}

export function fromCard(card: Card): CardFormValues {
  return {
    kind: card.kind,
    name: card.name,
    origin_id: card.origin_id,
    mana_cost: card.mana_cost,
    hp: card.hp ?? 1,
    // A heal is stored as a negative number and typed as the amount healed.
    dmg: card.dmg === null ? 1 : Math.abs(card.dmg),
    abilities: card.abilities.map((ability) => ({
      key: ability.key,
      params: { ...ability.params },
    })),
    group_id: card.group_id ?? "",
    art_key: card.art_key,
  };
}

/** How a spell's effect uses DMG, or null for a creature or a spell without an effect yet. */
export function spellDmgUse(
  values: Pick<CardFormValues, "kind" | "abilities">,
  catalog: Catalog,
): DmgUse | null {
  if (values.kind !== "spell") return null;
  const key = values.abilities[0]?.key;
  if (key === undefined) return null;
  return findModule(catalog.spells, key)?.dmg_use ?? null;
}

/** HP and DMG as they are sent: a spell has no HP, and its DMG follows its effect's `dmg_use`. */
export function cardContent(
  values: Pick<CardFormValues, "kind" | "hp" | "dmg" | "abilities">,
  catalog: Catalog,
): CardContent {
  const { kind, abilities } = values;
  if (kind === "creature") return { kind, hp: values.hp, dmg: values.dmg, abilities };
  switch (spellDmgUse(values, catalog)) {
    case "damage":
      return { kind, hp: null, dmg: values.dmg, abilities };
    case "heal":
      return { kind, hp: null, dmg: -values.dmg, abilities };
    default:
      return { kind, hp: null, dmg: null, abilities };
  }
}

/** The suggested mana cost of a card, from its stats and its abilities' catalog costs. */
export function suggestedCost(content: CardContent, catalog: Catalog): number {
  const specs = content.kind === "creature" ? catalog.features : catalog.spells;
  const costs = content.abilities.map((ability) => {
    const spec = findModule<{ key: string; cost: Catalog["features"][number]["cost"] }>(
      specs,
      ability.key,
    );
    return spec === undefined ? 0 : abilityCost(spec.cost, ability.params ?? {});
  });
  return suggestManaCost(cardPoints(content.kind, content.hp, content.dmg, costs));
}

/** The whole editable card, for a create and for a PATCH alike. */
export function toCardBody(values: CardFormValues, catalog: Catalog): CardBody {
  const { hp, dmg } = cardContent(values, catalog);
  return {
    kind: values.kind,
    name: values.name.trim(),
    origin_id: values.origin_id,
    mana_cost: values.mana_cost,
    hp,
    dmg,
    abilities: values.abilities.map((ability) => ({
      key: ability.key,
      params: ability.params ?? {},
    })),
    group_id: values.group_id === "" ? null : values.group_id,
    art_key: values.art_key,
  };
}

/** The attack stat a card frame shows: "DMG", "Heal" for a negative DMG, or nothing. */
export function attackStat(dmg: number | null): { label: string; value: number } | null {
  if (dmg === null || !Number.isFinite(dmg)) return null;
  return dmg < 0 ? { label: "Heal", value: -dmg } : { label: "DMG", value: dmg };
}

/** The names of a card's abilities, for its frame. */
export function abilityNames(content: CardContent, catalog: Catalog): string[] {
  const specs = content.kind === "creature" ? catalog.features : catalog.spells;
  return content.abilities.map(
    (ability) => findModule<{ key: string; name: string }>(specs, ability.key)?.name ?? ability.key,
  );
}
