---
description: Request help on the current challenge. Moves the challenge channel to help-me. This is a shared claim. Requires confirmation.
---
**SESSION CHECK**: This command can ONLY be used after /start was run in this conversation. If /start was NOT run, warn the user.

Run `scripts/hook-helpme.sh` — no arguments needed, it derives the challenge from session context. If you've forgotten which challenge, ask the user. The hook handles the two-step confirmation flow and all error reporting — do NOT read .env or check initialization status beforehand.
