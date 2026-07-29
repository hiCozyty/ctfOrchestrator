---
description: Finish the current CTF challenge. Moves the channel to finished if no other teammates are still working. Requires confirmation.
---
**SESSION CHECK**: This command can ONLY be used after /start was run in this conversation. If /start was NOT run, warn the user.

Run `scripts/hook-finish.sh` — no arguments needed, it derives the challenge from session context. If you've forgotten which challenge, ask the user. The hook handles the two-step confirmation flow and all error reporting — do NOT read .env or check initialization status beforehand.
