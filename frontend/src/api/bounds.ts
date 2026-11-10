// Input limits copied from the backend, so the editors can answer as the user types. They are
// input limits, not game rules, and the server checks every one of them again:
// - names: backend/app/schemas/common.py (ContentName)
// - cards: backend/app/schemas/card.py and backend/app/engine/cost.py
// - origins: backend/app/schemas/origin.py
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

export const ART_CONTENT_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];
export const ART_MAX_BYTES = 2 * 1024 * 1024;
