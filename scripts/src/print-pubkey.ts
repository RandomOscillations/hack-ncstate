import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";

function loadKeypair(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

function main() {
  const which = (process.argv[2] || "agent").toLowerCase();
  const secretsDir = path.resolve(process.cwd(), ".secrets");
  const filePath = path.join(secretsDir, `${which}.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`[scripts] missing keypair: ${filePath}`);
    process.exit(1);
  }

  const kp = loadKeypair(filePath);
  console.log(kp.publicKey.toBase58());
}

main();

