#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a

[ -z "${WORKER_URL:-}" ] && { echo "ERROR: WORKER_URL not set in .env"; exit 1; }
[ -z "${CTF_USER:-}" ] && { echo "ERROR: CTF_USER not set in .env. Run /init first."; exit 1; }

CHALLENGE_NAME="${1:-}"
if [ -z "$CHALLENGE_NAME" ]; then
  INPUT="$(cat 2>/dev/null || echo '{}')"
  CHALLENGE_NAME=$(echo "$INPUT" | jq -r '.args // .prompt // .text // empty' | sed 's/^\/undoStart\s*//' | xargs)
fi

if [ -z "$CHALLENGE_NAME" ] || [ "$CHALLENGE_NAME" = "null" ]; then
  echo "Usage: /undoStart <challenge-name>"
  echo "Example: /undoStart web-exploit"
  exit 1
fi

RESPONSE=$(curl -sS -X POST "$WORKER_URL/undoStart" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg user "$CTF_USER" --arg challengeName "$CHALLENGE_NAME" '{$user, $challengeName}')")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" = "true" ]; then
  echo "Undid start for $CHALLENGE_NAME. You are no longer working on it."

  STATE_FILE="$PROJECT_DIR/.ctf-state.json"
  [ -f "$STATE_FILE" ] && rm -f "$STATE_FILE"
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
  echo "UndoStart failed: $ERROR"
  exit 1
fi
