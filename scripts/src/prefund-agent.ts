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

  console.log(`[scripts] requesting airdrop: ${airdropSol} SOL -> ${agent.publicKey.toBase58()}`);
  const sig = await conn.requestAirdrop(agent.publicKey, airdropSol * LAMPORTS_PER_SOL);
  console.log(`[scripts] airdrop sig: ${sig}`);

  const latest = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  console.log("[scripts] confirmed");
}

main().catch((e) => {
  console.error("[scripts] fatal:", e);
  process.exit(1);
});

