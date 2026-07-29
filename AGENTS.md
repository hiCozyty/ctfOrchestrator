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
- `hook-sync.sh` — sync transcript with the Worker

# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
