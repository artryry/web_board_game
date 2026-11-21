import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router";

import { roomDecksKey, useRoomDecks, type RoomDeck, type RoomState } from "@/api/hooks/useRooms";
import { useOrigins, type Origin } from "@/api/hooks/useOrigins";
import { useCatalog, type Catalog } from "@/catalog/useCatalog";
import { deckProblemText, fromRoomProblem } from "@/features/decks/problemText";
import { OriginBadge } from "@/features/origins/OriginBadge";
import { originHex } from "@/features/origins/originLook";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { LoadingState } from "@/ui/LoadingState";
import { useGameStore, type DeckError } from "@/ws/gameStore";

interface RoomDeckPickerProps {
  room: RoomState;
  disabled: boolean;
}

/**
 * The user's decks under the room's rules (UC11). The server says which fit and why the others
 * don't. Picking one sends `select_deck` at once; the room's `my_deck` marks the chosen one.
 */
export function RoomDeckPicker({ room, disabled }: RoomDeckPickerProps) {
  const decks = useRoomDecks(room.code);
  const catalog = useCatalog();
  const origins = useOrigins();
  const deckError = useGameStore((state) => state.deckError);
  const selectDeck = useGameStore((state) => state.selectDeck);
  const queryClient = useQueryClient();

  // A refused pick means the list is out of date: the deck changed or was deleted.
  useEffect(() => {
    if (deckError !== null) {
      void queryClient.invalidateQueries({ queryKey: roomDecksKey(room.code) });
    }
  }, [deckError, queryClient, room.code]);

  if (decks.data === undefined) return <LoadingState error={decks.error} />;
  if (decks.data.length === 0) {
    return (
      <p className="text-text-muted">
        You have no decks yet.{" "}
        <Link to="/decks/new" target="_blank" rel="noreferrer" className="underline">
          Build a deck
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {deckError?.reason === "deck_not_found" && <ErrorAlert>That deck was deleted.</ErrorAlert>}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Choose a deck</legend>
        {decks.data.map((deck) => (
          <DeckOption
            key={deck.id}
            deck={deck}
            size={room.ruleset.definition.deck.size}
            chosen={room.my_deck?.id === deck.id}
            disabled={disabled}
            deckError={deckError}
            origin={origins.data?.find((origin) => origin.id === deck.origin_id)}
            catalog={catalog.data}
            onChoose={() => {
              selectDeck(deck.id);
            }}
          />
        ))}
      </fieldset>
      <p className="text-sm text-text-muted">
        The room keeps your deck as it was when you chose it. After editing it, choose it again.
      </p>
    </div>
  );
}

interface DeckOptionProps {
  deck: RoomDeck;
  size: number;
  chosen: boolean;
  disabled: boolean;
  deckError: DeckError | null;
  origin: Origin | undefined;
  catalog: Catalog | undefined;
  onChoose: () => void;
}

function DeckOption(props: DeckOptionProps) {
  const { deck, size, chosen, disabled, deckError, origin, catalog, onChoose } = props;
  // A pick the server refused shows its problems until the reloaded list has them.
  const refused = deckError?.reason === "deck_not_playable" && deckError.deckId === deck.id;
  const problems = deck.problems.length > 0 || !refused ? deck.problems : deckError.problems;
  const playable = problems.length === 0;
  const problemsId = `deck-problems-${deck.id}`;

  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border bg-surface px-4 py-3 ${chosen ? "border-accent" : "border-border"}`}
    >
      <label className={`flex items-center gap-3 ${playable ? "cursor-pointer" : ""}`}>
        <input
          type="radio"
          name="room-deck"
          value={deck.id}
          checked={chosen}
          disabled={disabled || !playable}
          aria-describedby={playable ? undefined : problemsId}
          onChange={onChoose}
          // The room keeps a copy of the chosen deck: clicking it again sends the edited one.
          onClick={() => {
            if (chosen) onChoose();
          }}
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium">{deck.name}</span>
          {origin !== undefined && catalog !== undefined && (
            <span className="text-sm text-text-muted">
              <OriginBadge
                name={origin.name}
                icon={origin.icon}
                hex={originHex(catalog, origin.color)}
              />
            </span>
          )}
          <span className="text-sm text-text-muted">
            {deck.card_count} / {size} cards
          </span>
        </span>
      </label>
      {!playable && (
        <div className="flex flex-wrap items-start justify-between gap-2 pl-7 text-sm">
          <ul id={problemsId} className="flex flex-col text-danger">
            {problems.map((problem) => (
              <li key={problem.kind}>{deckProblemText(fromRoomProblem(problem))}</li>
            ))}
          </ul>
          <Link
            to={`/decks/${deck.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            Edit deck <span className="sr-only">{deck.name}</span>
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
