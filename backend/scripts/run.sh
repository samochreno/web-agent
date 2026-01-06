#!/usr/bin/env bash

# Start the Realtime assistant FastAPI backend.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

if [ ! -d ".venv" ]; then
  echo "Creating virtual env in $PROJECT_ROOT/.venv ..."
  python3 -m venv .venv
fi

source .venv/bin/activate

echo "Installing backend deps (editable) ..."
if ! python3 -m pip install -e .; then
  echo "pip install failed; retrying with --break-system-packages for externally managed environments ..."
  python3 -m pip install --break-system-packages -e .
fi

ENV_FILE="$(cd "$PROJECT_ROOT/.." && pwd)/.env.local"
if [ -f "$ENV_FILE" ]; then
  echo "Sourcing env vars from $ENV_FILE"
  existing_openai="${OPENAI_API_KEY:-}"
  # shellcheck disable=SC1090
  set -a
  . "$ENV_FILE"
  set +a
  if [ -n "$existing_openai" ]; then
    export OPENAI_API_KEY="$existing_openai"
  fi
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "Set OPENAI_API_KEY in your environment or in .env.local before running this script."
  exit 1
fi

REPO_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"
FRONTEND_TARBALL="$PROJECT_ROOT/frontend_dist.tar.gz"
if [ -f "$FRONTEND_TARBALL" ]; then
FRONTEND_DIR="$REPO_ROOT/frontend/dist"
echo "Extracting frontend build from $FRONTEND_TARBALL ..."
rm -rf "$FRONTEND_DIR"
mkdir -p "$FRONTEND_DIR"
tar -xzf "$FRONTEND_TARBALL" -C "$REPO_ROOT/frontend"

export FRONTEND_DIST_DIR="$FRONTEND_DIR"
fi

export PYTHONPATH="$PROJECT_ROOT${PYTHONPATH:+:$PYTHONPATH}"

APP_PORT="${PORT:-8080}"
echo "Starting Realtime assistant backend on http://0.0.0.0:${APP_PORT} ..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${APP_PORT}"
