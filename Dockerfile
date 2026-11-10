# Production image: the API serves the built frontend, so the app and /api share one origin.
# Build from the repo root:  docker build -t card-table .

# 1. Build the frontend.
FROM node:24.22.2-alpine3.24 AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2. The API, with the built frontend next to it.
FROM python:3.12.16-slim-trixie
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# backend/ goes to /srv/backend, not /app: config.py looks for a .env three levels up, and that
# path must exist (there is no .env in the image; settings come from the environment).
WORKDIR /srv/backend
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ ./
COPY --from=frontend /src/frontend/dist /srv/frontend/dist
ENV FRONTEND_DIST_DIR=/srv/frontend/dist

RUN useradd --system --no-create-home app
USER app

EXPOSE 8000
CMD ["sh", "scripts/start.sh"]
