#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a

[ -z "${WORKER_URL:-}" ] && { echo "ERROR: WORKER_URL not set in .env"; exit 1; }
[ -z "${ADMIN_SECRET:-}" ] && { echo "ERROR: ADMIN_SECRET not set in .env"; exit 1; }

RESPONSE=$(curl -sS -X POST "$WORKER_URL/adminReset" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg secret "$ADMIN_SECRET" '{$secret}')")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" = "true" ]; then
  echo "CTF state reset. Run /adminInit to reinitialize."
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
  echo "AdminReset failed: $ERROR"
  exit 1
fi
