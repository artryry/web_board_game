"""A room in Redis (backend_plan §9.1): one hash per room, `room:{code}` = `{rev, data}`.

`data` holds the lobby and the game as JSON; `rev` goes up by one on every write. Every write is a
compare-and-set on `rev` in one Lua script: during a deploy the old and the new instance can both
hold a room for a few seconds, and this stops one from overwriting the other. The script reads
only `rev`, never the JSON, which can be tens of KB.
"""

from typing import NoReturn
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from redis.asyncio import Redis

from app.core.config import Settings
from app.core.logging_config import get_logger
from app.engine.seats import Seat
from app.engine.snapshots import DeckSnapshot
from app.engine.state import GameState
from app.schemas.room import RoomStatus
from app.schemas.rules import RulesetDefinition

log = get_logger(__name__)

# ARGV: the expected rev ("" = the key must not exist), the new rev, the data, the TTL in seconds.
# Returns 1 when written, 0 when the rev didn't match, -1 when the key is gone. Integers only:
# under RESP3 a Lua boolean would come back as a Python bool.
_SAVE_SCRIPT = """
local current = redis.call('HGET', KEYS[1], 'rev')
if ARGV[1] == '' then
  if current then return 0 end
elseif not current then
  return -1
elseif current ~= ARGV[1] then
  return 0
end
redis.call('HSET', KEYS[1], 'rev', ARGV[2], 'data', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
"""

# ARGV: the expected rev. Returns as the save script does.
_DELETE_SCRIPT = """
local current = redis.call('HGET', KEYS[1], 'rev')
if not current then return -1 end
if current ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
"""


class _Stored(BaseModel):
    # Frozen: a change builds a new room (`model_copy(update=...)`), so the cached copy stays as
    # it was until the write has succeeded.
    model_config = ConfigDict(extra="forbid", frozen=True)


class StoredRuleset(_Stored):
    id: UUID
    name: str
    # Copied when the room is created; later edits to the ruleset never reach the room.
    definition: RulesetDefinition


class StoredDeck(_Stored):
    id: UUID
    name: str
    # Copied when the deck is selected.
    snapshot: DeckSnapshot


class RoomMember(_Stored):
    user_id: UUID
    username: str
    deck: StoredDeck | None = None
    ready: bool = False
    # Set when the game starts.
    seat: Seat | None = None
    # Unix ms since when the player has had no socket during a game.
    away_since: int | None = None


class Room(_Stored):
    code: str
    status: RoomStatus = "lobby"
    # Kept in the hash next to the data, not in it; 0 means not stored yet.
    rev: int = 0
    ruleset: StoredRuleset
    host: RoomMember
    guest: RoomMember | None = None
    # The game, from its start: its id (for logs now, and M7's saved game), the engine state,
    # and when the current phase ends on its own (Unix ms; null outside interactive phases).
    game_id: UUID | None = None
    state: GameState | None = None
    deadline: int | None = None
    started_at: int | None = None
    ended_at: int | None = None

    def members(self) -> list[RoomMember]:
        return [self.host] if self.guest is None else [self.host, self.guest]

    def member(self, user_id: UUID) -> RoomMember | None:
        return next((member for member in self.members() if member.user_id == user_id), None)

    def member_at(self, seat: Seat) -> RoomMember | None:
        return next((member for member in self.members() if member.seat == seat), None)

    def with_member(self, member: RoomMember) -> "Room":
        """The room with `member` replacing the member of the same user."""
        if member.user_id == self.host.user_id:
            return self.model_copy(update={"host": member})
        if self.guest is not None and member.user_id == self.guest.user_id:
            return self.model_copy(update={"guest": member})
        raise ValueError("Not a member of this room")


class StaleRoom(Exception):
    """A write lost its compare-and-set: another write came first, or the key is gone."""

    def __init__(self, code: str, missing: bool) -> None:
        super().__init__(f"Room {code} changed or is gone")
        self.code = code
        self.missing = missing


class RoomExists(Exception):
    """A new room's code is already taken."""


def room_key(code: str) -> str:
    return f"room:{code}"


class RoomStore:
    def __init__(self, redis: Redis, settings: Settings) -> None:
        self._redis = redis
        self._room_ttl_s = settings.room_ttl_h * 3600
        self._finished_ttl_s = settings.finished_room_ttl_min * 60
        self._save_script = redis.register_script(_SAVE_SCRIPT)
        self._delete_script = redis.register_script(_DELETE_SCRIPT)

    async def load(self, code: str) -> Room | None:
        rev, data = await self._redis.hmget(room_key(code), ["rev", "data"])
        if rev is None or data is None:
            return None
        return Room.model_validate_json(data).model_copy(update={"rev": int(rev)})

    async def create(self, room: Room) -> Room:
        """Stores a new room, unless its code is taken (`RoomExists`)."""
        created = room.model_copy(update={"rev": 1})
        if await self._write(created, expected="") != 1:
            raise RoomExists(room.code)
        return created

    async def save(self, room: Room) -> Room:
        """Writes `room` over the stored one, if that is still at `room.rev`. Returns the room at
        its new rev; raises `StaleRoom` if the compare-and-set loses."""
        saved = room.model_copy(update={"rev": room.rev + 1})
        result = await self._write(saved, expected=str(room.rev))
        if result != 1:
            self._conflict(room, missing=result == -1)
        return saved

    async def delete(self, room: Room) -> None:
        result = await self._delete_script(keys=[room_key(room.code)], args=[str(room.rev)])
        if result != 1:
            self._conflict(room, missing=result == -1)

    async def _write(self, room: Room, expected: str) -> int:
        ttl_s = self._finished_ttl_s if room.status == "finished" else self._room_ttl_s
        result: int = await self._save_script(
            keys=[room_key(room.code)],
            args=[expected, str(room.rev), room.model_dump_json(exclude={"rev"}), ttl_s],
        )
        return result

    def _conflict(self, room: Room, missing: bool) -> NoReturn:
        log.warning("room.store_conflict", room_code=room.code, rev=room.rev, missing=missing)
        raise StaleRoom(room.code, missing)
