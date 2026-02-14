import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";

function writeKeypair(filePath: string, kp: Keypair) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey), null, 2), "utf8");
}

function main() {
  const secretsDir = path.resolve(process.cwd(), ".secrets");
  const agentPath = path.join(secretsDir, "agent.json");
  const escrowPath = path.join(secretsDir, "escrow.json");

  if (fs.existsSync(agentPath) || fs.existsSync(escrowPath)) {
    console.log("[scripts] .secrets already exists. Refusing to overwrite.");
    console.log(`[scripts] agent: ${agentPath}`);
    console.log(`[scripts] escrow: ${escrowPath}`);
    process.exit(0);
  }

  const agent = Keypair.generate();
  const escrow = Keypair.generate();

  writeKeypair(agentPath, agent);
  writeKeypair(escrowPath, escrow);

  console.log("[scripts] wrote keypairs:");
  console.log(`- agent:  ${agent.publicKey.toBase58()}`);
  console.log(`- escrow: ${escrow.publicKey.toBase58()}`);
  console.log(`[scripts] files: ${secretsDir}/`);
}

main();

