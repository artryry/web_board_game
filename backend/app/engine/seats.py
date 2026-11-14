"""The two seats at the table. The engine never sees users: M6 maps users to seats."""

from typing import Final, Literal

Seat = Literal[0, 1]

# Seat 0 takes the first turn.
SEATS: Final[tuple[Seat, Seat]] = (0, 1)


def other(seat: Seat) -> Seat:
    return 1 if seat == 0 else 0
