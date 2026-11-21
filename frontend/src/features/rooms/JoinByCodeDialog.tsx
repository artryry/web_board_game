import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { ApiError, errorMessage } from "@/api/errors";
import { handOffRoom, useJoinRoom } from "@/api/hooks/useRooms";
import { normalizeShareCode } from "@/features/share/shareLink";
import { Button } from "@/ui/Button";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { Modal } from "@/ui/Modal";
import { TextField } from "@/ui/TextField";

/** The refusals that are about the code: they show at the field, so a typo can be fixed. */
const CODE_ERRORS: Readonly<Record<string, string>> = {
  room_not_found: "No room has this code. It may have closed.",
  room_full: "This room is full, or its game has started.",
};

interface JoinByCodeDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Joins a room by its code, then opens it (UC10). */
export function JoinByCodeDialog({ open, onClose }: JoinByCodeDialogProps) {
  return (
    <Modal open={open} title="Join a room" onClose={onClose} size="sm">
      <JoinForm />
    </Modal>
  );
}

function JoinForm() {
  const [code, setCode] = useState("");
  const [empty, setEmpty] = useState(false);
  const join = useJoinRoom();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const codeError = join.error instanceof ApiError ? CODE_ERRORS[join.error.code] : undefined;
  const otherError = join.error !== null && codeError === undefined ? join.error : null;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        // Case and spaces don't matter; the server decides whether the code is a room.
        const normalized = normalizeShareCode(code);
        setEmpty(normalized === "");
        if (normalized === "") return;
        join.mutate(normalized, {
          onSuccess: (room) => {
            handOffRoom(queryClient, room);
            void navigate(`/room/${room.code}`);
          },
        });
      }}
    >
      <TextField
        label="Room code"
        value={code}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        data-autofocus
        error={empty ? "Enter the room's code." : codeError}
        onChange={(event) => {
          setCode(event.target.value);
          setEmpty(false);
          join.reset();
        }}
      />
      {otherError !== null && <ErrorAlert>{errorMessage(otherError)}</ErrorAlert>}
      <div className="flex justify-end">
        <Button type="submit" busy={join.isPending}>
          Join
        </Button>
      </div>
    </form>
  );
}
