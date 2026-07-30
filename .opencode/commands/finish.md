---
description: Finish the current CTF challenge. Moves the channel to finished if no other teammates are still working. Requires confirmation.
---
Do NOT read the hook script or .env.

**SESSION CHECK**: This command can ONLY be used after /start was run in this conversation. If /start was NOT run, warn the user.

If $ARGUMENTS: run `scripts/hook-finish.sh $ARGUMENTS` to finish a specific challenge.
If no $ARGUMENTS: run `scripts/hook-finish.sh` — it targets the current challenge.

If the hook lists multiple active challenges (because there's no current), use the question tool to ask the user which one, then re-run with the chosen name.

1. Run `scripts/hook-finish.sh [challenge-name]` — it prints a confirmation prompt. Relay it to the user.
2. After user confirms, run `scripts/hook-finish.sh --yes` — it executes the finish.
