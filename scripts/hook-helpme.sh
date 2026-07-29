#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
STATE_FILE="$PROJECT_DIR/.ctf-state.json"
PENDING_FILE="$PROJECT_DIR/.ctf-helpme-pending"
ENV_FILE="$PROJECT_DIR/.env"

[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a

[ -z "${CTF_USER:-}" ] && { echo "ERROR: CTF_USER not set. Run /init first."; exit 1; }
[ -z "${WORKER_URL:-}" ] && { echo "ERROR: WORKER_URL not set in .env"; exit 1; }

YES_FLAG=false
for arg in "$@"; do
  [ "$arg" = "--yes" ] && YES_FLAG=true
done

# --- Pending confirmation? Execute. ---
if [ -f "$PENDING_FILE" ]; then
  PENDING_CHANNEL=$(jq -r '.channelId // empty' "$PENDING_FILE")
  PENDING_NAME=$(jq -r '.challengeName // empty' "$PENDING_FILE")

  if [ -z "$PENDING_CHANNEL" ] || [ "$PENDING_CHANNEL" = "null" ]; then
    rm -f "$PENDING_FILE"
    echo "Corrupted pending state. Please run /helpme again."
    exit 1
  fi

  RESPONSE=$(curl -sS -X POST "$WORKER_URL/helpme" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg user "$CTF_USER" --arg channelId "$PENDING_CHANNEL" \
      '{$user, $channelId}')")

  rm -f "$PENDING_FILE"

  OK=$(echo "$RESPONSE" | jq -r '.ok // false')
  if [ "$OK" = "true" ]; then
    MOVED=$(echo "$RESPONSE" | jq -r '.data.moved // false')
    if [ "$MOVED" = "true" ]; then
      echo "$PENDING_NAME moved to help-me."
    else
      echo "$PENDING_NAME is already in help-me."
    fi
  else
    ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
    echo "Helpme failed: $ERROR"
    exit 1
  fi
  exit 0
fi

# --- First call: show confirmation ---
if [ "$YES_FLAG" = "true" ]; then
  echo "No pending helpme confirmation found. Run without --yes first."
  exit 1
fi

if [ ! -f "$STATE_FILE" ]; then
  echo "No active challenge. Run /start first."
  exit 1
fi

CHALLENGE_NAME=$(jq -r '.challengeName // empty' "$STATE_FILE")
CHANNEL_ID=$(jq -r '.channelId // empty' "$STATE_FILE")

if [ -z "$CHALLENGE_NAME" ] || [ "$CHALLENGE_NAME" = "null" ]; then
  echo "Could not determine challenge name. Run /start first."
  exit 1
fi

jq -n --arg challengeName "$CHALLENGE_NAME" --arg channelId "$CHANNEL_ID" \
  '{$challengeName, $channelId}' > "$PENDING_FILE"

echo "Move \"$CHALLENGE_NAME\" to help-me? This is a shared claim — everyone in the channel sees it."
