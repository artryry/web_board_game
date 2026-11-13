import { copyName } from "@/api/bounds";
import type { Ruleset, RulesetBody, RulesetDefinition } from "@/api/hooks/useRulesets";
import type { ModuleRef } from "@/catalog/useCatalog";

/**
 * The editor's form: the definition at the top level, so a server error's `path` joined with dots
 * is the field's name (`board.lanes`, `turn.2.params.time_limit_s`), plus the ruleset's name.
 */
export type RulesFormValues = RulesetDefinition & { name: string };

function copyPhases(phases: readonly ModuleRef[]): ModuleRef[] {
  return phases.map((phase) => ({ key: phase.key, params: structuredClone(phase.params ?? {}) }));
}

/** The form holding a definition, under a name. */
export function toFormValues(name: string, definition: RulesetDefinition): RulesFormValues {
  return {
    name,
    schema_version: definition.schema_version,
    board: { ...definition.board },
    deck: { ...definition.deck },
    mana: { ...definition.mana },
    hand: { ...definition.hand },
    setup: copyPhases(definition.setup),
    turn: copyPhases(definition.turn),
  };
}

/** A saved ruleset, as it is. */
export function savedValues(ruleset: Ruleset): RulesFormValues {
  return toFormValues(ruleset.name, ruleset.definition);
}

/** A new ruleset filled in from another one, named "<name> copy". Nothing exists until Save. */
export function duplicateValues(ruleset: Ruleset): RulesFormValues {
  return toFormValues(copyName(ruleset.name), ruleset.definition);
}

/** A new ruleset starts from the default's rules, with no name. */
export function newValues(defaultRuleset: Ruleset): RulesFormValues {
  return toFormValues("", defaultRuleset.definition);
}

export function toDefinition(values: RulesFormValues): RulesetDefinition {
  const { schema_version, board, deck, mana, hand, setup, turn } = values;
  return { schema_version, board, deck, mana, hand, setup, turn };
}

/** The whole ruleset as the API takes it: the server replaces the definition, so it's all sent. */
export function toRulesetBody(
  values: RulesFormValues,
): RulesetBody & { definition: RulesetDefinition } {
  return { name: values.name.trim(), definition: toDefinition(values) };
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The list's one-line summary, for example "3 lanes · 30-card decks · 4 turn phases". */
export function rulesetSummary(definition: RulesetDefinition): string {
  return [
    counted(definition.board.lanes, "lane"),
    `${definition.deck.size}-card decks`,
    counted(definition.turn.length, "turn phase"),
  ].join(" · ");
}
