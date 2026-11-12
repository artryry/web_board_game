// Input limits copied from the backend, so the editors can answer as the user types. They are
// input limits, not game rules, and the server checks every one of them again:
// - names: backend/app/schemas/common.py (ContentName)
// - cards: backend/app/schemas/card.py and backend/app/engine/cost.py
// - origins: backend/app/schemas/origin.py
// - decks: backend/app/schemas/deck.py (MAX_COPIES, MAX_DECK_SIZE). A ruleset's deck rules are
//   stricter, and the deck builder shows them as information only.
// - art: backend/app/services/upload_service.py and the `upload_max_bytes` setting (default 2 MiB)

export const NAME_MAX_LENGTH = 40;

export const MANA_MIN = 0;
export const MANA_MAX = 10;
export const HP_MIN = 1;
export const HP_MAX = 99;
export const CREATURE_DMG_MIN = 0;
export const CREATURE_DMG_MAX = 99;
/** A spell's damage or heal amount, as the user types it. A heal is sent as a negative number. */
export const SPELL_AMOUNT_MIN = 1;
export const SPELL_AMOUNT_MAX = 99;

export const MAX_ABILITIES = 2;
export const MAX_FIELD_EFFECTS = 3;

/** Copies of one card in a deck. */
export const MAX_COPIES = 4;
/** Cards in a deck, every copy counted. */
export const MAX_DECK_SIZE = 60;

export const ART_CONTENT_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];
export const ART_MAX_BYTES = 2 * 1024 * 1024;
