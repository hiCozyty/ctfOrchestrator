# CTF Userland

Personal toolkit for a CTF teammate. Connects your local [opencode](https://opencode.ai) coding agent to the team's Discord coordination bot so your solving work syncs automatically to the team channel.

## Prerequisites

- [opencode](https://opencode.ai) installed
- A `.env` file with `WORKER_URL` and `CTF_USER` (ask your admin for the `WORKER_URL`)

## Setup

```bash
# Copy env template and fill in your values
cp envExample .env
# Edit .env:
#   WORKER_URL=<url-from-admin>
#   CTF_USER=<your-discord-display-name>
```

## Usage

Everything happens through opencode. Once your `.env` is set:

```
/init <your-discord-display-name>   # Register once
/start <challenge-name>             # Begin working on a challenge
/finish                             # Mark a challenge as solved
/undoStart <challenge-name>         # Abandon a challenge
/undoFinish <challenge-name>        # Un-finish a challenge
/helpme                             # Request team help
```

Your assistant messages sync to Discord automatically while you solve.

## File structure

```
.ctf-state.json          # Current session (created by /start)
.ctf-finish-pending      # Two-step confirmation for /finish
.ctf-helpme-pending      # Two-step confirmation for /helpme
.env                     # WORKER_URL + CTF_USER (never commit)
scripts/                 # Hook scripts that talk to the Worker
.opencode/               # Plugin + slash commands for opencode
```
