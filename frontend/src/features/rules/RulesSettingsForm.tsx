import { BoardThumbnail } from "./BoardThumbnail";
import { ManaModeField } from "./ManaModeField";
import { SettingCheckbox } from "./SettingCheckbox";
import { SettingNumber } from "./SettingNumber";

const GROUP = "flex flex-col gap-3 rounded-lg border border-border bg-surface p-4";
const LEGEND = "px-1 font-semibold";
const ROW = "flex flex-wrap gap-4";

/** The fixed settings: board, deck, mana and hand. */
export function RulesSettingsForm({ readOnly }: { readOnly: boolean }) {
  return (
    <section aria-labelledby="rules-settings-title" className="flex flex-col gap-4">
      <h2 id="rules-settings-title" className="text-lg font-semibold">
        Settings
      </h2>
      <fieldset disabled={readOnly} className="flex flex-col gap-4">
        <fieldset className={GROUP}>
          <legend className={LEGEND}>Board</legend>
          <div className={ROW}>
            <SettingNumber path="board.lanes" />
            <SettingNumber path="board.slots_per_section" />
            <SettingNumber path="board.section_hp" />
          </div>
          <BoardThumbnail />
        </fieldset>
        <fieldset className={GROUP}>
          <legend className={LEGEND}>Deck</legend>
          <div className={ROW}>
            <SettingNumber path="deck.size" />
            <SettingNumber path="deck.max_copies" />
          </div>
          <SettingCheckbox path="deck.allow_neutral" />
        </fieldset>
        <fieldset className={GROUP}>
          <legend className={LEGEND}>Mana</legend>
          <div className={ROW}>
            <SettingNumber path="mana.start" />
            <SettingNumber path="mana.per_turn" />
            <SettingNumber path="mana.max" />
          </div>
          <ManaModeField />
        </fieldset>
        <fieldset className={GROUP}>
          <legend className={LEGEND}>Hand</legend>
          <SettingNumber path="hand.max_size" />
          <SettingCheckbox path="hand.second_player_bonus_card" />
          <p className="text-sm text-text-muted">
            The starting hand is whatever the Setup phases draw.
          </p>
        </fieldset>
      </fieldset>
    </section>
  );
}
