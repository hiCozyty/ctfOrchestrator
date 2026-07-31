#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
STATE_FILE="$PROJECT_DIR/.ctf-state.json"
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
  if [ -f "$STATE_FILE" ]; then
    CURRENT=$(jq -r '.current // empty' "$STATE_FILE")
    if [ -n "$CURRENT" ] && [ "$CURRENT" != "null" ]; then
      CHALLENGE_NAME=$(jq -r --arg sid "$CURRENT" '.sessions[$sid].challenge // empty' "$STATE_FILE")
    fi
  fi
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

  if [ -f "$STATE_FILE" ]; then
    jq --arg name "$CHALLENGE_NAME" '.sessions |= with_entries(select(.value.challenge != $name))' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
    NEW_CURRENT=$(jq -r \
      'if .sessions[.current] | not then (.sessions | keys[0] // empty) else .current end' "$STATE_FILE")
    if [ -z "$NEW_CURRENT" ] || [ "$NEW_CURRENT" = "null" ]; then
      rm -f "$STATE_FILE"
    else
      jq --arg c "$NEW_CURRENT" '.current = $c' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
    fi
  fi
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
  echo "UndoStart failed: $ERROR"
  exit 1
fi
