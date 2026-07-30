#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a

[ -z "${WORKER_URL:-}" ] && { echo "ERROR: WORKER_URL not set in .env"; exit 1; }
[ -z "${CTF_USER:-}" ] && { echo "ERROR: CTF_USER not set in .env. Add CTF_USER=<your-discord-display-name>"; exit 1; }

RESPONSE=$(curl -sS -X POST "$WORKER_URL/init" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg user "$CTF_USER" '{$user}')")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" = "true" ]; then
  echo "Initialized as $CTF_USER. You're on the team board."
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
  echo "Init failed: $ERROR"
  exit 1
fi
