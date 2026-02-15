import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

function loadKeypair(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const airdropSol = Number(process.env.AIRDROP_SOL || "2");
  const secretsDir = path.resolve(process.cwd(), ".secrets");
  const agentPath = path.join(secretsDir, "agent.json");

  if (!fs.existsSync(agentPath)) {
    console.error("[scripts] missing .secrets/agent.json (run gen-keypairs first)");
    process.exit(1);
  }

  const agent = loadKeypair(agentPath);
  const conn = new Connection(rpcUrl, "confirmed");

  const agentPubkey = agent.publicKey.toBase58();
  console.log(`[scripts] requesting airdrop: ${airdropSol} SOL -> ${agentPubkey}`);

  let sig: string;
  try {
    sig = await conn.requestAirdrop(agent.publicKey, airdropSol * LAMPORTS_PER_SOL);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("429") || msg.toLowerCase().includes("airdrop limit")) {
      console.error("[scripts] airdrop rate-limited / faucet dry.");
      console.error(`[scripts] agent pubkey: ${agentPubkey}`);
      console.error("[scripts] options:");
      console.error("- Use the official faucet: https://faucet.solana.com (devnet) and fund the pubkey above");
      console.error("- Or have a teammate transfer devnet SOL to the pubkey above");
      console.error("- Or run the project in MOCK_SOLANA=1 mode (no on-chain transfers needed)");
      process.exit(2);
    }
    throw e;
  }
  console.log(`[scripts] airdrop sig: ${sig}`);

  const latest = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  console.log("[scripts] confirmed");
}

main().catch((e) => {
  console.error("[scripts] fatal:", e);
  process.exit(1);
});
