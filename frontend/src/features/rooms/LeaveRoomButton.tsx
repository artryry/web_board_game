import { useState } from "react";

import type { RoomPlayer } from "@/api/hooks/useRooms";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { useGameStore } from "@/ws/gameStore";

interface LeaveRoomButtonProps {
  isHost: boolean;
  guest: RoomPlayer | undefined;
  disabled: boolean;
}

/**
 * The guest's Leave frees their seat at once. The host's Close room deletes the room and sends the
 * guest out, so it asks first.
 */
export function LeaveRoomButton({ isHost, guest, disabled }: LeaveRoomButtonProps) {
  const leave = useGameStore((state) => state.leave);
  const [confirming, setConfirming] = useState(false);

  if (!isHost) {
    return (
      <Button variant="secondary" disabled={disabled} onClick={leave}>
        Leave
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          setConfirming(true);
        }}
      >
        Close room
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Close the room?"
        confirmLabel="Close room"
        onConfirm={() => {
          setConfirming(false);
          leave();
        }}
        onClose={() => {
          setConfirming(false);
        }}
      >
        <p>
          {guest === undefined
            ? "Nobody can join it after that."
            : `${guest.username} will be sent out.`}
        </p>
      </ConfirmDialog>
    </>
  );
}
