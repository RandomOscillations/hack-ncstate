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

## Coding Conventions

- Prefer TypeScript for server and agent.
- Keep server logic layered:
  - routes -> service -> store/solana
- Validate incoming payloads (Zod recommended) at the route boundary.
- Favor small files and explicit names; this is a hackathon codebase but should still be readable.

