"""The time source for room deadlines and timers, so tests can move time instead of sleeping.

Times are Unix milliseconds: the client counts down to them, and they survive a restart in Redis.
"""

import asyncio
import time
from typing import Protocol


class Clock(Protocol):
    def now_ms(self) -> int: ...

    async def sleep_until(self, when_ms: int) -> None: ...


class SystemClock:
    def now_ms(self) -> int:
        return time.time_ns() // 1_000_000

    async def sleep_until(self, when_ms: int) -> None:
        delay_ms = when_ms - self.now_ms()
        if delay_ms > 0:
            await asyncio.sleep(delay_ms / 1000)
