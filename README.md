# Unblock.Agent v2 (HackNCState)

Tagline: "The first gig-economy where software hires humans."

This repo is a demo-first prototype: an AI agent runs a multi-step workflow, hits an ambiguity it cannot safely resolve, posts a paid task to a human UI, then releases a Solana devnet bounty from escrow after the agent confirms the answer.

## Architecture

There are three runnable components (in one monorepo):

1. Server (`apps/server`)
   - REST API for tasks
   - WebSocket for realtime UI updates (optional; UI still works via polling)
   - Solana custodial escrow wallet (hackathon prototype)
   - Serves the human UI static assets
2. Agent (`apps/agent`)
   - Runs a real LLM workflow (OpenAI or Anthropic)
   - At a specific step, creates a "human needed" task
   - Signs and pays bounty on Solana devnet (agent wallet -> escrow wallet)
   - Waits for human answer, then confirms to release payment
3. Human UI (`apps/web`)
   - Static single-page UI (no build step)
   - Resolver sets their wallet pubkey once and answers tasks

Shared types live in `packages/common`.

## Repo Layout

```
apps/
  agent/      # Node/TS agent runner (LLM + Solana pay + polling)
  server/     # Node/TS server (API + WS + escrow + static hosting)
  web/        # Static UI assets served by server
packages/
  common/     # Shared types/schemas (Task, API payloads)
scripts/      # Keypair + prefund helpers (devnet)
```

## Quickstart (Mock Solana)

This gets you a fully working local task flow without touching Solana.

Prereqs:
- Node.js 20+

Steps:
1. Install deps:
   - `npm install`
2. Start server:
   - `npm run dev:server`
3. Open UI:
   - `http://localhost:4000`
4. Run agent:
   - `npm run dev:agent`

By default, `.env.example` sets `MOCK_SOLANA=1` so payouts/refunds are simulated (but the status transitions and demo UX are real).

Notes:
- `apps/server/.env` and `apps/agent/.env` are auto-loaded on startup (no need to `source`).

## Devnet Demo (Real Signatures, Real Transfers)

When you're ready to show transactions in Solana Explorer:

1. Create keypairs (stored under `.secrets/`, ignored by git):
   - `npm run scripts:gen-keypairs`
2. Prefund the agent on devnet (airdrop):
   - `npm run scripts:prefund-agent`
3. Configure env:
   - Copy `.env.example` files:
     - `apps/server/.env.example` -> `apps/server/.env`
     - `apps/agent/.env.example` -> `apps/agent/.env`
   - Set `MOCK_SOLANA=0` in `apps/server/.env`
4. Start server + UI:
   - `npm run dev:server`
5. Run agent:
   - `npm run dev:agent`

If devnet is down or airdrops are rate-limited during judging, flip back to `MOCK_SOLANA=1` and run the exact same demo flow.

## Real LLM Reasoning Test Case (Verification)

To prove you are running a real LLM (not cached text), run the agent with:

- `DEMO_CACHE=0`
- `REASONING_TEST=1`
- set an API key for your chosen provider

Example (OpenAI):

```sh
DEMO_CACHE=0 REASONING_TEST=1 LLM_PROVIDER=openai OPENAI_API_KEY=... npm run dev:agent
```

Example (Anthropic):

```sh
DEMO_CACHE=0 REASONING_TEST=1 LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run dev:agent
```

The agent will print a small fintech underwriting reasoning probe (DTI calculation + decision) before continuing the normal workflow.

## Demo Script (3-5 minutes)

Screen setup:
- Left: agent terminal output
- Right: browser on `http://localhost:4000` (resolver UI)
- Optional: Solana Explorer tabs for the lock + release transactions

Script:
1. Agent runs steps 1-2 via LLM.
2. Agent hits the "human needed" step and posts a bounty task (with two images).
3. Resolver UI shows the task. Resolver submits a short justification.
4. Agent receives the answer and confirms.
5. Server releases escrow (or simulates release) and UI shows `PAID` with the tx signature.

Closing line:
- "The agent spent 0.05 SOL and 30 seconds to avoid hallucinating. This is a labor market where software is the employer."

## Ownership / Parallel Dev Work

See `OWNERSHIP.md` for exactly who owns what (Dev1..Dev5), the boundaries, and what interfaces are shared.

## API Summary (MVP)

Base URL: `http://localhost:4000`

- `POST /api/tasks` create a task (agent)
- `GET /api/tasks` list tasks (UI)
- `GET /api/tasks/:id` task status (agent)
- `POST /api/tasks/:id/answer` submit answer (UI)
- `POST /api/tasks/:id/confirm` accept + release (agent)
- `POST /api/tasks/:id/reject` reject + refund (agent)

## Troubleshooting

- UI not updating: refresh page; polling should still work even if WS fails
- Solana devnet issues: set `MOCK_SOLANA=1`
- LLM is slow/rate-limited: you can temporarily hardcode cached outputs in the agent (do not block the demo on LLM quality)

## Tests

There is no full unit/integration suite yet. For hackathon sanity checks:

- `npm test` runs TypeScript typecheck + builds all workspaces.
