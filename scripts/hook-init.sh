#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a

[ -z "${WORKER_URL:-}" ] && { echo "ERROR: WORKER_URL not set in .env"; exit 1; }

DISPLAY_NAME="${1:-${CTF_USER:-}}"
if [ -z "$DISPLAY_NAME" ]; then
  INPUT="$(cat 2>/dev/null || echo '{}')"
  DISPLAY_NAME=$(echo "$INPUT" | jq -r '.args // .prompt // .text // empty' | sed 's/^\/init\s*//' | xargs)
fi

if [ -z "$DISPLAY_NAME" ] || [ "$DISPLAY_NAME" = "null" ]; then
  echo "Usage: /init <your-discord-display-name>"
  echo "Example: /init alice"
  exit 1
fi

RESPONSE=$(curl -sS -X POST "$WORKER_URL/init" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg user "$DISPLAY_NAME" '{$user}')")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" = "true" ]; then
  if ! grep -q "^CTF_USER=" "$ENV_FILE" 2>/dev/null; then
    echo "CTF_USER=$DISPLAY_NAME" >> "$ENV_FILE"
  fi
  echo "Initialized as $DISPLAY_NAME. You're on the team board."
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
  echo "Init failed: $ERROR"
  exit 1
fi
