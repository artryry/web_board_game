import type { Path } from "react-hook-form";

import type { RulesFormValues } from "./rulesetValues";

/** The fixed settings' fields: everything under board, deck, mana and hand. */
export type SettingPath = Extract<
  Path<RulesFormValues>,
  `${"board" | "deck" | "mana" | "hand"}.${string}`
>;

/** Each setting's label, shared by the form and the header's list of problems. */
export const SETTING_LABELS: Readonly<Record<SettingPath, string>> = {
  "board.lanes": "Lanes",
  "board.slots_per_section": "Slots per section",
  "board.section_hp": "Section HP",
  "deck.size": "Deck size",
  "deck.max_copies": "Copies of a card",
  "deck.allow_neutral": "Neutral cards in a deck of another origin",
  "mana.start": "Starting mana",
  "mana.per_turn": "Mana per turn",
  "mana.max": "Maximum mana",
  "mana.mode": "Mana each turn",
  "hand.max_size": "Maximum hand size",
  "hand.second_player_bonus_card": "Bonus card for the second player",
};
