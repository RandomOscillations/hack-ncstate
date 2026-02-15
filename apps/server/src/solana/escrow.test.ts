import { describe, it, expect } from "vitest";
import { createMockEscrow, createSolanaEscrow } from "./escrow";
import type { Task } from "@unblock/common";

const MOCK_TASK: Task = {
  id: "task-123",
  createdAtMs: Date.now(),
  updatedAtMs: Date.now(),
  question: "What color?",
  imageUrls: [],
  bountyLamports: 100_000,
  agentPubkey: "AgentPubkey1234567890",
  status: "ANSWERED",
  resolverPubkey: "ResolverPubkey1234567890",
  answerText: "Blue",
};

describe("createMockEscrow", () => {
  const escrow = createMockEscrow();

  it("verifyLockTx always returns ok", async () => {
    const result = await escrow.verifyLockTx("sig", "pubkey", 100_000);
    expect(result).toEqual({ ok: true });
  });

  it("release returns deterministic mock sig", async () => {
    const sig = await escrow.release(MOCK_TASK);
    expect(sig).toBe("MOCK_RELEASE_task-123");
  });

  it("refund returns deterministic mock sig", async () => {
    const sig = await escrow.refund(MOCK_TASK);
    expect(sig).toBe("MOCK_REFUND_task-123");
  });
});

describe("createSolanaEscrow", () => {
  it("throws because real Solana is not implemented", () => {
    expect(() => createSolanaEscrow("https://api.devnet.solana.com", "/fake/path")).toThrow(
      "not implemented"
    );
  });
});
