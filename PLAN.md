# Multi-Agent Task Protocol — Implementation Plan

## Context

The existing Unblock.Agent v2 is a single-publisher, single-resolver flow: one agent creates a task, one human answers, agent confirms, escrow pays. We're extending this into a **multi-agent task marketplace protocol** with:

- **Publisher agents** that push tasks into a pub-sub network
- **Subscriber agents** that claim and fulfill tasks (first-claim model)
- **Supervisor agent** that AI-scores each fulfillment
- **Human verifier** that provides ground-truth scoring and gets paid
- **Trust system** tracking agent reputation on-chain
- **Blockchain audit trail** logging every fulfillment and verification

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fulfillment model | First-claim | One subscriber claims a task, simpler than competitive |
| Pub-sub layer | In-memory event bus | Simulates MQTT, swappable for real broker later |
| Disputed bounty | Stays in escrow | Re-published tasks reuse existing funds, no extra txs |
| Frontend approach | Extend existing UI | Faster, reuses proven components |

---

## New Task State Machine

```
OPEN ──► CLAIMED ──► FULFILLED ──► SCORED ──► UNDER_REVIEW ──► VERIFIED_PAID
  │                                                      └──► DISPUTED ──► (new OPEN task)
  └──► EXPIRED_REFUNDED
```

Legacy statuses (`ANSWERED`, `CONFIRMED_PAID`, `REJECTED_REFUNDED`) kept for backward compat with the existing single-agent flow.

---

## Protocol Flow

```
┌──────────────┐         ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│  Publisher    │         │  Subscriber  │        │  Supervisor  │        │   Verifier   │
│  Agent       │         │  Agent       │        │  Agent       │        │   (Human)    │
└──────┬───────┘         └──────┬───────┘        └──────┬───────┘        └──────┬───────┘
       │                        │                       │                       │
       │  1. Create task        │                       │                       │
       │  + lock bounty         │                       │                       │
       ├───────► OPEN           │                       │                       │
       │         │              │                       │                       │
       │         │  2. Claim    │                       │                       │
       │         ◄──────────────┤                       │                       │
       │         │► CLAIMED     │                       │                       │
       │         │              │                       │                       │
       │         │  3. Fulfill  │                       │                       │
       │         ◄──────────────┤                       │                       │
       │         │► FULFILLED   │  (logged on chain)    │                       │
       │         │              │                       │                       │
       │         │              │  4. Score             │                       │
       │         │              │◄──────────────────────┤                       │
       │         │► SCORED      │                       │                       │
       │         │► UNDER_REVIEW│                       │                       │
       │         │              │                       │  5. Verify            │
       │         │              │                       │◄──────────────────────┤
       │         │              │                       │                       │
       │    ┌────┴────┐         │                       │                       │
       │    │ Approve │         │                       │                       │
       │    │► VERIFIED_PAID    │  (70% bounty)         │  (30% bounty)        │
       │    │         │         │                       │                       │
       │    │ Dispute │         │                       │                       │
       │    │► DISPUTED         │  (trust -10)          │                       │
       │    │► new OPEN task    │                       │                       │
       │    └─────────┘         │                       │                       │
```

---

## Phase 1: Extend Data Model

**Files:** `packages/common/src/types.ts`, `packages/common/src/zod.ts`

### New Task Statuses

```typescript
export type TaskStatus =
  | "OPEN"              // publisher created, awaiting claim
  | "CLAIMED"           // subscriber claimed
  | "FULFILLED"         // subscriber submitted fulfillment
  | "SCORED"            // supervisor scored
  | "UNDER_REVIEW"      // assigned to human verifier
  | "VERIFIED_PAID"     // verifier approved, payments released
  | "DISPUTED"          // verifier disagreed, task re-circulated
  | "EXPIRED_REFUNDED"  // timeout
  // Legacy compat
  | "ANSWERED"
  | "CONFIRMED_PAID"
  | "REJECTED_REFUNDED";
```

### New Types

```typescript
// Agent identity
type AgentRole = "publisher" | "subscriber" | "supervisor";
type AgentRegistration = {
  agentId: string;
  name: string;
  role: AgentRole;
  pubkey: string;
  registeredAtMs: number;
  active: boolean;
};

// Trust system
type TrustRecord = {
  agentId: string;
  score: number;            // 0-100, starts at 50
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  lastUpdatedMs: number;
  history: TrustEvent[];
};
type TrustEvent = {
  taskId: string;
  delta: number;
  reason: string;
  timestampMs: number;
  txSig?: string;
};

// Fulfillment
type Fulfillment = {
  id: string;
  taskId: string;
  subscriberAgentId: string;
  fulfillmentText: string;
  fulfillmentData?: Record<string, unknown>;
  submittedAtMs: number;
};

// Supervisor scoring
type SupervisorScore = {
  id: string;
  taskId: string;
  fulfillmentId: string;
  supervisorAgentId: string;
  score: number;            // 0-100
  reasoning: string;
  passesThreshold: boolean;
  scoredAtMs: number;
};

// Verifier review
type VerifierReview = {
  id: string;
  taskId: string;
  fulfillmentId: string;
  scoreId: string;
  verifierPubkey: string;
  groundTruthScore: number;
  agreesWithSupervisor: boolean;
  feedback: string;
  reviewedAtMs: number;
};
```

### Extended Task

Add to existing `Task` type:

```typescript
// New protocol fields
publisherAgentId?: string;
subscriberAgentId?: string;
fulfillment?: Fulfillment;
supervisorScore?: SupervisorScore;
verifierReview?: VerifierReview;
subscriberPaymentTxSig?: string;
verifierPaymentTxSig?: string;
chainLogTxSig?: string;
previousTaskId?: string;      // for re-circulated tasks
attemptNumber?: number;
```

### New Request/Response Types

```typescript
type ClaimTaskRequest = { subscriberAgentId: string };
type SubmitFulfillmentRequest = { subscriberAgentId: string; fulfillmentText: string; fulfillmentData?: Record<string, unknown> };
type SubmitScoreRequest = { supervisorAgentId: string; score: number; reasoning: string };
type SubmitVerificationRequest = { verifierPubkey: string; groundTruthScore: number; agreesWithSupervisor: boolean; feedback: string };
type RegisterAgentRequest = { name: string; role: AgentRole; pubkey: string };
type RegisterAgentResponse = { agentId: string; trustScore: number };
```

### New Zod Schemas

- `ClaimTaskRequestSchema`
- `SubmitFulfillmentRequestSchema` (score: 0-100 range)
- `SubmitScoreRequestSchema` (score: 0-100 range)
- `SubmitVerificationRequestSchema` (pubkey min 10 chars)
- `RegisterAgentRequestSchema` (role enum validated)

---

## Phase 2: New Server Stores

### `apps/server/src/agents/registry.ts` — AgentRegistry

In-memory `Map<string, AgentRegistration>`.

| Method | Description |
|--------|-------------|
| `register(req)` | Create agent with UUID, initial trust |
| `get(agentId)` | Get by ID |
| `list()` | All agents |
| `listByRole(role)` | Filter by role |
| `deactivate(agentId)` | Mark inactive |

### `apps/server/src/agents/trust.ts` — TrustStore

In-memory `Map<string, TrustRecord>`.

| Method | Description |
|--------|-------------|
| `getOrCreate(agentId)` | Get or init at score 50 |
| `applyDelta(agentId, delta, taskId, reason, txSig?)` | Adjust score, log event |
| `get(agentId)` | Get record |
| `list()` | All records |
| `meetsThreshold(agentId)` | Check if score >= 20 |

**Trust deltas:**

| Event | Agent | Delta |
|-------|-------|-------|
| Fulfillment verified (verifier agrees) | subscriber | **+5** |
| Fulfillment disputed (verifier disagrees) | subscriber | **-10** |
| Supervisor agrees with verifier (within 15pts) | supervisor | **+2** |
| Supervisor far off (>30pts diff) | supervisor | **-5** |

### `apps/server/src/tasks/fulfillment-store.ts` — FulfillmentStore

In-memory `Map<string, Fulfillment>`.

| Method | Description |
|--------|-------------|
| `upsert(f)` | Store fulfillment |
| `get(id)` | Get by ID |
| `listByTask(taskId)` | All fulfillments for a task |

### `apps/server/src/agents/index.ts` — barrel export

---

## Phase 3: Pub-Sub Broker

### `apps/server/src/pubsub/broker.ts` — PubSubBroker

In-memory event bus simulating MQTT topics.

```typescript
type PubSubMessage = { topic: string; payload: Record<string, unknown>; publishedAtMs: number };
type Subscriber = { id: string; topicPattern: string; callback: (msg: PubSubMessage) => void };
```

| Method | Description |
|--------|-------------|
| `subscribe(sub)` | Register callback, returns unsubscribe fn |
| `publish(topic, payload)` | Dispatch to matching subscribers |
| `getLog()` | Return message history (for dashboard) |

**Topic structure:**

```
tasks/new                    — new task published
tasks/{taskId}/claimed       — task claimed by subscriber
tasks/{taskId}/fulfilled     — fulfillment submitted
tasks/{taskId}/scored        — supervisor scored
tasks/{taskId}/verified      — verification complete
agents/registered            — new agent joined
agents/{agentId}/trust       — trust score updated
```

### Integration

- Bridge to WebSocket: subscribe `*`, forward as `{ type: "pubsub", topic, payload }` WsEvent
- Extend `WsEvent` union in `ws/hub.ts`
- Wire in `apps/server/src/index.ts`

---

## Phase 4: Blockchain Logging

### `apps/server/src/solana/chain-logger.ts` — ChainLogger

Uses Solana Memo program to write audit entries on-chain.

| Method | Mock return | Real behavior |
|--------|-------------|---------------|
| `logFulfillment(taskId, agentId, fulfillmentId)` | `MOCK_LOG_FULFILL_{taskId}` | Memo tx with JSON |
| `logVerification(taskId, verifierPubkey, score)` | `MOCK_LOG_VERIFY_{taskId}` | Memo tx with JSON |
| `logTrustUpdate(agentId, newScore, reason)` | `MOCK_LOG_TRUST_{agentId}` | Memo tx with JSON |

### Split Payments — extend `apps/server/src/solana/escrow.ts`

New method: `releaseSplit(task, subscriberPubkey, verifierPubkey, subscriberShare=0.7)`
- Returns `{ subscriberTxSig, verifierTxSig }`
- Mock: `MOCK_RELEASE_SUB_{id}`, `MOCK_RELEASE_VER_{id}`
- Real: two transfers from escrow wallet

---

## Phase 5: Extended TaskService

**File:** `apps/server/src/tasks/service.ts`

New transition methods (same guard-validate-update-upsert pattern as existing):

| Method | From → To | Guards |
|--------|-----------|--------|
| `claimTask(taskId, subscriberAgentId)` | OPEN → CLAIMED | Must be OPEN |
| `submitFulfillment(taskId, req)` | CLAIMED → FULFILLED | Must be CLAIMED, same subscriber |
| `submitScore(taskId, req)` | FULFILLED → SCORED | Must be FULFILLED |
| `assignVerifier(taskId)` | SCORED → UNDER_REVIEW | Must be SCORED |
| `submitVerification(taskId, req)` | UNDER_REVIEW → VERIFIED_PAID or DISPUTED | Must be UNDER_REVIEW |
| `republishDisputed(taskId)` | Creates new OPEN task | Source must be DISPUTED |

Existing methods (`create`, `submitAnswer`, `markConfirmedPaid`, `markRejectedRefunded`) unchanged.

---

## Phase 6: New API Routes

**File:** `apps/server/src/http/routes.ts`

Update `makeRoutes()` to accept: `broker`, `agents`, `trust`, `chainLogger`, `fulfillments`.

### Agent Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents/register` | POST | Register agent → agentId + trust |
| `/api/agents` | GET | List all agents |
| `/api/agents/:agentId` | GET | Agent details + trust score |

### Extended Task Flow

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tasks/:id/claim` | POST | Subscriber claims (OPEN→CLAIMED) |
| `/api/tasks/:id/fulfill` | POST | Subscriber fulfills (CLAIMED→FULFILLED), chain log |
| `/api/tasks/:id/score` | POST | Supervisor scores (FULFILLED→SCORED→UNDER_REVIEW) |
| `/api/tasks/:id/verify` | POST | Verifier reviews → VERIFIED_PAID (split pay) or DISPUTED (re-publish) |

### Trust & Audit

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/trust` | GET | All trust scores |
| `/api/trust/:agentId` | GET | Single agent trust |
| `/api/audit` | GET | Pub-sub message log |

Each route follows existing pattern: Zod validate → call service → broadcast WsHub + PubSubBroker → respond JSON.

The `/api/tasks/:id/verify` route is the most complex — it:
1. Transitions state (VERIFIED_PAID or DISPUTED)
2. Splits payment via `escrow.releaseSplit()` (if approved)
3. Updates trust via `trust.applyDelta()`
4. Logs on chain via `chainLogger.logVerification()`
5. If disputed: calls `republishDisputed()` and publishes new task to broker
6. Broadcasts all events

---

## Phase 7: Agent Roles

### Publisher Agent (adapt existing)

**Files:** `apps/agent/src/index.ts`, `apps/agent/src/api.ts`

Minimal changes:
1. Add registration step at startup: `POST /api/agents/register` with `role: "publisher"`
2. Poll for `VERIFIED_PAID` or `DISPUTED` instead of `ANSWERED`
3. Extract existing flow into `publisherMain()` function

### Subscriber Agent (new)

**New file:** `apps/agent/src/subscriber.ts`

```
1. Register as subscriber
2. Poll for OPEN tasks
3. Claim first available task
4. Run LLM fulfillment (new prompt in prompts.json)
5. Submit fulfillment
6. Wait for VERIFIED_PAID or DISPUTED
7. Loop back to step 2
```

### Supervisor Agent (new)

**New file:** `apps/agent/src/supervisor.ts`

```
1. Register as supervisor
2. Poll for FULFILLED tasks
3. Score fulfillment via LLM (new prompt: evaluate quality, output JSON {score, reasoning})
4. Submit score
5. Loop back to step 2
```

### Entry Point Routing

**File:** `apps/agent/src/index.ts`

```typescript
const mode = env.agentMode; // "publisher" | "subscriber" | "supervisor"
if (mode === "publisher") publisherMain();
else if (mode === "subscriber") subscriberMain();
else if (mode === "supervisor") supervisorMain();
```

### New API Methods in `apps/agent/src/api.ts`

- `registerAgent(req)` — POST `/api/agents/register`
- `listTasks(filter?)` — GET `/api/tasks?status=...`
- `claimTask(taskId, agentId)` — POST `/api/tasks/:id/claim`
- `submitFulfillment(taskId, req)` — POST `/api/tasks/:id/fulfill`
- `submitScore(taskId, req)` — POST `/api/tasks/:id/score`

### New Env Vars (`apps/agent/src/env.ts`)

- `AGENT_MODE` — publisher|subscriber|supervisor (default: publisher)
- `AGENT_NAME` — display name for registration

### New Prompts (`apps/agent/src/prompts.json`)

- `subscriberFulfillment` — "Given this task: {question}, {context}. Provide a thorough fulfillment..."
- `supervisorScore` — "Score this fulfillment 0-100. Task: {question}. Fulfillment: {text}. Return JSON: {score, reasoning}"

### New Cache Entries (`apps/agent/src/llm-cache.json`)

- Cached responses for subscriber and supervisor prompts (demo mode)

---

## Phase 8: Frontend Extension

**Files:** `apps/web/public/index.html`, `apps/web/public/app.js`, `apps/web/public/styles.css`

### New Tabs

Add to tab bar: **Review** (UNDER_REVIEW tasks), **Agents** (agent pool + trust)

### Stats Ticker Update

Show: Open | Claimed | Fulfilled | Review | Verified | Disputed

### Verifier Review Panel (in detail area)

When a task is `UNDER_REVIEW`, the detail area shows:

1. **Original Task** — question, context, images (from publisher)
2. **Fulfillment Card** — subscriber's fulfillment text, subscriber agent ID
3. **Supervisor Score** — horizontal bar (0-100), pass/fail indicator, reasoning text
4. **Verification Form**:
   - Score slider (0-100)
   - Agree/Disagree toggle
   - Feedback textarea
   - Submit button

### Agent Pool Panel

Table showing: Agent Name | Role | Trust Score (colored badge) | Tasks Done | Status

### New Status Colors

```css
--status-claimed: #2563eb;      /* blue */
--status-fulfilled: #7c3aed;    /* violet */
--status-scored: #ea580c;       /* orange */
--status-review: #0891b2;       /* cyan */
--status-disputed: #dc2626;     /* red */
```

### New CSS Components

- `.fulfillment-card` — display fulfillment in a bordered card
- `.score-bar` — horizontal progress bar showing 0-100 score
- `.verification-form` — form layout for verifier input
- `.agent-table` — styled table for agent pool
- `.trust-badge` — colored pill showing trust level (red < 30, yellow 30-60, green > 60)

---

## Phase 9: Wiring & Config

### `apps/server/src/index.ts`

Instantiate and wire:
```typescript
const broker = new PubSubBroker();
const agentRegistry = new AgentRegistry();
const trustStore = new TrustStore();
const fulfillmentStore = new FulfillmentStore();
const chainLogger = new ChainLogger({ mockSolana: env.mockSolana, ... });

app.use("/api", makeRoutes(env, tasks, ws, escrow, broker, agentRegistry, trustStore, chainLogger, fulfillmentStore));
```

### `apps/server/src/env.ts`

New vars:
- `SUPERVISOR_SCORE_THRESHOLD` (default 60)
- `SUBSCRIBER_PAYMENT_SHARE` (default 0.7)
- `VERIFIER_PAYMENT_SHARE` (default 0.3)

### `.env.example` files — add new variables

### Root `package.json` — add scripts:
```json
"dev:publisher": "npm run build -w packages/common && AGENT_MODE=publisher npm run dev -w apps/agent",
"dev:subscriber": "npm run build -w packages/common && AGENT_MODE=subscriber npm run dev -w apps/agent",
"dev:supervisor": "npm run build -w packages/common && AGENT_MODE=supervisor npm run dev -w apps/agent"
```

---

## File Summary

### New Files (9)

| Path | Purpose |
|------|---------|
| `apps/server/src/pubsub/broker.ts` | In-memory pub-sub broker |
| `apps/server/src/pubsub/index.ts` | Barrel export |
| `apps/server/src/agents/registry.ts` | Agent registration store |
| `apps/server/src/agents/trust.ts` | Trust score store |
| `apps/server/src/agents/index.ts` | Barrel export |
| `apps/server/src/tasks/fulfillment-store.ts` | Fulfillment storage |
| `apps/server/src/solana/chain-logger.ts` | On-chain audit logging |
| `apps/agent/src/subscriber.ts` | Subscriber agent loop |
| `apps/agent/src/supervisor.ts` | Supervisor agent loop |

### Modified Files (16)

| Path | Changes |
|------|---------|
| `packages/common/src/types.ts` | New statuses, types, request/response |
| `packages/common/src/zod.ts` | New validation schemas |
| `apps/server/src/index.ts` | Wire new stores/services |
| `apps/server/src/env.ts` | New env vars |
| `apps/server/src/http/routes.ts` | New routes (agents, claim, fulfill, score, verify, trust, audit) |
| `apps/server/src/tasks/service.ts` | New state transitions |
| `apps/server/src/solana/escrow.ts` | `releaseSplit()` method |
| `apps/server/src/solana/index.ts` | Export ChainLogger |
| `apps/server/src/ws/hub.ts` | Extended WsEvent |
| `apps/agent/src/index.ts` | Mode router (publisher/subscriber/supervisor) |
| `apps/agent/src/api.ts` | New API methods |
| `apps/agent/src/env.ts` | New env vars (AGENT_MODE, AGENT_NAME) |
| `apps/agent/src/prompts.json` | New prompts for subscriber + supervisor |
| `apps/agent/src/llm-cache.json` | Cached responses for demo |
| `apps/web/public/index.html` | New tabs, verifier form, agent pool section |
| `apps/web/public/app.js` | New API calls, state, renderers |
| `apps/web/public/styles.css` | New status colors, component styles |

---

## Verification

Run the full demo:

```bash
# Terminal 1: Server
npm run dev:server

# Terminal 2: Publisher
AGENT_MODE=publisher npm run dev:agent

# Terminal 3: Subscriber
AGENT_MODE=subscriber npm run dev:agent

# Terminal 4: Supervisor
AGENT_MODE=supervisor npm run dev:agent

# Browser: http://localhost:4000
```

Check:
- [ ] Publisher creates task → OPEN in UI
- [ ] Subscriber claims → CLAIMED
- [ ] Subscriber fulfills → FULFILLED
- [ ] Supervisor scores → SCORED → UNDER_REVIEW
- [ ] Verifier sees Review tab, submits score
- [ ] Approved path: VERIFIED_PAID, payments split, trust +5 for subscriber
- [ ] Disputed path: DISPUTED, trust -10, new OPEN task appears
- [ ] Agent pool shows all agents with trust scores
- [ ] Activity drawer shows all events with mock chain tx sigs
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
