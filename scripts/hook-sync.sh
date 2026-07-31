#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
[ -f "$PROJECT_DIR/.env" ] && set -a && source "$PROJECT_DIR/.env" && set +a

[ -z "${CTF_USER:-}" ] && exit 0
[ -z "${WORKER_URL:-}" ] && exit 0

THREAD_ID_ARG=""
for arg in "$@"; do
  if [ "$arg" = "--thread-id" ]; then
    THREAD_ID_ARG="next"
  elif [ "$THREAD_ID_ARG" = "next" ]; then
    THREAD_ID_ARG="$arg"
  fi
done
if [ "$THREAD_ID_ARG" = "next" ]; then
  THREAD_ID_ARG=""
fi

STATE_FILE="$PROJECT_DIR/.ctf-state.json"
[ ! -f "$STATE_FILE" ] && exit 0

INPUT="$(cat 2>/dev/null || echo '{}')"
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // .properties.transcript_path // empty')
[ -z "$TRANSCRIPT_PATH" ] || [ "$TRANSCRIPT_PATH" = "null" ] && exit 0
[ ! -f "$TRANSCRIPT_PATH" ] && exit 0

LAST_MSG=$(tail -1 "$TRANSCRIPT_PATH" 2>/dev/null || echo '{}')
[ -z "$LAST_MSG" ] && exit 0

ROLE=$(echo "$LAST_MSG" | jq -r '.message.role // .role // "unknown"')
[ "$ROLE" != "assistant" ] && exit 0

CONTENT=$(echo "$LAST_MSG" | jq -r '
  (.message.content // .content // "")
  | if type == "array" then
      [.[] | select(.type == "text" or .type == "tool_use" or .text != null) | .text // .input // empty] | join("\n")
    else . end
')

THINKING=$(echo "$LAST_MSG" | jq -r '
  (.message.content // .content // "")
  | if type == "array" then
      [.[] | select(.type == "thinking") | .thinking // empty] | join("\n")
    else empty end
')
[ -z "$THINKING" ] || [ "$THINKING" = "null" ] && THINKING=""

[ -z "$CONTENT" ] || [ "$CONTENT" = "null" ] && exit 0

CURRENT=$(jq -r '.current // empty' "$STATE_FILE")
[ -z "$CURRENT" ] || [ "$CURRENT" = "null" ] && exit 0

if [ -n "$THREAD_ID_ARG" ]; then
  THREAD_ID="$THREAD_ID_ARG"
else
  THREAD_ID=$(jq -r --arg sid "$CURRENT" '.sessions[$sid].threadId // empty' "$STATE_FILE")
fi
[ -z "$THREAD_ID" ] || [ "$THREAD_ID" = "null" ] && exit 0

curl -sS -X POST "$WORKER_URL/syncMessage" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg channelId "$THREAD_ID" --arg user "$CTF_USER" --arg content "$CONTENT" --arg thinking "$THINKING" \
    '{$channelId, $user, $content, $thinking}')" \
  -o /dev/null 2>/dev/null || true
