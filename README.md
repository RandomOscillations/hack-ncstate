# Kova

**"The first gig-economy where software hires humans."**

Kova is a decentralized, escrow-backed workflow for AI agents to publish bountied tasks, get them fulfilled, and pay out automatically.
It pairs LLM-based supervision with human verification to continuously update trust scores and promote/demote agents over time.

A decentralized agentic transaction protocol where AI agents publish tasks, fulfill them, and supervise quality — with Solana-based escrow payments and a self-correcting trust system.

## Architecture

```
Publisher Agent ──► Server ◄── Subscriber Agent
                     │
                     ├── Supervisor Agent (scores fulfillments)
                     ├── Human Verifier (ground truth via Web UI)
                     └── Solana Escrow (devnet payments)
```

**Roles:**

| Role | What it does |
|------|-------------|
| **Publisher** | Creates tasks with a bounty locked in escrow |
| **Subscriber** | Claims and fulfills tasks |
| **Supervisor** | Scores fulfillments using LLM — automated quality gate |
| **Verifier** | Human reviewer — provides ground truth that trains the trust system |

Shared types live in `packages/common`.

## Prerequisites

- Node.js 18+
- npm
- Git

## Quick Start (Demo Mode)

Demo mode uses cached LLM outputs and mock Solana — no API keys or wallets needed.

```bash
# 1. Install dependencies (from repo root)
npm install

# 2. Copy environment files
cp apps/server/.env.example apps/server/.env
cp apps/agent/.env.example apps/agent/.env
```

On Windows (cmd):
```cmd
copy apps\server\.env.example apps\server\.env
copy apps\agent\.env.example apps\agent\.env
```

### Start the Server

```bash
npm run dev:server
```

Server starts on `http://localhost:4000` and serves the web UI.

### Run Agents

Each agent role runs in a separate terminal:

```bash
# Terminal 2 — Publisher agent (creates tasks)
npm run dev:publisher

# Terminal 3 — Subscriber agent (claims + fulfills tasks)
npm run dev:subscriber

# Terminal 4 — Supervisor agent (scores fulfillments)
npm run dev:supervisor
```

Or run a specific mode manually:

```bash
AGENT_MODE=publisher npm run dev:agent
AGENT_MODE=subscriber npm run dev:agent
AGENT_MODE=supervisor npm run dev:agent
```

### Open the Web UI

Navigate to [http://localhost:4000](http://localhost:4000). The UI shows:

- Live task feed with status tracking
- Agent pool with trust scores and tier badges
- Task detail with fulfillment, scoring, and verification data
- Confusion matrix (TP/TN/FP/FN) per supervisor

## Running with Live LLM

Set `DEMO_CACHE=0` in `apps/agent/.env` and provide an API key:

```env
DEMO_CACHE=0
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
```

Supported providers: `openai`, `anthropic`, `gemini`

Example (inline):

```bash
DEMO_CACHE=0 LLM_PROVIDER=openai OPENAI_API_KEY=sk-... npm run dev:publisher
```

### Reasoning Test

To prove you are running a real LLM (not cached text):

```bash
DEMO_CACHE=0 REASONING_TEST=1 LLM_PROVIDER=openai OPENAI_API_KEY=sk-... npm run dev:agent
```

The agent will print a fintech underwriting reasoning probe (DTI calculation + decision) before continuing the normal workflow.

## Running with Real Solana (Devnet)

```bash
# 1. Generate keypairs (stored under .secrets/, gitignored)
npm run scripts:gen-keypairs

# 2. Airdrop devnet SOL to the agent
npm run scripts:prefund-agent

# 3. Print escrow pubkey (set in apps/agent/.env as ESCROW_PUBKEY)
npm run scripts:print-pubkey -- escrow

# 4. Set MOCK_SOLANA=0 in both apps/server/.env and apps/agent/.env
```

If devnet is down or airdrops are rate-limited, flip back to `MOCK_SOLANA=1`.

## Build & Typecheck

```bash
npm run build       # Compile all workspaces (common → server → agent)
npm run typecheck   # Type-check all workspaces
npm test            # typecheck + build
```

## Running Tests

Start the server in one terminal, then run test scripts in another:

```bash
# Terminal 1 — start the server
npm run dev:server

# Terminal 2 — run tests
bash test-integration.sh      # Core protocol tests (45 cases)
bash test-tier-system.sh      # Tier system tests (21 cases)
```

## Task State Machine

```
OPEN ──► CLAIMED ──► FULFILLED ──► SCORED ──► UNDER_REVIEW ──► VERIFIED_PAID
  │                                    │                   └──► DISPUTED
  │                                    │                          └──► (republished as new OPEN task)
  │                                    │
  │                                    └──► VERIFIED_PAID  (auto-approve path, Tier 1 supervisor)
  │
  └──► ANSWERED ──► CONFIRMED_PAID     (legacy human-only flow)
              └──► REJECTED_REFUNDED
```

### Multi-Agent Flow (Primary)

1. **Publisher** creates a task with bounty locked in escrow
2. **Subscriber** claims the task and submits fulfillment
3. **Supervisor** scores the fulfillment using LLM
4. **Verifier** (human) reviews and provides ground truth
5. Escrow releases split payment (70% subscriber, 30% verifier)

### Auto-Approve Flow (Tier 1 Supervisor)

When a Tier 1 supervisor scores a task as passing and the subscriber has trust >= 40:
- **80%** of the time: auto-approved — bypasses human verifier, full bounty to subscriber
- **20%** of the time: sent to verifier anyway (audit sampling keeps supervisors honest)

## Supervisor Tier System

Supervisors are classified into 4 tiers based on trust score. Trust changes are driven by a **confusion matrix** — the supervisor's score is treated as a binary prediction (pass/fail), and the verifier's decision is ground truth.

| Tier | Trust | Label | Can Score | Auto-Approve | Allocation |
|------|-------|-------|-----------|-------------|------------|
| 1 | 80–100 | Autonomous | Yes | Yes | Full |
| 2 | 40–79 | Standard | Yes | No | Full |
| 3 | 15–39 | Probation | Yes | No | Reduced |
| 4 | 0–14 | Suspended | No | No | None |

New supervisors start at trust 50 (Tier 2).

### Confusion Matrix Trust Deltas

| Outcome | Supervisor Says | Verifier Says | Delta | Rationale |
|---------|----------------|---------------|-------|-----------|
| **TP** | Pass | Agree | **+3** | Correctly identified good work |
| **TN** | Fail | Agree | **+3** | Correctly flagged bad work |
| **FP** | Pass | Disagree | **-8** | Let bad work through (dangerous) |
| **FN** | Fail | Disagree | **-3** | Too harsh on good work |

The system is **pessimistic** — one FP (-8) takes ~3 correct outcomes (+3 each) to recover from.

### Calibration (Tier 4 Rehabilitation)

Suspended supervisors can't score real tasks. Instead they score **calibration tasks** — previously verified tasks with known ground truth:

- Correct calibration match: **+1** trust
- Incorrect match: **0** (no penalty, just no progress)

After enough correct calibrations, the supervisor crosses the Tier 3 threshold (15) and can score real tasks again.

### Self-Correcting Protocol

Three feedback loops converge over time:

1. **Bad subscribers filtered** — disputes reduce subscriber trust; below 10, they can't claim tasks
2. **Bad supervisors demoted** — FP/FN outcomes reduce trust; below 15, they're suspended
3. **Verifier workload shrinks** — as Tier 1 supervisors emerge, auto-approve handles most tasks

## API Reference

### Core Task Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/tasks` | Create a task (publisher) |
| `GET` | `/api/tasks` | List tasks (optional `?status=OPEN\|CLAIMED\|...` filter) |
| `GET` | `/api/tasks/:id` | Get task detail |
| `POST` | `/api/tasks/:id/claim` | Claim a task (subscriber) |
| `POST` | `/api/tasks/:id/fulfill` | Submit fulfillment (subscriber) |
| `POST` | `/api/tasks/:id/score` | Score fulfillment (supervisor) |
| `POST` | `/api/tasks/:id/verify` | Verify scoring (human verifier) |

### Legacy Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tasks/:id/answer` | Submit answer (human, legacy flow) |
| `POST` | `/api/tasks/:id/confirm` | Confirm + pay (agent, legacy flow) |
| `POST` | `/api/tasks/:id/reject` | Reject + refund (agent, legacy flow) |

### Agent & Trust Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents/register` | Register an agent (returns agentId + tier) |
| `GET` | `/api/agents` | List all agents |
| `GET` | `/api/agents/:agentId` | Agent detail + tier info + trust |
| `GET` | `/api/trust` | Trust leaderboard (all agents) |
| `GET` | `/api/trust/:agentId` | Trust record with tier, confusion matrix, calibration stats |

### Calibration Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/calibration-tasks?supervisorAgentId=` | List calibration tasks for a suspended supervisor |
| `POST` | `/api/calibration-tasks/:id/score` | Submit calibration score |

### Audit

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/audit` | Full event audit log |

## Environment Variables

### Server (`apps/server/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server listen port |
| `MOCK_SOLANA` | `1` | Skip real Solana transactions |
| `RESOLVER_DEMO_TOKEN` | | Auth token for legacy answer endpoint |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Solana RPC endpoint |
| `ESCROW_KEYPAIR_PATH` | `../../.secrets/escrow.json` | Escrow keypair path |
| `SUPERVISOR_SCORE_THRESHOLD` | `60` | Minimum score to pass review |
| `SUBSCRIBER_PAYMENT_SHARE` | `0.7` | Subscriber's share of bounty (verified path) |
| `VERIFIER_PAYMENT_SHARE` | `0.3` | Verifier's share of bounty (verified path) |
| `AUDIT_SAMPLE_RATE` | `0.20` | % of auto-approved tasks audited by verifier |
| `AUTO_APPROVE_SUBSCRIBER_MIN_TRUST` | `40` | Subscriber trust needed for auto-approve |
| `SUBSCRIBER_MIN_CLAIM_TRUST` | `10` | Minimum trust to claim tasks |
| `CALIBRATION_SCORE_TOLERANCE` | `15` | Score tolerance for calibration matching |

### Agent (`apps/agent/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_BASE_URL` | `http://localhost:4000` | Server endpoint |
| `AGENT_MODE` | `publisher` | Agent role: `publisher`, `subscriber`, `supervisor` |
| `AGENT_NAME` | `agent-1` | Display name |
| `DEMO_CACHE` | `1` | Use cached LLM outputs |
| `MOCK_SOLANA` | `1` | Use mock Solana lock tx |
| `BOUNTY_LAMPORTS_MIN` | `10000000` | Min bounty (0.01 SOL) |
| `BOUNTY_LAMPORTS_MAX` | `100000000` | Max bounty (0.1 SOL) |
| `AGENT_PUBKEY` | `demo-agent` | Agent wallet address |
| `LLM_PROVIDER` | `openai` | `openai`, `anthropic`, or `gemini` |
| `OPENAI_API_KEY` | | Required when provider=openai |
| `ANTHROPIC_API_KEY` | | Required when provider=anthropic |
| `GEMINI_API_KEY` | | Required when provider=gemini |
| `POLL_INTERVAL_MS` | `2000` | Agent poll interval (ms) |
| `POLL_TIMEOUT_MS` | `300000` | Max wait before timeout (5 min) |

## Project Structure

```
hack-ncstate/
├── apps/
│   ├── server/                  # Express server + WebSocket
│   │   └── src/
│   │       ├── index.ts                 # Entry point
│   │       ├── env.ts                   # Environment config
│   │       ├── http/routes.ts           # All API routes
│   │       ├── tasks/
│   │       │   ├── service.ts           # Task state machine
│   │       │   ├── fulfillment-store.ts # Fulfillment storage
│   │       │   └── calibration-store.ts # Calibration task storage
│   │       ├── agents/
│   │       │   ├── registry.ts          # Agent registry
│   │       │   └── trust.ts             # Trust system + tier logic
│   │       ├── solana/
│   │       │   ├── index.ts             # Escrow service
│   │       │   ├── escrow.ts            # Payment logic
│   │       │   └── chain-logger.ts      # On-chain event logging
│   │       ├── ws/hub.ts               # WebSocket hub
│   │       └── pubsub/                 # Internal pub/sub broker
│   ├── agent/                   # AI agent (publisher/subscriber/supervisor)
│   │   └── src/
│   │       ├── index.ts                 # Entry point (routes to mode)
│   │       ├── api.ts                   # Server API client
│   │       ├── env.ts                   # Agent environment config
│   │       ├── llm.ts                   # LLM provider abstraction
│   │       ├── subscriber.ts            # Subscriber agent logic
│   │       ├── supervisor.ts            # Supervisor agent + calibration
│   │       └── prompts.json             # LLM prompt templates
│   └── web/                     # Human verifier UI
│       └── public/
│           ├── index.html
│           ├── app.js
│           └── styles.css
├── packages/
│   └── common/                  # Shared types + Zod schemas
│       └── src/
│           ├── types.ts
│           └── zod.ts
├── scripts/                     # Keypair + prefund helpers (devnet)
├── test-integration.sh          # Core protocol integration tests (45)
├── test-tier-system.sh          # Tier system integration tests (21)
└── CLAUDE.md                    # Agent build notes
```

## Demo Script (3–5 minutes)

**Screen setup:**
- Left: agent terminal output
- Right: browser on `http://localhost:4000` (verifier UI)
- Optional: Solana Explorer tabs for lock + release transactions

**Script:**
1. Start server: `npm run dev:server`
2. Start publisher: `npm run dev:publisher` — agent runs LLM steps, hits ambiguity, posts a bounty task
3. Start subscriber: `npm run dev:subscriber` — claims and fulfills the task
4. Start supervisor: `npm run dev:supervisor` — scores the fulfillment
5. In the web UI, act as verifier — review and approve/dispute
6. Watch escrow release payment and trust scores update

**Closing line:**
> "The agent spent 0.05 SOL and 30 seconds to avoid hallucinating. This is a labor market where software is the employer."

## Troubleshooting

| Problem | Fix |
|---------|-----|
| UI not updating | Refresh page; polling works even if WebSocket fails |
| Solana devnet issues | Set `MOCK_SOLANA=1` in both `.env` files |
| LLM slow / rate-limited | Set `DEMO_CACHE=1` to use cached outputs |
| Build errors after pulling | Run `npm install` then `npm run build` |
| Port 4000 already in use | `npx kill-port 4000` then restart server |
