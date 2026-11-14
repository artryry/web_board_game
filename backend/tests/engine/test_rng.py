import pytest

from app.engine.rng import Rng


@pytest.mark.parametrize(
    ("seed", "expected"),
    [
        # The reference SplitMix64 (Vigna's splitmix64.c) gives these first outputs.
        (0, [0xE220A8397B1DCDAF, 0x6E789E6AA1B965F4, 0x06C45D188009454F]),
        (1234567, [6457827717110365317, 3203168211198807973, 9817491932198370423]),
    ],
)
def test_a_seed_gives_the_reference_sequence(seed: int, expected: list[int]) -> None:
    rng = Rng(seed)

    assert [rng.next_u64() for _ in expected] == expected


def test_the_state_resumes_the_sequence() -> None:
    first = Rng(42)
    first.next_u64()
    resumed = Rng(first.state)

    assert resumed.next_u64() == first.next_u64()


def test_negative_seeds_wrap_to_64_bits() -> None:
    assert Rng(-1).state == (1 << 64) - 1


def test_randbelow_stays_in_range() -> None:
    rng = Rng(7)

    values = {rng.randbelow(3) for _ in range(200)}

    assert values == {0, 1, 2}
    with pytest.raises(ValueError):
        rng.randbelow(0)


def test_shuffle_is_a_fixed_permutation_for_a_seed() -> None:
    items = list(range(10))
    first, second = list(items), list(items)

    Rng(99).shuffle(first)
    Rng(99).shuffle(second)

    assert first == second
    assert sorted(first) == items
    assert first != items
