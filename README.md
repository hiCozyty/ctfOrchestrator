# CTF Team Orchestrator

Cloudflare Worker + Durable Object that coordinates a CTF team through Discord. Each teammate's local coding agent sends one-shot HTTP calls before and after solving challenges; the Worker maintains shared ground truth — player roster, challenge channels/threads, and solver status — all reflected live in Discord.

## How it works

```
Agent harness             →   Worker (fetch handler)   →   Durable Object (SQLite)
(opencode / Claude Code)       routes 14 endpoints         state + Discord API calls
```

- **One Worker** holds the bot token and routes all HTTP requests to a single Durable Object instance (`idFromName("main")`).
- **The Durable Object** stores player roster, challenge state (channel IDs, solver, active users), and active sessions in SQLite. All Discord interactions (channel creation, thread creation, message posting, channel moves) happen inside the DO.
- **Discord IDs** for the guild, categories, and progress channel are hardcoded in `src/index.js`.

## Setup

### 1. Discord Bot

Create a bot at [Discord Developer Portal](https://discord.com/developers/applications), invite it to your server with these permissions:
- Manage Channels
- Send Messages
- Create Public Threads
- Read Message History

Copy the bot token.

### 2. Secrets

Set the bot token and an admin secret:

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put ADMIN_SECRET
```

For local dev, create `.dev.vars`:

```
DISCORD_BOT_TOKEN=<your-token>
ADMIN_SECRET=<your-secret>
```

### 3. Run locally

```bash
npm install
npx wrangler dev
```

### 4. Deploy

```bash
npx wrangler deploy
```

## Discord server structure

The Worker expects these categories/channels to already exist:

| Name | Purpose |
|------|---------|
| `ctf-challenges` | Active challenge channels |
| `help-me` | Challenges requesting help |
| `finished-challenges` | Solved challenges |
| `offline-challenges` | Archived for offline solving |
| `#progress` | Pinned players & challenges lists |

## Testing the full flow

```bash
# Admin initializes challenge list (posts Players + Challenges blocks in #progress)
curl -s -X POST http://localhost:8787/adminInit \
  -H 'Content-Type: application/json' \
  -d '{"secret":"<admin-secret>","challenges":["web-flag","crypto-rsa","pwn-stack"]}'

# Teammate registers
curl -s -X POST http://localhost:8787/init \
  -H 'Content-Type: application/json' \
  -d '{"user":"Alice"}'

# Teammate starts a challenge (creates channel + thread)
curl -s -X POST http://localhost:8787/start \
  -H 'Content-Type: application/json' \
  -d '{"user":"Alice","challenge":"web-flag","sessionId":"session-1"}'
# Response: { "ok": true, "data": { "channelId": "...", "threadId": "...", "challengeName": "web-flag" } }

# Agent syncs a message to the thread
curl -s -X POST http://localhost:8787/syncMessage \
  -H 'Content-Type: application/json' \
  -d '{"user":"Alice","channelId":"<channelId>","content":"Trying SQL injection on login..."}'

# Teammate finishes (moves channel to finished-category if no others are active)
curl -s -X POST http://localhost:8787/finish \
  -H 'Content-Type: application/json' \
  -d '{"user":"Alice","channelId":"<channelId>"}'

# Request help (moves channel to help-me category)
curl -s -X POST http://localhost:8787/helpme \
  -H 'Content-Type: application/json' \
  -d '{"user":"Alice","channelId":"<channelId>"}'

# Undo a finished challenge
curl -s -X POST http://localhost:8787/undoFinish \
  -H 'Content-Type: application/json' \
  -d '{"user":"Alice","challengeName":"web-flag"}'

# Archive a challenge for offline solving (moves to offline-challenges category)
curl -s -X POST http://localhost:8787/archive \
  -H 'Content-Type: application/json' \
  -d '{"user":"Alice","challenge":"web-flag"}'

# Undo archive — return challenge to active pool
curl -s -X POST http://localhost:8787/undoArchive \
  -H 'Content-Type: application/json' \
  -d '{"user":"Alice","challengeName":"web-flag"}'
```

## Agent integration

### Shared scripts

All harnesses use the same shell scripts in `scripts/`:

| Script | What it does |
|--------|--------------|
| `hook-admin-init.sh` | Calls `/adminInit` with challenges |
| `hook-admin-reset.sh` | Calls `/adminReset`, cleans local state files |
| `hook-init.sh` | Calls `/init`, reads `CTF_USER` from `.env` |
| `hook-start.sh` | Calls `/start`, writes `.ctf-state.json` |
| `hook-finish.sh` | Two-step confirm then calls `/finish`, cleans `.ctf-state.json` |
| `hook-helpme.sh` | Two-step confirm then calls `/helpme` |
| `hook-undoFinish.sh` | Calls `/undoFinish`, restores `.ctf-state.json` |
| `hook-undoStart.sh` | Calls `/undoStart`, cleans `.ctf-state.json` |
| `hook-archive.sh` | Calls `/archive`, no local state tracking |
| `hook-undoArchive.sh` | Calls `/undoArchive` |
| `hook-sync.sh` | Extracts last assistant message from JSONL (opencode transcript or Claude Code session), calls `/syncMessage` |

Scripts accept CLI args (for direct invocation) and fall back to stdin JSON (for when triggered by hooks). See each script's header for usage.

### opencode

**File**: `.opencode/plugins/ctf-sync.ts` (custom tools) + `.opencode/commands/*.md` (slash commands)

**Slash commands**: Type these in the opencode TUI:

| Command | Example |
|---------|---------|
| `/adminInit web-flag crypto-rsa` | Initialize with challenge list |
| `/init` | Register as a player (uses `CTF_USER` from `.env`) |
| `/start web-flag` | Start working on a challenge |
| `/finish` | Finish (two-step via the plugin tool) |
| `/helpme` | Request help (two-step via the plugin tool) |
| `/undoFinish web-flag` | Undo a finished challenge |
| `/undoStart web-flag` | Undo a challenge start |
| `/archive web-flag` | Archive challenge for offline solving |
| `/undoArchive web-flag` | Restore archived challenge to active pool |
| `/adminReset` | Reset all CTF state (admin only) |

**Custom tools** (called automatically by the LLM): `hook-admin-init.sh`, `hook-admin-reset.sh`, `hook-init.sh`, `hook-start.sh`, `hook-finish.sh`, `hook-helpme.sh`, `hook-undoFinish.sh`, `hook-undoStart.sh`, `hook-archive.sh`, `hook-undoArchive.sh`, `hook-sync.sh`.

**Auto-sync**: The `session.idle` handler syncs the last assistant message to the Discord thread.

### Claude Code

**File**: `.claude/settings.json` (Stop hook) + `.claude/commands/*.md` (symlinks → `.opencode/commands/`)

No plugin needed. Claude Code's native `Stop` hook fires after every assistant response and runs `scripts/hook-sync.sh`, which detects the `session_id` from the hook's stdin and locates the Claude Code session JSONL at `~/.claude/projects/<hash>/<session_id>.jsonl`.

**Slash commands**: Same as opencode — type these in the Claude Code TUI:

| Command | Example |
|---------|---------|
| `/adminInit web-flag crypto-rsa` | Initialize with challenge list |
| `/init` | Register as a player (uses `CTF_USER` from `.env`) |
| `/start web-flag` | Start working on a challenge |
| `/finish` | Finish (two-step) |
| `/helpme` | Request help (two-step) |
| `/undoFinish web-flag` | Undo a finished challenge |
| `/undoStart web-flag` | Undo a challenge start |
| `/archive web-flag` | Archive challenge for offline solving |
| `/undoArchive web-flag` | Restore archived challenge to active pool |
| `/adminReset` | Reset all CTF state (admin only) |

## API reference

| Method | Path | Body params | Description |
|--------|------|-------------|-------------|
| `GET` | `/initialized` | — | Check if admin has initialized |
| `POST` | `/adminInit` | `secret`, `challenges[]` | Initialize challenge list |
| `POST` | `/adminReset` | `secret` | Reset all state to defaults |
| `POST` | `/init` | `user`, `userId?` | Register a player |
| `POST` | `/start` | `user`, `challenge`, `sessionId` | Start working on a challenge |
| `POST` | `/finish` | `user`, `channelId` | Mark challenge as done |
| `POST` | `/helpme` | `user`, `channelId` | Request help on a challenge |
| `POST` | `/undoFinish` | `user`, `challengeName` | Un-finish a challenge |
| `POST` | `/undoStart` | `user`, `challengeName` | Undo a challenge start |
| `POST` | `/archive` | `user`, `challenge` | Archive challenge for offline solving |
| `POST` | `/undoArchive` | `user`, `challengeName` | Restore archived challenge to active pool |
| `POST` | `/syncMessage` | `user`, `channelId`, `content`, `thinking?` | Post a message to a thread |
| `GET` | `/challenges` | — | List all challenge names |
| `POST` | `/lookup` | `channelId` or `challengeName` | Look up channel/challenge info |

All responses are JSON: `{ "ok": true, "data": { ... } }` on success, `{ "ok": false, "error": "..." }` on failure.

## Discord API rate limits

All Discord API calls go through a centralized queue (`discordFetch`) that respects rate limits using response headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset-After`, `X-RateLimit-Bucket`). When a bucket is exhausted, the queue delays automatically. On 429 (Too Many Requests), it retries after `retry_after` seconds.

### Per-endpoint limits (verified via live API testing)

| Endpoint | Limit | Reset | Used by |
|----------|-------|-------|---------|
| `GET /guilds/{id}/members/search` | 10 | 10s | `findUserByName` |
| `GET /channels/{id}/messages` | 5 | 1s | `adminReset` pagination |
| `GET /guilds/{id}/channels` | 10 | 60s | `adminReset` |
| `POST /channels/{id}/messages` | 5 | 1s | `syncMessage`, board creates, `startChallenge` |
| `PATCH /channels/{id}/messages/{id}` | 5 | 1s | Board message edits |
| `POST /channels/{id}/messages/{id}/threads` | 50 | 300s | `startChallenge` thread creation |
| `PATCH /channels/{id}` | 10 | 10s | Channel category moves (finish/helpme/undo) |
| `DELETE /channels/{id}/messages/{id}` | 3 | 0.33s | `adminReset` fallback deletes |
| `POST /channels/{id}/messages/bulk-delete` | 5 | 1s | `adminReset` |
| `POST /guilds/{id}/channels` | 2,000 | 1,634s | `startChallenge` channel creation |
| `DELETE /channels/{id}` | 1,000 | 0.001s | `adminReset` channel cleanup |

### Key observations

- **Each bucket is independent** — reading, creating, and editing messages each track their own rate limit, even on the same channel.
- **Per-channel scoping** — the 5/1s message limit is per channel; writing to channel A doesn't consume slots for channel B.
- **Tightest constraint** — the 5/1s per-channel message bucket on `#progress` (PROGRESS_CHANNEL). Both board updates hit the same channel. Two concurrent player operations could consume 4/5 slots in a single second window.
- **Thread creation** — 50 threads per 5 minutes. Very permissive; only a concern during batch admin operations.
- **The queue handles it** — header-driven delays naturally space requests when buckets exhaust, with no hardcoded limits.

```js
{
  initialized: true,
  playersMessageId: "..."      // #progress message ID for the players list
  challengeMessageIds: ["..."] // #progress message IDs for the challenges list (array, chunked if >2000 chars)
  playerIds: { "Alice": "discord_user_id" }, // for @mentions
  players: { "Alice": true, "Bob": true },
  challenges: {
     "web-flag": {
       channelId: "...",
       solverName: "Alice",
       solved: true,
       previousCategory: "ctf-challenges",
       currentCategory: "finished-challenges",
       activeUsers: {}
     },
     "pwn-stack": {
       channelId: "...",
       solverName: null,
       solved: false,
       previousCategory: null,
       currentCategory: "offline-challenges",
       activeUsers: {}
     }
  },
  activeSessions: { "session-1": "web-flag" }
}
```
