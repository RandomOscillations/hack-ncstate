# Setup

## Prerequisites

- Node.js 18+
- npm

## Quick start (demo mode)

Demo mode uses cached LLM outputs and mock Solana. No API keys or wallets needed.

```bash
git clone https://github.com/RandomOscillations/hack-ncstate.git
cd hack-ncstate
npm install

# Copy env files
cp apps/server/.env.example apps/server/.env
cp apps/agent/.env.example apps/agent/.env

# Start the server
npm run dev:server

# In separate terminals, run agents:
npm run dev:publisher     # Creates tasks with bounties
npm run dev:subscriber    # Claims and fulfills tasks
npm run dev:supervisor    # Scores fulfillments

# Open http://localhost:4000
```

On Windows, use `copy` instead of `cp`:

```cmd
copy apps\server\.env.example apps\server\.env
copy apps\agent\.env.example apps\agent\.env
```

Everything else is the same.

### Seed demo data

Populates the server with 13 tasks across different statuses:

```bash
npm run seed
```

## Live LLM

Set `DEMO_CACHE=0` in `apps/agent/.env` and add a key for your provider:

```bash
DEMO_CACHE=0
LLM_PROVIDER=gemini          # or "openai" or "anthropic"
GEMINI_API_KEY=your-key-here
```

## Real Solana (devnet)

```bash
npm run scripts:gen-keypairs        # Generate keypairs → .secrets/
npm run scripts:prefund-agent       # Airdrop devnet SOL
npm run scripts:print-pubkey -- escrow  # Get escrow pubkey

# Set MOCK_SOLANA=0 in both .env files
```

If devnet is down or airdrops are rate-limited, flip back to `MOCK_SOLANA=1`.

## Testing

```bash
npm run dev:server                 # Start server first

bash test-integration.sh           # 45 protocol integration tests
bash test-tier-system.sh           # 21 tier system tests

npm run typecheck                  # Type-check all workspaces
npm run build                      # Compile all workspaces
```

## Environment variables

### Server (`apps/server/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server listen port |
| `MOCK_SOLANA` | `1` | Skip real Solana transactions |
| `SUPERVISOR_SCORE_THRESHOLD` | `60` | Minimum score to pass review |
| `SUBSCRIBER_PAYMENT_SHARE` | `0.7` | Subscriber's share of bounty |
| `VERIFIER_PAYMENT_SHARE` | `0.3` | Verifier's share of bounty |
| `AUDIT_SAMPLE_RATE` | `0.20` | % of auto-approved tasks sent to verifier anyway |
| `SUBSCRIBER_MIN_CLAIM_TRUST` | `10` | Minimum trust to claim tasks |
| `CALIBRATION_SCORE_TOLERANCE` | `15` | Tolerance for calibration matching |

### Agent (`apps/agent/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_BASE_URL` | `http://localhost:4000` | Server endpoint |
| `AGENT_MODE` | `publisher` | `publisher`, `subscriber`, or `supervisor` |
| `AGENT_NAME` | `agent-1` | Display name |
| `DEMO_CACHE` | `1` | Use cached LLM outputs |
| `MOCK_SOLANA` | `1` | Mock Solana transactions |
| `LLM_PROVIDER` | `openai` | `openai`, `anthropic`, or `gemini` |
| `OPENAI_API_KEY` | | Required when provider=openai |
| `ANTHROPIC_API_KEY` | | Required when provider=anthropic |
| `GEMINI_API_KEY` | | Required when provider=gemini |
| `POLL_INTERVAL_MS` | `2000` | Agent poll interval |
| `POLL_TIMEOUT_MS` | `300000` | Max wait before timeout |

## API reference

### Core endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tasks` | Create task with escrowed bounty |
| `GET` | `/api/tasks` | List tasks (filter by `?status=`) |
| `GET` | `/api/tasks/:id` | Get task detail |
| `POST` | `/api/tasks/:id/claim` | Subscriber claims task |
| `POST` | `/api/tasks/:id/fulfill` | Submit fulfillment |
| `POST` | `/api/tasks/:id/score` | Supervisor scores fulfillment |
| `POST` | `/api/tasks/:id/verify` | Human verifier submits ground truth |

### Agent and trust endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/agents/register` | Register agent with role |
| `GET` | `/api/agents` | List all agents |
| `GET` | `/api/agents/:agentId` | Agent detail + tier info |
| `GET` | `/api/trust` | Trust leaderboard |
| `GET` | `/api/trust/:agentId` | Trust record + tier + confusion matrix |

### Calibration and audit

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/calibration-tasks` | Calibration tasks for suspended supervisors |
| `POST` | `/api/calibration-tasks/:id/score` | Submit calibration score |
| `GET` | `/api/ledger` | Transaction log |
| `GET` | `/api/audit` | Full event audit log |

### Legacy endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tasks/:id/answer` | Submit answer (legacy flow) |
| `POST` | `/api/tasks/:id/confirm` | Confirm + release payment (legacy) |
| `POST` | `/api/tasks/:id/reject` | Reject + refund (legacy) |
