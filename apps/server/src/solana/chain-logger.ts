import type { Connection, Keypair } from "@solana/web3.js";

export type ChainLoggerOpts = {
  mockSolana: boolean;
  conn?: Connection | null;
  keypair?: Keypair | null;
};

export class ChainLogger {
  private mock: boolean;

  constructor(private opts: ChainLoggerOpts) {
    this.mock = opts.mockSolana;
    if (this.mock) {
      console.log("[chain-logger] running in MOCK mode");
    }
  }

  async logFulfillment(
    taskId: string,
    subscriberAgentId: string,
    fulfillmentId: string
  ): Promise<string> {
    if (this.mock) {
      const sig = `MOCK_LOG_FULFILL_${taskId}`;
      console.log(`[chain-logger] ${sig}`);
      return sig;
    }
    return this.sendMemo(
      JSON.stringify({ type: "fulfillment", taskId, subscriberAgentId, fulfillmentId })
    );
  }

  async logVerification(
    taskId: string,
    verifierPubkey: string,
    score: number
  ): Promise<string> {
    if (this.mock) {
      const sig = `MOCK_LOG_VERIFY_${taskId}`;
      console.log(`[chain-logger] ${sig}`);
      return sig;
    }
    return this.sendMemo(
      JSON.stringify({ type: "verification", taskId, verifierPubkey, score })
    );
  }

  async logTrustUpdate(
    agentId: string,
    newScore: number,
    reason: string
  ): Promise<string> {
    if (this.mock) {
      const sig = `MOCK_LOG_TRUST_${agentId}`;
      console.log(`[chain-logger] ${sig}`);
      return sig;
    }
    return this.sendMemo(
      JSON.stringify({ type: "trust_update", agentId, newScore, reason })
    );
  }

  private async sendMemo(data: string): Promise<string> {
    // Real mode: send a Memo program transaction
    const { PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } =
      await import("@solana/web3.js");

    const conn = this.opts.conn!;
    const keypair = this.opts.keypair!;
    const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

    const ix = new TransactionInstruction({
      keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(data, "utf-8"),
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [keypair], { commitment: "confirmed" });
    console.log(`[chain-logger] logged memo: ${sig}`);
    return sig;
  }
}
