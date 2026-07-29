# CTF Orchestrator — Userland

This is the teammate-side CTF toolkit. The `hook-*.sh` scripts in `scripts/` talk to the team Worker. Do NOT explore the project structure, read .env, or call Worker HTTP endpoints directly — the hooks handle auth, routing, error propagation, and idempotency automatically.

- `hook-init.sh` — register a player
- `hook-start.sh` — start a challenge
- `hook-finish.sh` — finish a challenge (two-step confirmation)
- `hook-helpme.sh` — request help on a challenge (two-step confirmation)
- `hook-undoStart.sh` — undo a challenge start
- `hook-undoFinish.sh` — undo a challenge finish
- `hook-sync.sh` — sync transcript with the Worker
