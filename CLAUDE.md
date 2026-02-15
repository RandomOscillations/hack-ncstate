# CLAUDE.md (Agent Build Notes)

This file is for coding agents and teammates. It describes the constraints and "demo-first" priorities for Unblock.Agent v2.

## Goal

Deliver a reliable live demo:
- Agent runs an LLM workflow.
- Agent posts a "human needed" task with images + bounty.
- Human answers in the UI.
- Agent confirms.
- Escrow releases payment on Solana devnet (or simulated in mock mode).

## Non-Goals (Do Not Build For MVP)

- CAPTCHA solving as a core feature
- Selenium/Puppeteer live capture
- Public open marketplace (auth, claiming, anti-spam)
- On-chain Solana program escrow (smart contract)

## Hard Requirements

- Polling must work even if WebSocket fails.
- `MOCK_SOLANA` must remain available for demo reliability.
- Keep the happy path rock solid. Reject/refund can exist but must not jeopardize the demo.
- Do not commit secrets:
  - `.env`
  - `.secrets/*`

## Where Things Live

- Server entry: `apps/server/src/index.ts`
- Server HTTP routes: `apps/server/src/http/routes.ts`
- Server task model/store: `apps/server/src/tasks/*`
- Server Solana integration: `apps/server/src/solana/*`
- Agent entry: `apps/agent/src/index.ts`
- Shared types: `packages/common/src/types.ts`
- Human UI: `apps/web/public/index.html`, `apps/web/public/app.js`, `apps/web/public/styles.css`

## Environment Flags

- `MOCK_SOLANA=1`:
  - server does not send real transfers
  - server returns deterministic fake tx signatures
- `DEMO_CACHE=1`:
  - agent may reuse cached LLM outputs to avoid latency (optional)

## Task State Machine (MVP)

- `OPEN` (created, awaiting human)
- `ANSWERED` (human submitted answer)
- `CONFIRMED_PAID` (agent accepted; escrow released)
- `REJECTED_REFUNDED` (agent rejected; escrow refunded)
- optional `EXPIRED_REFUNDED` (timeout)

## API Contract (Summary)

- `POST /api/tasks` (agent create)
- `GET /api/tasks` (UI list)
- `GET /api/tasks/:id` (agent poll)
- `POST /api/tasks/:id/answer` (UI submit)
- `POST /api/tasks/:id/confirm` (agent confirm + release)
- `POST /api/tasks/:id/reject` (agent reject + refund)

## Running the Project

### Prerequisites

- Node.js 18+ and npm
- Git

### Quick Start (Demo Mode)

Works on both Windows and Mac. Demo mode uses cached LLM outputs and mock Solana — no API keys or wallets needed.

```bash
# 1. Install dependencies (from repo root)
npm install

# 2. Copy env files
# Mac/Linux:
cp apps/server/.env.example apps/server/.env
cp apps/agent/.env.example apps/agent/.env
# Windows (cmd):
copy apps\server\.env.example apps\server\.env
copy apps\agent\.env.example apps\agent\.env

# 3. Start the server (terminal 1)
npm run dev:server

# 4. Run the agent (terminal 2)
npm run dev:agent

# 5. Open the UI
#    http://localhost:4000
```

### Running with Live LLM

Set `DEMO_CACHE=0` in `apps/agent/.env` and provide an API key for your chosen provider:

```env
DEMO_CACHE=0
LLM_PROVIDER=gemini          # or "openai" or "anthropic"
GEMINI_API_KEY=your-key-here  # match the provider above
```

### Running with Real Solana (Devnet)

```bash
# 1. Generate keypairs
npm run scripts:gen-keypairs

# 2. Airdrop devnet SOL to agent
npm run scripts:prefund-agent

# 3. Print escrow pubkey (set in apps/agent/.env as ESCROW_PUBKEY)
npm run scripts:print-pubkey -- escrow

# 4. Set MOCK_SOLANA=0 in both apps/server/.env and apps/agent/.env
```

### Build & Typecheck

```bash
npm run build      # Compile all workspaces
npm run typecheck  # Type-check all workspaces
npm test           # typecheck + build
```

### Server Environment (`apps/server/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server listen port |
| `MOCK_SOLANA` | `1` | Skip real Solana transactions |
| `RESOLVER_DEMO_TOKEN` | _(empty)_ | Optional auth token for answer submission |
| `ESCROW_KEYPAIR_PATH` | `../../.secrets/escrow.json` | Path to escrow keypair (real Solana only) |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Solana RPC endpoint |

### Agent Environment (`apps/agent/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_BASE_URL` | `http://localhost:4000` | Server endpoint |
| `DEMO_CACHE` | `1` | Use cached LLM outputs |
| `MOCK_SOLANA` | `1` | Use mock Solana lock tx |
| `BOUNTY_LAMPORTS` | `50000000` | Bounty amount (0.05 SOL) |
| `AGENT_PUBKEY` | `demo-agent` | Agent wallet address |
| `LLM_PROVIDER` | `openai` | `openai`, `anthropic`, or `gemini` |
| `OPENAI_API_KEY` | _(empty)_ | Required when provider=openai |
| `ANTHROPIC_API_KEY` | _(empty)_ | Required when provider=anthropic |
| `GEMINI_API_KEY` | _(empty)_ | Required when provider=gemini |
| `POLL_INTERVAL_MS` | `2000` | How often agent polls for answer |
| `POLL_TIMEOUT_MS` | `300000` | Max wait before timeout (5 min) |

## Coding Conventions

- Prefer TypeScript for server and agent.
- Keep server logic layered:
  - routes -> service -> store/solana
- Validate incoming payloads (Zod recommended) at the route boundary.
- Favor small files and explicit names; this is a hackathon codebase but should still be readable.

