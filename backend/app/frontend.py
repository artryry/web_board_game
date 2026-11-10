"""Serves the built frontend (Vite's `dist/`) from the API process, as on Render.

Page requests and the API then share one origin, which the refresh cookie needs. In development
this isn't used: nginx sends page requests to the Vite dev server.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

# Paths under these belong to the backend. A mistyped one gets the API's JSON 404, not the app.
BACKEND_PREFIXES = frozenset({"api", "ws"})


def mount_frontend(app: FastAPI, dist_dir: Path) -> None:
    """Serves `dist_dir`'s files, and its `index.html` for every other page path.

    Register it after the API routes: its catch-all route matches everything they don't. Because
    every GET path now matches a route, two framework defaults change for unknown API paths:
    `/api/cards/` gets a 404 instead of a redirect to `/api/cards`, and a POST to a path that
    doesn't exist gets a 405 instead of a 404. The generated client never sends either.
    """
    dist = dist_dir.resolve()
    index = dist / "index.html"
    if not index.is_file():
        raise RuntimeError(f"{index} is missing: build the frontend or fix FRONTEND_DIST_DIR")

    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    # A sync route, so FastAPI runs the file-system checks in its thread pool.
    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def frontend(path: str) -> FileResponse:
        if path.split("/", 1)[0] in BACKEND_PREFIXES:
            raise StarletteHTTPException(status_code=404)
        file = (dist / path).resolve()
        if path and file.is_relative_to(dist) and file.is_file():
            return FileResponse(file)
        # Anything else is a client-side route (React Router decides what it shows). no-cache
        # makes browsers revalidate it, so a new deploy's bundle names are picked up at once.
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
