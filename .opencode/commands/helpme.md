---
description: Request help on the current challenge. Moves the challenge channel to help-me. This is a shared claim. Requires confirmation.
---
Do NOT read the hook script or .env.

**SESSION CHECK**: This command can ONLY be used after /start was run in this conversation. If /start was NOT run, warn the user.

If $ARGUMENTS: run `scripts/hook-helpme.sh $ARGUMENTS` to target a specific challenge.
If no $ARGUMENTS: run `scripts/hook-helpme.sh` — it targets the current challenge.

If the hook lists multiple active challenges (because there's no current), use the question tool to ask the user which one, then re-run with the chosen name.

1. Run `scripts/hook-helpme.sh [challenge-name]` — it prints a confirmation prompt. Relay it to the user.
2. After user confirms, run `scripts/hook-helpme.sh --yes` — it executes the move.
