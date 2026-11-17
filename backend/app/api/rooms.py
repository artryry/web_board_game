from fastapi import APIRouter, status

from app.core.deps import CurrentUser, Db, Pagination, Rooms
from app.schemas.common import Page
from app.schemas.room import RoomCreate, RoomDeckOut, RoomJoin, RoomState
from app.services import room_service

router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.post("", response_model=RoomState, status_code=status.HTTP_201_CREATED)
async def create_room(data: RoomCreate, user: CurrentUser, db: Db, rooms: Rooms) -> RoomState:
    return await room_service.create_room(rooms, db, user, data.ruleset_id)


@router.post("/join", response_model=RoomState)
async def join_room(data: RoomJoin, user: CurrentUser, rooms: Rooms) -> RoomState:
    return await room_service.join_room(rooms, user, data.code)


@router.get("/{code}", response_model=RoomState)
async def get_room(code: str, user: CurrentUser, rooms: Rooms) -> RoomState:
    return await room_service.get_room(rooms, user.id, code)


@router.get("/{code}/decks", response_model=Page[RoomDeckOut])
async def room_decks(
    code: str, user: CurrentUser, db: Db, rooms: Rooms, page: Pagination
) -> Page[RoomDeckOut]:
    items, total = await room_service.room_decks(rooms, db, user.id, code, page)
    return Page[RoomDeckOut](items=items, total=total)
