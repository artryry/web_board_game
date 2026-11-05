import secrets

# Codes people read and type (share codes, and room codes in M6): digits and capital letters
# without the look-alikes 0/O and 1/I/L. 31 characters, so each one adds about 4.95 bits.
CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def random_code(length: int) -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))
