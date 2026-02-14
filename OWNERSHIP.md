# Ownership (Dev1..Dev5)

This file is the single source of truth for "who owns what" so 5 devs can work in parallel with minimal merge conflicts.

## Modules and Owners

### Dev1: Solana Escrow + Verification (Server)
- Owns:
  - `apps/server/src/solana/*`
  - escrow keypair loading/management
  - lock-tx verification logic (agent -> escrow transfer)
  - release and refund transfer logic (escrow -> resolver / escrow -> agent)
- Must not change:
  - HTTP route shapes without coordinating with Dev2/Dev3
- Deliverables:
  - `verifyLockTx(lockTxSig, agentPubkey, bountyLamports) -> ok | error`
  - `release(task) -> releaseTxSig`
  - `refund(task) -> refundTxSig`

### Dev2: Task API + Store + WebSocket (Server)
- Owns:
  - `apps/server/src/http/*`
  - `apps/server/src/tasks/*`
  - `apps/server/src/ws/*`
  - task state machine and validation
- Must not change:
  - shared types in `packages/common` without coordinating with Dev5/Dev3/Dev4
- Deliverables:
  - Endpoints: create/list/get/answer/confirm/reject
  - Status transitions:
    - `OPEN -> ANSWERED -> CONFIRMED_PAID`
    - `OPEN -> ANSWERED -> REJECTED_REFUNDED`
    - optional `OPEN -> EXPIRED_REFUNDED`
  - WebSocket broadcast on create/update (UI still supports polling)

### Dev3: Agent Runner (LLM + Payment + Polling)
- Owns:
  - `apps/agent/src/*`
  - LLM integration (OpenAI or Anthropic)
  - agent step flow and terminal output
  - agent-side Solana signing/payment for the lock transaction
- Must not change:
  - server API shapes without coordinating with Dev2
- Deliverables:
  - Steps 1-2: LLM calls
  - Step 3: pay lock tx -> `POST /api/tasks` -> poll `GET /api/tasks/:id`
  - Confirm or reject path (for demo, happy path must be rock solid)

### Dev4: Human UI (Static)
- Owns:
  - `apps/web/public/*`
  - demo assets under `apps/web/public/assets/*`
- Must not change:
  - server endpoints without coordinating with Dev2
- Deliverables:
  - Task list view with prominent bounty + images
  - Answer submit form
  - Local settings:
    - resolver pubkey saved once (localStorage)
    - demo token saved once (localStorage)
  - "PAID" UI state with tx signature link (or signature text)

### Dev5: Shared Types + Tooling + Docs + Integration Glue
- Owns:
  - `packages/common/*`
  - root `package.json` / workspaces / scripts wiring
  - `README.md`, `CLAUDE.md`, `OWNERSHIP.md`, `.github/CODEOWNERS`
  - demo-mode toggles (`MOCK_SOLANA`, `DEMO_CACHE`) standardization
- Deliverables:
  - Shared API request/response types
  - Zod schemas (optional but recommended) for runtime validation
  - "10 minute quickstart" docs

## Interfaces (Contract That Should Not Break)

### Shared Types
- Canonical types live in `packages/common/src/types.ts`.
- Server/agent/web should import from `@unblock/common` (workspace package).

### Server API
- All endpoints are under `/api/*`.
- Resolver submit requires header `x-demo-token` when `RESOLVER_DEMO_TOKEN` is set.

## Demo Reliability Rules

- The happy path must work even if:
  - WebSocket fails (polling still works)
  - Solana devnet is flaky (`MOCK_SOLANA=1` fallback)
  - LLM is slow (agent step outputs should still look good)

## Who Is On Point During Live Demo

- Dev3 runs the agent in the terminal.
- Dev4 operates the UI tab (as resolver).
- Dev2 watches server logs and can restart quickly if needed.
- Dev1 is on standby for devnet/tx issues.
- Dev5 handles narration and the backup video if needed.

