#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a

[ -z "${WORKER_URL:-}" ] && { echo "ERROR: WORKER_URL not set in .env"; exit 1; }

CHALLENGE_NAME="${1:-}"
if [ -z "$CHALLENGE_NAME" ]; then
  INPUT="$(cat 2>/dev/null || echo '{}')"
  CHALLENGE_NAME=$(echo "$INPUT" | jq -r '.args // .prompt // .text // empty' | sed 's/^\/undoFinish\s*//' | xargs)
fi

if [ -z "$CHALLENGE_NAME" ] || [ "$CHALLENGE_NAME" = "null" ]; then
  echo "Usage: /undoFinish <challenge-name>"
  echo "Example: /undoFinish web-exploit"
  exit 1
fi

RESPONSE=$(curl -sS -X POST "$WORKER_URL/undoFinish" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg challengeName "$CHALLENGE_NAME" '{$challengeName}')")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" = "true" ]; then
  RESTORED_TO=$(echo "$RESPONSE" | jq -r '.data.restoredTo // "active"')
  echo "Undid finish for $CHALLENGE_NAME. Moved back to $RESTORED_TO."
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
  echo "Undo failed: $ERROR"
  exit 1
fi
