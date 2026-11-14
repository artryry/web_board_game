import ast
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[2] / "app" / "engine"
LOGGING = {"logging", "structlog"}
# Randomness goes through engine/rng.py with the game's seed; the engine reads no clock and does
# no I/O (coding-standards §2).
IMPURE = {
    "random",
    "secrets",
    "time",
    "datetime",
    "os",
    "io",
    "pathlib",
    "socket",
    "asyncio",
    "httpx",
    "fastapi",
    "sqlalchemy",
    "redis",
    "aioboto3",
    "botocore",
}


def _imported_modules(source: str) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            modules.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None and node.level == 0:
            modules.add(node.module.split(".")[0])
    return modules


def _offenders(forbidden: set[str]) -> dict[str, list[str]]:
    imports = {
        str(path.relative_to(ENGINE)): _imported_modules(path.read_text("utf-8"))
        for path in ENGINE.rglob("*.py")
    }
    assert imports, "no engine modules found"
    return {path: sorted(names & forbidden) for path, names in imports.items() if names & forbidden}


def test_the_engine_never_logs() -> None:
    # The engine stays pure: it returns errors and events, and the service that runs it logs.
    assert _offenders(LOGGING) == {}


def test_the_engine_has_no_clock_io_or_outside_randomness() -> None:
    assert _offenders(IMPURE) == {}
