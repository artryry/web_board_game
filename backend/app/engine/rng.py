"""The engine's only source of randomness: SplitMix64, seeded from the game.

Its whole state is one 64-bit integer, which `GameState.rng_state` stores, so a saved game
resumes with exactly the same numbers. It is our own code, so no Python upgrade can change a
shuffle (Python only promises that `random.random()` stays the same across versions).
"""

_MASK = (1 << 64) - 1
_GOLDEN_GAMMA = 0x9E3779B97F4A7C15


class Rng:
    def __init__(self, state: int) -> None:
        self.state = state & _MASK

    def next_u64(self) -> int:
        self.state = (self.state + _GOLDEN_GAMMA) & _MASK
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & _MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & _MASK
        return z ^ (z >> 31)

    def randbelow(self, n: int) -> int:
        """A number in [0, n). Values from the uneven top of the range are drawn again, so every
        result is equally likely."""
        if n <= 0:
            raise ValueError("n must be positive")
        limit = (1 << 64) - (1 << 64) % n
        while True:
            value = self.next_u64()
            if value < limit:
                return value % n

    def shuffle[T](self, items: list[T]) -> None:
        """Fisher–Yates, in place."""
        for i in range(len(items) - 1, 0, -1):
            j = self.randbelow(i + 1)
            items[i], items[j] = items[j], items[i]
