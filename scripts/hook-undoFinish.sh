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
  CHALLENGE_NAME=$(echo "$INPUT" | jq -r '.args // .prompt // .text // empty' | sed 's/^\/undoFinish\s*//' | xargs)
fi

if [ -z "$CHALLENGE_NAME" ] || [ "$CHALLENGE_NAME" = "null" ]; then
  echo "Usage: /undoFinish <challenge-name>"
  echo "Example: /undoFinish web-exploit"
  exit 1
fi

RESPONSE=$(curl -sS -X POST "$WORKER_URL/undoFinish" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg user "$CTF_USER" --arg challengeName "$CHALLENGE_NAME" '{$user, $challengeName}')")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" = "true" ]; then
  RESTORED_TO=$(echo "$RESPONSE" | jq -r '.data.restoredTo // "active"')
  CHANNEL_ID=$(echo "$RESPONSE" | jq -r '.data.channelId // empty')
  CANONICAL_NAME=$(echo "$RESPONSE" | jq -r '.data.challengeName // empty')

  if [ -n "$CANONICAL_NAME" ] && [ "$CANONICAL_NAME" != "null" ] && [ "$CANONICAL_NAME" != "empty" ]; then
    CHALLENGE_NAME="$CANONICAL_NAME"
  fi

  echo "Undid finish for $CHALLENGE_NAME. Moved back to $RESTORED_TO."

  if [ -n "$CHANNEL_ID" ] && [ "$CHANNEL_ID" != "null" ]; then
    SESSION_ID="${CTF_USER}-$(date +%s)-$$-${RANDOM}"
    ENTRY=$(jq -n --arg channelId "$CHANNEL_ID" --arg threadId "" --arg sessionId "$SESSION_ID" \
      '{channelId: $channelId, threadId: $threadId, sessionId: $sessionId}')

    if [ -f "$STATE_FILE" ]; then
      jq --arg name "$CHALLENGE_NAME" --argjson entry "$ENTRY" \
        '.active[$name] = $entry | .current = $name' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
    else
      jq -n --arg name "$CHALLENGE_NAME" --argjson entry "$ENTRY" \
        '{active: {($name): $entry}, current: $name}' > "$STATE_FILE"
    fi
    echo "State restored. Run /start to create a fresh sync thread."
  fi
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
  echo "Undo failed: $ERROR"
  exit 1
fi
