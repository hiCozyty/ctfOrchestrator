#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
STATE_FILE="$PROJECT_DIR/.ctf-state.json"
PENDING_FILE="$PROJECT_DIR/.ctf-finish-pending"
ENV_FILE="$PROJECT_DIR/.env"

[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a

[ -z "${CTF_USER:-}" ] && { echo "ERROR: CTF_USER not set. Run /init first."; exit 1; }
[ -z "${WORKER_URL:-}" ] && { echo "ERROR: WORKER_URL not set in .env"; exit 1; }

YES_FLAG=false
EXPLICIT_NAME=""
for arg in "$@"; do
  if [ "$arg" = "--yes" ]; then
    YES_FLAG=true
  elif [ -z "$EXPLICIT_NAME" ]; then
    EXPLICIT_NAME="$arg"
  fi
done

if [ -z "$EXPLICIT_NAME" ]; then
  INPUT="$(cat 2>/dev/null || echo '{}')"
  EXPLICIT_NAME=$(echo "$INPUT" | jq -r '.args // .prompt // .text // empty' | sed 's/^\/finish\s*//' | xargs)
fi

# --- Pending confirmation? Execute. ---
if [ -f "$PENDING_FILE" ] && [ "$YES_FLAG" = "true" ]; then
  PENDING_CHANNEL=$(jq -r '.channelId // empty' "$PENDING_FILE")
  PENDING_NAME=$(jq -r '.challengeName // empty' "$PENDING_FILE")

  if [ -z "$PENDING_CHANNEL" ] || [ "$PENDING_CHANNEL" = "null" ]; then
    rm -f "$PENDING_FILE"
    echo "Corrupted pending state. Please run /finish again."
    exit 1
  fi

  RESPONSE=$(curl -sS -X POST "$WORKER_URL/finish" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg user "$CTF_USER" --arg channelId "$PENDING_CHANNEL" \
      '{$user, $channelId}')")

  rm -f "$PENDING_FILE"

  OK=$(echo "$RESPONSE" | jq -r '.ok // false')
  if [ "$OK" = "true" ]; then
    # Remove all sessions for this challenge from state
    if [ -f "$STATE_FILE" ]; then
      jq --arg name "$PENDING_NAME" '.sessions |= with_entries(select(.value.challenge != $name))' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
      NEW_CURRENT=$(jq -r \
        'if .sessions[.current] | not then (.sessions | keys[0] // empty) else .current end' "$STATE_FILE")
      if [ -z "$NEW_CURRENT" ] || [ "$NEW_CURRENT" = "null" ]; then
        rm -f "$STATE_FILE"
      else
        jq --arg c "$NEW_CURRENT" '.current = $c' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
      fi
    fi

    MOVED=$(echo "$RESPONSE" | jq -r '.data.moved // false')
    if [ "$MOVED" = "true" ]; then
      NEW_SOLVER=$(echo "$RESPONSE" | jq -r '.data.solverName // ""')
      echo "$PENDING_NAME solved by $NEW_SOLVER! Challenge moved to finished."
    else
      REMAINING=$(echo "$RESPONSE" | jq -r '.data.remainingActiveUsers // "?"')
      echo "Noted. $REMAINING other user(s) still working on $PENDING_NAME. Channel stays in place."
    fi
  else
    ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
    echo "Finish failed: $ERROR"
    exit 1
  fi
  exit 0
fi

# --- First call: show confirmation ---
if [ "$YES_FLAG" = "true" ]; then
  echo "No pending finish confirmation found. Run without --yes first."
  exit 1
fi

if [ -n "$EXPLICIT_NAME" ] && [ "$EXPLICIT_NAME" != "null" ]; then
  CHALLENGE_NAME="$EXPLICIT_NAME"
  CHANNEL_ID=""
  SESSION_ID=""
  if [ -f "$STATE_FILE" ]; then
    SESSION_ID=$(jq -r --arg name "$CHALLENGE_NAME" \
      '.sessions | to_entries[] | select(.value.challenge == $name) | .key' "$STATE_FILE" | head -1)
    CHANNEL_ID=$(jq -r --arg sid "$SESSION_ID" '.sessions[$sid].channelId // empty' "$STATE_FILE")
  fi
else
  if [ ! -f "$STATE_FILE" ]; then
    echo "No active challenge. Run /start first."
    exit 1
  fi

  SESSION_COUNT=$(jq '.sessions | length' "$STATE_FILE")
  if [ "$SESSION_COUNT" -eq 0 ]; then
    echo "No active challenge. Run /start first."
    exit 1
  elif [ "$SESSION_COUNT" -eq 1 ]; then
    SESSION_ID=$(jq -r '.sessions | keys[0]' "$STATE_FILE")
    CHALLENGE_NAME=$(jq -r --arg sid "$SESSION_ID" '.sessions[$sid].challenge' "$STATE_FILE")
    CHANNEL_ID=$(jq -r --arg sid "$SESSION_ID" '.sessions[$sid].channelId' "$STATE_FILE")
  else
    CURRENT=$(jq -r '.current // empty' "$STATE_FILE")
    if [ -z "$CURRENT" ] || [ "$CURRENT" = "null" ]; then
      echo "Multiple active sessions. Specify which challenge:"
       jq -r '[.sessions[].challenge] | unique[] | "  \(.)"' "$STATE_FILE"
      echo "Usage: /finish <challenge-name>"
      exit 1
    fi
    SESSION_ID="$CURRENT"
    CHALLENGE_NAME=$(jq -r --arg sid "$SESSION_ID" '.sessions[$sid].challenge' "$STATE_FILE")
    CHANNEL_ID=$(jq -r --arg sid "$SESSION_ID" '.sessions[$sid].channelId' "$STATE_FILE")
  fi
fi

if [ -z "$CHALLENGE_NAME" ] || [ "$CHALLENGE_NAME" = "null" ]; then
  echo "Could not determine challenge name. Try: /finish <challenge-name>"
  exit 1
fi

if [ -z "$CHANNEL_ID" ] || [ "$CHANNEL_ID" = "null" ]; then
  LOOKUP=$(curl -sS -X POST "$WORKER_URL/lookup" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg challengeName "$CHALLENGE_NAME" '{$challengeName}')" || echo '{"ok":false}')
  LOOKUP_OK=$(echo "$LOOKUP" | jq -r '.ok // false')
  if [ "$LOOKUP_OK" != "true" ]; then
    echo "Could not find channel for $CHALLENGE_NAME. Has /start been run?"
    exit 1
  fi
  CHANNEL_ID=$(echo "$LOOKUP" | jq -r '.data.channelId // empty')
fi

jq -n --arg challengeName "$CHALLENGE_NAME" --arg channelId "$CHANNEL_ID" \
  '{$challengeName, $channelId}' > "$PENDING_FILE"

echo "Are you sure you found the correct flag for \"$CHALLENGE_NAME\"?"
