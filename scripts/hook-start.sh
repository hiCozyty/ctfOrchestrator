#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a

[ -z "${CTF_USER:-}" ] && { echo "ERROR: CTF_USER not set. Run /init first."; exit 1; }
[ -z "${WORKER_URL:-}" ] && { echo "ERROR: WORKER_URL not set in .env"; exit 1; }

CHALLENGE="${1:-}"
if [ -z "$CHALLENGE" ]; then
  INPUT="$(cat 2>/dev/null || echo '{}')"
  CHALLENGE=$(echo "$INPUT" | jq -r '.args // .prompt // .text // empty' | sed 's/^\/start\s*//' | xargs)
fi

if [ -z "$CHALLENGE" ] || [ "$CHALLENGE" = "null" ]; then
  echo "Usage: /start <challenge-name>"
  echo "Example: /start web-exploit"
  exit 1
fi

SESSION_ID="${CTF_USER}-$(date +%s)-$$-${RANDOM}"

RESPONSE=$(curl -sS -X POST "$WORKER_URL/start" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg user "$CTF_USER" --arg challenge "$CHALLENGE" --arg sessionId "$SESSION_ID" \
    '{$user, $challenge, $sessionId}')")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" != "true" ]; then
  # fuzzy match: try to find the challenge by partial name
  CHALLENGES_JSON=$(curl -sS -X POST "$WORKER_URL/challenges" -H "Content-Type: application/json" -d '{}')
  CHALLENGES_OK=$(echo "$CHALLENGES_JSON" | jq -r '.ok // false')
  if [ "$CHALLENGES_OK" = "true" ]; then
    CHALLENGE_LOWER=$(echo "$CHALLENGE" | tr '[:upper:]' '[:lower:]' | xargs)
    MATCH=$(echo "$CHALLENGES_JSON" | jq -r --arg cl "$CHALLENGE_LOWER" \
      '.data[] | select((. | ascii_downcase) == $cl) // empty' 2>/dev/null || true)
    if [ -z "$MATCH" ]; then
      MATCH=$(echo "$CHALLENGES_JSON" | jq -r --arg cl "$CHALLENGE_LOWER" \
        '.data[] | select((. | ascii_downcase) | contains($cl))' 2>/dev/null || true)
      MATCH_COUNT=$(echo "$MATCH" | wc -l)
      if [ "$MATCH_COUNT" -ne 1 ]; then
        ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
        echo "Start failed: $ERROR"
        exit 1
      fi
      MATCH=$(echo "$MATCH" | head -1 | xargs)
    fi
    CHALLENGE="$MATCH"
    RESPONSE=$(curl -sS -X POST "$WORKER_URL/start" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg user "$CTF_USER" --arg challenge "$CHALLENGE" --arg sessionId "$SESSION_ID" \
        '{$user, $challenge, $sessionId}')")
    OK=$(echo "$RESPONSE" | jq -r '.ok // false')
  fi
fi

if [ "$OK" = "true" ]; then
  CHANNEL_ID=$(echo "$RESPONSE" | jq -r '.data.channelId')
  THREAD_ID=$(echo "$RESPONSE" | jq -r '.data.threadId')
  CHALLENGE_NAME=$(echo "$RESPONSE" | jq -r '.data.challengeName')

  STATE_FILE="$PROJECT_DIR/.ctf-state.json"
  ENTRY=$(jq -n --arg channelId "$CHANNEL_ID" --arg threadId "$THREAD_ID" --arg challenge "$CHALLENGE_NAME" \
    '{channelId: $channelId, threadId: $threadId, challenge: $challenge}')

  if [ -f "$STATE_FILE" ]; then
    jq --arg sid "$SESSION_ID" --argjson entry "$ENTRY" \
      '.sessions[$sid] = $entry | .current = $sid' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  else
    jq -n --arg sid "$SESSION_ID" --argjson entry "$ENTRY" \
      '{sessions: {($sid): $entry}, current: $sid}' > "$STATE_FILE"
  fi

  echo "Started $CHALLENGE_NAME. New thread created. Ready to sync your solving work."
  echo "CTF_SESSION_DATA:$(jq -n --arg sessionId "$SESSION_ID" --arg threadId "$THREAD_ID" --arg challenge "$CHALLENGE_NAME" \
    '{$sessionId, $threadId, $challenge}' | jq -c .)"
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
  echo "Start failed: $ERROR"
  exit 1
fi
