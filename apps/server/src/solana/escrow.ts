import type { Task } from "@unblock/common";
import type { EscrowAdapter } from "../http/routes";

/**
 * Mock escrow adapter — returns deterministic fake tx signatures.
 * Used when MOCK_SOLANA=1 for reliable demos without real Solana.
 */
export function createMockEscrow(): EscrowAdapter {
  return {
    async verifyLockTx(_lockTxSig, _agentPubkey, _bountyLamports) {
      console.log("[escrow:mock] verifyLockTx — auto-approved");
      return { ok: true };
    },
    async release(task: Task) {
      const sig = `MOCK_RELEASE_${task.id}`;
      console.log(`[escrow:mock] release → ${sig}`);
      return sig;
    },
    async refund(task: Task) {
      const sig = `MOCK_REFUND_${task.id}`;
      console.log(`[escrow:mock] refund → ${sig}`);
      return sig;
    },
  };
}

/**
 * Real Solana escrow adapter — placeholder for Dev1 to implement.
 * Uses @solana/web3.js to verify lock txs and send release/refund transfers.
 */
export function createSolanaEscrow(_rpcUrl: string, _escrowKeypairPath: string): EscrowAdapter {
  // TODO(Dev1): Implement real Solana escrow using @solana/web3.js
  // - Load escrow keypair from _escrowKeypairPath
  // - Connect to _rpcUrl
  // - verifyLockTx: confirm tx on-chain, check amount/recipient
  // - release: send SOL from escrow to task.resolverPubkey
  // - refund: send SOL from escrow back to task.agentPubkey
  throw new Error("Real Solana escrow not implemented yet — use MOCK_SOLANA=1");
}
