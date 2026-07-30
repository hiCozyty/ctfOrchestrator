---
description: Initialize the CTF challenge list. Creates the Players and Challenges boards in Discord. Admin only.
---
Extract challenge names from the user's message (look for lines like "Q1 - Title"). Preserve the full "Q# - Title" format including the prefix. Pass them as arguments to `scripts/hook-admin-init.sh`. The hook handles auth, idempotency, and error reporting — do NOT read .env or check initialization status beforehand.
