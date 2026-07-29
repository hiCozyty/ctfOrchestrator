---
description: Register your Discord display name with the CTF team. Call this once when first joining the CTF.
argc:
  argument:
    name: name
    description: Your Discord display name
    required: false
---
If $ARGUMENTS is provided, confirm the name with the user before proceeding. If $ARGUMENTS is not provided, ask for their Discord display name. On confirmation, run `scripts/hook-init.sh <name>`. The hook handles auth, re-registration, and error reporting — do NOT read .env or check initialization status beforehand.
