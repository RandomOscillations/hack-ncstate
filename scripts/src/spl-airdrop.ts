import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

function loadKeypair(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

function parseRecipientPubkey(v: string | undefined, fallback: PublicKey): PublicKey {
  if (!v) return fallback;
  return new PublicKey(v);
}

async function main() {
  // This is "airdrop" in the practical hackathon sense: we mint our own SPL token on devnet.
  // It is NOT a faucet for an arbitrary existing mint.
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const decimals = Number(process.env.DECIMALS || "6");
  const amount = Number(process.env.AMOUNT || "1000"); // human units (not base units)
  const mintAuthorityPath =
    process.env.MINT_AUTHORITY_KEYPAIR_PATH || path.resolve(process.cwd(), ".secrets/agent.json");

  if (!fs.existsSync(mintAuthorityPath)) {
    console.error(`[scripts] missing mint authority keypair: ${mintAuthorityPath}`);
    console.error(`[scripts] run: npm run scripts:gen-keypairs`);
    process.exit(1);
  }

  const authority = loadKeypair(mintAuthorityPath);
  const recipient = parseRecipientPubkey(process.env.RECIPIENT_PUBKEY, authority.publicKey);

  const conn = new Connection(rpcUrl, "confirmed");

  console.log(`[scripts] rpc: ${rpcUrl}`);
  console.log(`[scripts] mint authority: ${authority.publicKey.toBase58()}`);
  console.log(`[scripts] recipient:      ${recipient.toBase58()}`);
  console.log(`[scripts] decimals:       ${decimals}`);
  console.log(`[scripts] amount:         ${amount}`);

  const mint = await createMint(conn, authority, authority.publicKey, null, decimals);
  console.log(`[scripts] mint:           ${mint.toBase58()}`);

  const ata = await getOrCreateAssociatedTokenAccount(conn, authority, mint, recipient);
  console.log(`[scripts] recipient ATA:  ${ata.address.toBase58()}`);

  const baseUnits = BigInt(Math.round(amount * Math.pow(10, decimals)));
  const sig = await mintTo(conn, authority, mint, ata.address, authority, baseUnits);
  console.log(`[scripts] mintTo sig:     ${sig}`);

  console.log("[scripts] done");
}

main().catch((e) => {
  console.error("[scripts] fatal:", e);
  process.exit(1);
});

