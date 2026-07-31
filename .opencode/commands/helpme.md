---
description: Request help on the current challenge. Moves the challenge channel to help-me. This is a shared claim. Requires confirmation.
---
Do NOT read the hook script or .env.

If $ARGUMENTS: run `scripts/hook-helpme.sh $ARGUMENTS` to target a specific challenge.
If no $ARGUMENTS: run `scripts/hook-helpme.sh` — it targets the most recent session.

If the hook lists multiple active sessions (because there's no current), use the question tool to ask the user which challenge, then re-run with the chosen name.

1. Run `scripts/hook-helpme.sh [challenge-name]` — it prints a confirmation prompt. Relay it to the user.
2. After user confirms, run `scripts/hook-helpme.sh --yes` — it executes the move.
