import type { Ruleset } from "@/api/hooks/useRulesets";

// The fake API's rulesets: the seeded default (backend migration, `system_key: "default"`) and
// one of the user's own, with stricter deck rules so the validity panel has something to switch to.

const NOW = "2026-11-10T10:00:00Z";

type Definition = Ruleset["definition"];

function definition(deck: Definition["deck"]): Definition {
  return {
    schema_version: 1,
    board: { lanes: 3, slots_per_section: 2, section_hp: 30 },
    deck,
    mana: { start: 1, per_turn: 1, max: 10 },
    hand: { max_size: 10, second_player_bonus_card: true },
    setup: [{ key: "draw", params: { count: 3 } }],
    turn: [
      { key: "gain_mana", params: {} },
      { key: "draw", params: { count: 1 } },
      { key: "action_phase", params: { actor: "active", allow: ["play", "move", "attack"] } },
      { key: "end_turn", params: {} },
    ],
  };
}

export const DEFAULT_RULESET_ID = "30000000-0000-4000-8000-000000000001";
export const STRICT_RULESET_ID = "30000000-0000-4000-8000-000000000002";

export function rulesetsFixture(): Ruleset[] {
  return [
    {
      id: DEFAULT_RULESET_ID,
      name: "Default",
      definition: definition({ size: 30, max_copies: 2, allow_neutral: true }),
      is_system: true,
      system_key: "default",
      share_code: null,
      created_at: NOW,
      updated_at: NOW,
    },
    {
      id: STRICT_RULESET_ID,
      name: "Strict",
      definition: definition({ size: 20, max_copies: 1, allow_neutral: false }),
      is_system: false,
      system_key: null,
      share_code: null,
      created_at: NOW,
      updated_at: NOW,
    },
  ];
}
