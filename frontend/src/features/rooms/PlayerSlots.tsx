import { CircleCheck, CircleDashed, Wifi, WifiOff } from "lucide-react";

import type { RoomPlayer } from "@/api/hooks/useRooms";

import type { RoomPlayers } from "./roomPlayers";

/** The room's two seats, host first. The opponent's deck is never named, only "chosen". */
export function PlayerSlots({ players }: { players: RoomPlayers }) {
  const { host, guest, me } = players;
  return (
    <section aria-labelledby="players-title" className="flex flex-col gap-4">
      <h2 id="players-title" className="text-lg font-semibold">
        Players
      </h2>
      <ul aria-labelledby="players-title" className="flex flex-col gap-3">
        {host !== undefined && <PlayerSlot player={host} isMe={host.user_id === me?.user_id} />}
        {guest === undefined ? (
          <li className="rounded-lg border border-dashed border-border-strong px-4 py-3 text-text-muted">
            Waiting for a player. Share the code or the link.
          </li>
        ) : (
          <PlayerSlot player={guest} isMe={guest.user_id === me?.user_id} />
        )}
      </ul>
    </section>
  );
}

function PlayerSlot({ player, isMe }: { player: RoomPlayer; isMe: boolean }) {
  const roles = [player.is_host && "host", isMe && "you"].filter(Boolean).join(", ");
  const Online = player.connected ? Wifi : WifiOff;
  const Ready = player.ready ? CircleCheck : CircleDashed;

  return (
    <li
      aria-label={player.username}
      className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {player.username}
          {roles !== "" && <span className="font-normal text-text-muted"> ({roles})</span>}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 text-sm ${player.connected ? "text-success" : "text-text-muted"}`}
        >
          <Online aria-hidden="true" className="size-4" />
          {player.connected ? "Online" : "Offline"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
        <span>{player.has_deck ? "Deck chosen" : "No deck yet"}</span>
        <span aria-hidden="true">·</span>
        <span className={`inline-flex items-center gap-1 ${player.ready ? "text-success" : ""}`}>
          <Ready aria-hidden="true" className="size-4" />
          {player.ready ? "Ready" : "Not ready"}
        </span>
      </div>
    </li>
  );
}
