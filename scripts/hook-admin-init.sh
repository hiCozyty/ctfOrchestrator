#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a

[ -z "${WORKER_URL:-}" ] && { echo "ERROR: WORKER_URL not set in .env"; exit 1; }
[ -z "${ADMIN_SECRET:-}" ] && { echo "ERROR: ADMIN_SECRET not set in .env"; exit 1; }

CHALLENGES=()

if [ ! -t 0 ]; then
  STDIN=$(cat)
  if echo "$STDIN" | jq -e . >/dev/null 2>&1; then
    FIRST_CHAR=$(echo "$STDIN" | head -c 1)
    if [ "$FIRST_CHAR" = "[" ]; then
      readarray -t CHALLENGES < <(echo "$STDIN" | jq -r '.[]' 2>/dev/null || true)
    fi
  fi
  if [ ${#CHALLENGES[@]} -eq 0 ] && [ -n "$STDIN" ]; then
    readarray -t CHALLENGES <<< "$STDIN"
    for i in "${!CHALLENGES[@]}"; do
      CHALLENGES[$i]=$(echo "${CHALLENGES[$i]}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    done
    FILTERED=()
    for line in "${CHALLENGES[@]}"; do
      if echo "$line" | grep -q ' - '; then
        FILTERED+=("$line")
      fi
    done
    CHALLENGES=("${FILTERED[@]}")
    echo "Detected ${#CHALLENGES[@]} challenge(s) from stdin:"
    for line in "${CHALLENGES[@]}"; do
      echo "  - $line"
    done
    echo ""
    if [ ${#CHALLENGES[@]} -eq 0 ]; then
      echo "No challenge names found in stdin. Lines must contain ' - ' (e.g. 'Q1 - The Vending Machine')."
      exit 1
    fi
  fi
fi

if [ ${#CHALLENGES[@]} -eq 0 ]; then
  if [ "$#" -gt 0 ]; then
    readarray -t CHALLENGES <<< "$(printf '%s\n' "$@")"
  else
    echo "Usage: /adminInit challenge1 challenge2 ..."
    echo "  or pipe JSON array:  echo '[\"Q1 - Title\", \"Q2 - Title\"]' | hook-admin-init.sh"
    echo "  or pipe newline list: printf 'Q1 - Title\nQ2 - Title\n' | hook-admin-init.sh"
    exit 1
  fi
fi

CHALLENGE_JSON=$(printf '%s\n' "${CHALLENGES[@]}" | sed '/^$/d' | jq -R . | jq -s .)

RESPONSE=$(curl -sS -X POST "$WORKER_URL/adminInit" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg secret "$ADMIN_SECRET" --argjson challenges "$CHALLENGE_JSON" \
    '{$secret, challenges: $challenges}')")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" = "true" ]; then
  WARNING=$(echo "$RESPONSE" | jq -r '.data.warning // empty')
  if [ -n "$WARNING" ]; then
    echo "$WARNING"
  else
    echo "CTF initialized with ${#CHALLENGES[@]} challenges. Players and Challenges boards posted to Discord."
  fi
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
  if echo "$ERROR" | grep -qi 'already initialized\|already exists'; then
    echo "Already initialized. ${#CHALLENGES[@]} challenge(s) provided ignored."
    exit 0
  fi
  echo "AdminInit failed: $ERROR"
  exit 1
fi
