import type { AgentEnv } from "./env";

export type LockResult = {
  lockTxSig: string;
};

export async function sendLockTransaction(env: AgentEnv, bountyLamports: number): Promise<LockResult> {
  if (env.mockSolana) {
    const mockSig = `MOCK_LOCK_${Date.now()}`;
    return { lockTxSig: mockSig };
  }

  // Real Solana: transfer bountyLamports from agent wallet -> escrow wallet
  const fs = await import("node:fs");
  const {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    SystemProgram,
    sendAndConfirmTransaction,
  } = await import("@solana/web3.js");

  if (!env.escrowPubkey) throw new Error("ESCROW_PUBKEY not set for real Solana mode");

  const raw = fs.readFileSync(env.agentKeypairPath, "utf8");
  const agentKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  const escrowPubkey = new PublicKey(env.escrowPubkey);

  const connection = new Connection(env.solanaRpcUrl, "confirmed");

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: agentKeypair.publicKey,
      toPubkey: escrowPubkey,
      lamports: bountyLamports,
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [agentKeypair]);
  return { lockTxSig: sig };
}
