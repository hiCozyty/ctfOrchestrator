---
description: Start working on a CTF challenge. Creates a Discord channel and personal thread for syncing your solving work.
---
Do NOT read the hook script or .env.

1. Before ANY action, scan this conversation. Has /start already succeeded? If yes, emit exactly this and STOP: "A challenge is already started in this session. Open a new conversation for a different challenge."
2. Only if no prior /start exists: run `scripts/hook-start.sh $ARGUMENTS` immediately.