# CTF Orchestrator

This is a CTF event coordination bot. The `hook-*.sh` scripts in `scripts/` talk directly to the running Worker. Do NOT explore the project structure, read .env, or call Worker HTTP endpoints directly — the hooks handle auth, routing, error propagation, and idempotency automatically.

- `hook-admin-init.sh` — initialize challenges (idempotent: safe to run repeatedly)
- `hook-admin-reset.sh` — wipe all state
- `hook-init.sh` — register a player
- `hook-start.sh` — start a challenge
- `hook-finish.sh` — finish a challenge (two-step confirmation)
- `hook-helpme.sh` — request help on a challenge (two-step confirmation)
- `hook-undoStart.sh` — undo a challenge start
- `hook-undoFinish.sh` — undo a challenge finish
- `hook-archive.sh` — archive a challenge for offline solving (no thread, no user assignment)
- `hook-undoArchive.sh` — restore an archived challenge to the active pool
- `hook-sync.sh [--thread-id <id>]` — sync transcript with the Worker. Pass --thread-id to target a specific thread (recommended when multiple sessions are active).

## CTF-MCP Tools

The `ctf-mcp` MCP server provides 126 tools for solving CTF challenges. Use them when analyzing crypto, web, pwn, reverse, forensics, or misc challenges.

- **Crypto** (53 tools): base encoding (Base64/32/58/85), classical ciphers (Caesar, Vigenere, XOR, etc.), hash cracking, RSA attacks, frequency analysis
- **Web** (46 tools): SQL injection payloads, XSS/SSTI/SSRF/XXE attacks, JWT attacks, deserialization, command injection
- **Pwn** (27 tools): shellcode generation, cyclic patterns, ROP gadgets, format string exploits, heap exploitation

Prefix tool calls with `ctf-mcp_` (e.g., `ctf-mcp_base64_decode`, `ctf-mcp_sql_payloads`).

