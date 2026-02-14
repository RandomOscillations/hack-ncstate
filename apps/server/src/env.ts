import path from "node:path";

export type ServerEnv = {
  port: number;
  resolverDemoToken?: string;
  mockSolana: boolean;
  solanaRpcUrl: string;
  escrowKeypairPath: string;
  webPublicDir: string;
};

export function loadEnv(): ServerEnv {
  const port = Number(process.env.PORT || "4000");
  const resolverDemoToken = process.env.RESOLVER_DEMO_TOKEN || undefined;
  const mockSolana = (process.env.MOCK_SOLANA || "1") === "1";
  const solanaRpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const escrowKeypairPath =
    process.env.ESCROW_KEYPAIR_PATH || path.resolve(process.cwd(), "../../.secrets/escrow.json");

  // When running `npm -w apps/server run dev`, cwd is `apps/server`.
  const webPublicDir = process.env.WEB_PUBLIC_DIR || path.resolve(process.cwd(), "../web/public");

  return { port, resolverDemoToken, mockSolana, solanaRpcUrl, escrowKeypairPath, webPublicDir };
}

