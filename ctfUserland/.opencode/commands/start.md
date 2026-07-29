---
description: Start working on a CTF challenge. Creates a Discord channel and personal thread for syncing your solving work.
argc:
  argument:
    name: challenge
    description: The challenge name to start
    required: false
---
**FRESH CONTEXT CHECK**: /start must ONLY be run in a completely fresh conversation with no prior messages. If there is ANY conversation history (previous user messages, assistant responses, or tool calls), STOP and warn to create a new channel.

Use the FULL challenge name from $ARGUMENTS (e.g., "Q1 - The Vending Machine's Secret"). If no $ARGUMENTS, ask the user which challenge. Run `scripts/hook-start.sh <challenge>`. The hook handles auth, registration checks, and fuzzy matching — do NOT read .env or check initialization status beforehand. After a successful start, remember the challenge name for this session.
