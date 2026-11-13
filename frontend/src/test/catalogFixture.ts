import type { Catalog } from "@/catalog/useCatalog";

// A hand-written catalog shaped like the backend's. The real modules here keep their real
// schemas and costs. Two extra field effects cover the SchemaForm types no built-in module uses
// yet (numbers, booleans, both kinds of enum arrays) and an unsupported property.

function params(properties: Record<string, unknown> = {}) {
  return { type: "object", title: "Params", additionalProperties: false, properties };
}

function bounded(title: string, minimum: number, maximum: number, value: number) {
  return { type: "integer", title, minimum, maximum, default: value };
}

function choice(title: string, options: string[], value: string) {
  return { type: "string", title, enum: options, default: value };
}

export const CATALOG: Catalog = {
  phases: [
    {
      key: "action_phase",
      name: "Action phase",
      description:
        "Players play cards, move creatures and attack, until they end the phase or the time runs out.",
      interactive: true,
      params_schema: params({
        actor: choice("Actor", ["active", "both"], "active"),
        allow: {
          type: "array",
          title: "Allow",
          items: { type: "string", enum: ["play", "move", "attack"] },
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          default: ["play", "move", "attack"],
        },
        time_limit_s: bounded("Time limit (s)", 10, 600, 90),
      }),
    },
    {
      key: "discard_to_hand_limit",
      name: "Discard to hand limit",
      description: "The active player discards down to the ruleset's maximum hand size.",
      interactive: false,
      params_schema: params(),
    },
    {
      key: "draw",
      name: "Draw",
      description: "The active player draws cards. During setup, both players draw.",
      interactive: false,
      params_schema: params({ count: bounded("Count", 1, 5, 1) }),
    },
    {
      key: "end_turn",
      name: "End turn",
      description: "Ends the turn and passes it to the other player. It must be the last phase.",
      interactive: false,
      params_schema: params(),
    },
    {
      key: "gain_mana",
      name: "Gain mana",
      description:
        "Gives the active player their mana for the turn, as the ruleset's mana mode says: their maximum grows by the per-turn amount, up to the cap, and their mana refills (grow), or they get the per-turn amount back, up to the cap (restore).",
      interactive: false,
      params_schema: params(),
    },
    {
      key: "lane_combat",
      name: "Lane combat",
      description: "Combat resolves automatically, lane by lane.",
      interactive: false,
      params_schema: params(),
    },
  ],
  features: [
    {
      key: "taunt",
      name: "Taunt",
      description: "Enemy creatures in this lane must attack it first.",
      params_schema: params(),
      cost: { base: 2, per_param: {} },
    },
    {
      key: "armor",
      name: "Armor",
      description: "Takes less damage from every hit.",
      params_schema: params({ amount: bounded("Amount", 1, 5, 1) }),
      cost: { base: 0, per_param: { amount: 1 } },
    },
    {
      key: "ranged",
      name: "Ranged",
      description: "Attacks without taking damage back.",
      params_schema: params(),
      cost: { base: 2, per_param: {} },
    },
  ],
  spells: [
    {
      key: "deal_damage",
      name: "Deal damage",
      description: "Deals the card's DMG to an enemy creature.",
      params_schema: params({
        target: choice("Target", ["enemy_creature", "any_creature"], "enemy_creature"),
      }),
      cost: { base: 1, per_param: {} },
      dmg_use: "damage",
    },
    {
      key: "heal",
      name: "Heal",
      description: "Heals one of your creatures or sections.",
      params_schema: params({ target: choice("Target", ["creature", "section"], "creature") }),
      cost: { base: 1, per_param: {} },
      dmg_use: "heal",
    },
    {
      key: "draw_cards",
      name: "Draw cards",
      description: "Draws cards from your deck.",
      params_schema: params({ count: bounded("Count", 1, 3, 1) }),
      cost: { base: 0, per_param: { count: 2 } },
      dmg_use: "none",
    },
  ],
  field_effects: [
    {
      key: "stat_bonus",
      name: "Stat bonus",
      description: "Changes creature stats.",
      params_schema: params({
        applies_to: choice("Applies To", ["own_origin", "all_own", "enemy"], "own_origin"),
        hp: bounded("HP", 0, 2, 0),
        dmg: bounded("DMG", 0, 2, 0),
      }),
    },
    {
      key: "free_move",
      name: "Free move",
      description: "Moving a creature costs no action.",
      params_schema: params(),
    },
    {
      key: "section_hp_bonus",
      name: "Section HP bonus",
      description: "Your sections start with more HP.",
      params_schema: params({ amount: bounded("Amount", 1, 10, 5) }),
    },
    {
      key: "test_every_type",
      name: "Every type",
      description: "Not a real module: it covers the other SchemaForm types.",
      params_schema: params({
        weight: { type: "number", title: "Weight", minimum: 0, maximum: 2.5, default: 1.5 },
        enabled: { type: "boolean", title: "Enabled", default: true },
        tags: {
          type: "array",
          title: "Tags",
          items: { type: "string", enum: ["fire", "water", "earth"] },
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
          default: ["fire"],
        },
        sequence: {
          type: "array",
          title: "Sequence",
          items: { type: "string", enum: ["draw", "play"] },
          minItems: 1,
          maxItems: 3,
          default: ["draw"],
        },
      }),
    },
    {
      key: "test_unsupported",
      name: "Unsupported",
      description: "Not a real module: its setting has a type SchemaForm can't show.",
      params_schema: params({ shape: { type: "object", title: "Shape" } }),
    },
  ],
  origin_colors: [
    { key: "orange", hex: "#E69F00" },
    { key: "sky_blue", hex: "#56B4E9" },
    { key: "bluish_green", hex: "#009E73" },
    { key: "yellow", hex: "#F0E442" },
    { key: "blue", hex: "#0072B2" },
    { key: "vermillion", hex: "#D55E00" },
    { key: "reddish_purple", hex: "#CC79A7" },
    { key: "grey", hex: "#999999" },
    { key: "black", hex: "#000000" },
  ],
  origin_icons: [
    "circle",
    "leaf",
    "flame",
    "waves",
    "mountain",
    "sun",
    "moon",
    "snowflake",
    "skull",
    "zap",
    "shield",
    "crown",
    "star",
    "droplet",
    "wind",
    "sparkles",
  ],
};
