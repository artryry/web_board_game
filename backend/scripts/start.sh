#!/bin/sh
# Production entrypoint (the Docker image's CMD): apply migrations, then serve.
# Render's free plan has no pre-deploy step, so migrations run on every start. There is a single
# instance, so two starts never race. On a paid plan, move `alembic upgrade head` to
# preDeployCommand in render.yaml.
set -eu

alembic upgrade head

# Render terminates TLS and forwards plain HTTP: trust its X-Forwarded-* headers so the app
# sees https URLs and the real client IP. One worker: room locks live in-process.
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips "*"
