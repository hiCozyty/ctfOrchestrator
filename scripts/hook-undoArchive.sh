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
  CHALLENGE_NAME=$(echo "$INPUT" | jq -r '.args // .prompt // .text // empty' | sed 's/^\/undoArchive\s*//' | xargs)
fi

if [ -z "$CHALLENGE_NAME" ] || [ "$CHALLENGE_NAME" = "null" ]; then
  echo "Usage: /undoArchive <challenge-name>"
  echo "Example: /undoArchive web-exploit"
  exit 1
fi

RESPONSE=$(curl -sS -X POST "$WORKER_URL/undoArchive" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg user "$CTF_USER" --arg challengeName "$CHALLENGE_NAME" '{$user, $challengeName}')")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" = "true" ]; then
  echo "Undid archive for $CHALLENGE_NAME. Ready for /start."
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
  echo "UndoArchive failed: $ERROR"
  exit 1
fi
