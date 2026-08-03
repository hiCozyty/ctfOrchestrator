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
  CHALLENGE=$(echo "$INPUT" | jq -r '.args // .prompt // .text // empty' | sed 's/^\/archive\s*//' | xargs)
fi

if [ -z "$CHALLENGE" ] || [ "$CHALLENGE" = "null" ]; then
  echo "Usage: /archive <challenge-name>"
  echo "Example: /archive web-exploit"
  exit 1
fi

RESPONSE=$(curl -sS -X POST "$WORKER_URL/archive" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg user "$CTF_USER" --arg challenge "$CHALLENGE" \
    '{$user, $challenge}')")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" != "true" ]; then
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
        echo "Archive failed: $ERROR"
        exit 1
      fi
      MATCH=$(echo "$MATCH" | head -1 | xargs)
    fi
    CHALLENGE="$MATCH"
    RESPONSE=$(curl -sS -X POST "$WORKER_URL/archive" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg user "$CTF_USER" --arg challenge "$CHALLENGE" \
        '{$user, $challenge}')")
    OK=$(echo "$RESPONSE" | jq -r '.ok // false')
  fi
fi

if [ "$OK" = "true" ]; then
  CHANNEL_ID=$(echo "$RESPONSE" | jq -r '.data.channelId')
  CHALLENGE_NAME=$(echo "$RESPONSE" | jq -r '.data.challengeName')
  echo "Archived $CHALLENGE_NAME for offline solving."
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
  echo "Archive failed: $ERROR"
  exit 1
fi
