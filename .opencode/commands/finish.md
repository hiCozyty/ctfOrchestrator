---
description: Finish the current CTF challenge. Moves the channel to finished if no other teammates are still working. Requires confirmation.
---
Do NOT read the hook script or .env.

If $ARGUMENTS: run `scripts/hook-finish.sh $ARGUMENTS` to finish a specific challenge.
If no $ARGUMENTS: run `scripts/hook-finish.sh` — it targets the most recent session.

If the hook lists multiple active sessions (because there's no current), use the question tool to ask the user which challenge, then re-run with the chosen name.

1. Run `scripts/hook-finish.sh [challenge-name]` — it prints a confirmation prompt. Relay it to the user.
2. After user confirms, run `scripts/hook-finish.sh --yes` — it executes the finish.
