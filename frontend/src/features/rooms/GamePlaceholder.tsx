import { useState } from "react";

import type { RoomState } from "@/api/hooks/useRooms";
import { useCurrentUser } from "@/auth/useAuth";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { LoadingState } from "@/ui/LoadingState";
import { useGameStore, type GameResult as Outcome } from "@/ws/gameStore";

import { AwayCountdown } from "./AwayCountdown";
import { GameResult } from "./GameResult";
import { roomPlayers } from "./roomPlayers";

interface GamePlaceholderProps {
  room: RoomState;
  /** The socket is connected; while it isn't, Surrender can't be sent. */
  live: boolean;
}

/**
 * The started game until F5 brings the board: who goes first, an opponent who's away, Surrender,
 * and then the result.
 */
export function GamePlaceholder({ room, live }: GamePlaceholderProps) {
  const user = useCurrentUser();
  const { me, opponent } = roomPlayers(room, user.id);
  const game = useGameStore((state) => state.game);
  const result = useGameStore((state) => state.result);
  const opponentName = opponent?.username ?? "Your opponent";
  const mySeat = me?.seat ?? game?.view.seat ?? null;

  // A reload of a finished room gets no `game_over`, only the view, which has the result too.
  const view = game?.view;
  const outcome: Outcome | null =
    result ??
    (view?.status === "finished" && view.end_reason !== null
      ? { winner: view.winner, reason: view.end_reason }
      : null);

  if (mySeat === null) return <LoadingState error={null} />;
  if (outcome !== null) {
    return <GameResult outcome={outcome} mySeat={mySeat} opponent={opponentName} />;
  }
  if (room.status === "finished") return <LoadingState error={null} />;

  const firstSeat = room.players.find((player) => player.seat === 0);
  const awaySince = opponent?.away_since ?? null;
  return (
    <section aria-labelledby="game-title" className="flex flex-col gap-4">
      <h1 id="game-title" className="text-2xl font-semibold">
        Game in progress
      </h1>
      <p>
        {firstSeat === undefined || firstSeat.user_id === user.id
          ? "You play first"
          : `${firstSeat.username} plays first`}
      </p>
      <p className="text-sm text-text-muted">The game board comes in a later version.</p>
      {awaySince !== null && <AwayCountdown name={opponentName} awaySince={awaySince} />}
      <div>
        <SurrenderButton opponent={opponentName} disabled={!live} />
      </div>
    </section>
  );
}

function SurrenderButton({ opponent, disabled }: { opponent: string; disabled: boolean }) {
  const surrender = useGameStore((state) => state.surrender);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant="danger"
        disabled={disabled}
        onClick={() => {
          setConfirming(true);
        }}
      >
        Surrender
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Surrender?"
        confirmLabel="Surrender"
        onConfirm={() => {
          setConfirming(false);
          surrender();
        }}
        onClose={() => {
          setConfirming(false);
        }}
      >
        <p>{opponent} wins.</p>
      </ConfirmDialog>
    </>
  );
}
