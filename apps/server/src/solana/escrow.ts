import fs from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { Task } from "@unblock/common";
import { createConnection } from "./connection";

export type EscrowServiceOpts = {
  mockSolana: boolean;
  solanaRpcUrl: string;
  escrowKeypairPath: string;
};

export class EscrowService {
  private mock: boolean;
  private conn: Connection | null = null;
  private escrowKeypair: Keypair | null = null;

  constructor(private opts: EscrowServiceOpts) {
    this.mock = opts.mockSolana;

    if (!this.mock) {
      this.conn = createConnection(opts.solanaRpcUrl);
      this.escrowKeypair = loadKeypair(opts.escrowKeypairPath);
      console.log(`[escrow] loaded keypair: ${this.escrowKeypair.publicKey.toBase58()}`);
    } else {
      console.log("[escrow] running in MOCK mode");
    }
  }

  get publicKey(): string {
    if (this.mock) return "MOCK_ESCROW_PUBKEY";
    return this.escrowKeypair!.publicKey.toBase58();
  }

  /**
   * Verify that lockTxSig is a confirmed SOL transfer
   * from agentPubkey to the escrow wallet for >= bountyLamports.
   */
  async verifyLockTx(
    lockTxSig: string,
    agentPubkey: string,
    bountyLamports: number
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.mock) {
      console.log(`[escrow] MOCK verifyLockTx: ${lockTxSig}`);
      return { ok: true };
    }

    const conn = this.conn!;
    const escrowPubkey = this.escrowKeypair!.publicKey.toBase58();

    try {
      const tx = await conn.getParsedTransaction(lockTxSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) return { ok: false, error: "Transaction not found" };
      if (tx.meta?.err) return { ok: false, error: `Transaction failed: ${JSON.stringify(tx.meta.err)}` };

      const instructions = tx.transaction.message.instructions;
      let foundValidTransfer = false;

      for (const ix of instructions) {
        if (
          "parsed" in ix &&
          ix.program === "system" &&
          ix.parsed?.type === "transfer"
        ) {
          const info = ix.parsed.info;
          if (
            info.source === agentPubkey &&
            info.destination === escrowPubkey &&
            info.lamports >= bountyLamports
          ) {
            foundValidTransfer = true;
            break;
          }
        }
      }

      if (!foundValidTransfer) {
        return { ok: false, error: "No matching transfer found (source/destination/amount mismatch)" };
      }

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: `Verification error: ${err?.message || String(err)}` };
    }
  }

  /**
   * Release bounty from escrow to the resolver.
   */
  async release(task: Task): Promise<string> {
    if (this.mock) {
      const sig = `MOCK_RELEASE_${task.id}`;
      console.log(`[escrow] MOCK release: ${sig}`);
      return sig;
    }

    if (!task.resolverPubkey) {
      throw new Error("Cannot release: task has no resolverPubkey");
    }

    const sig = await this.transfer(new PublicKey(task.resolverPubkey), task.bountyLamports);
    console.log(`[escrow] released ${task.bountyLamports} lamports -> ${task.resolverPubkey} (sig=${sig})`);
    return sig;
  }

  /**
   * Refund bounty from escrow back to the agent.
   */
  async refund(task: Task): Promise<string> {
    if (this.mock) {
      const sig = `MOCK_REFUND_${task.id}`;
      console.log(`[escrow] MOCK refund: ${sig}`);
      return sig;
    }

    const sig = await this.transfer(new PublicKey(task.agentPubkey), task.bountyLamports);
    console.log(`[escrow] refunded ${task.bountyLamports} lamports -> ${task.agentPubkey} (sig=${sig})`);
    return sig;
  }

  private async transfer(toPubkey: PublicKey, lamports: number): Promise<string> {
    const conn = this.conn!;
    const escrow = this.escrowKeypair!;

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: escrow.publicKey,
        toPubkey,
        lamports,
      })
    );

    const sig = await sendAndConfirmTransaction(conn, tx, [escrow], {
      commitment: "confirmed",
    });

    return sig;
  }
}

function loadKeypair(filePath: string): Keypair {
  const raw = fs.readFileSync(filePath, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}
