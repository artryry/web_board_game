import ast
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[2] / "app" / "engine"
FORBIDDEN = {"logging", "structlog"}


def _imported_modules(source: str) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            modules.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None and node.level == 0:
            modules.add(node.module.split(".")[0])
    return modules


def test_the_engine_never_logs() -> None:
    # The engine stays pure: it returns errors and events, and the service that runs it logs.
    offenders = {
        str(path.relative_to(ENGINE)): sorted(
            _imported_modules(path.read_text("utf-8")) & FORBIDDEN
        )
        for path in ENGINE.rglob("*.py")
    }

    assert {path: names for path, names in offenders.items() if names} == {}
    assert offenders, "no engine modules found"
