import path from "node:path";

export type AgentEnv = {
  serverBaseUrl: string;
  bountyLamports: number;
  agentPubkey: string;
  demoCache: boolean;
  mockSolana: boolean;
  llmProvider: "openai" | "anthropic";
  openaiApiKey?: string;
  anthropicApiKey?: string;
  agentKeypairPath: string;
  escrowPubkey?: string;
  solanaRpcUrl: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
};

export function loadEnv(): AgentEnv {
  return {
    serverBaseUrl: process.env.SERVER_BASE_URL || "http://localhost:4000",
    bountyLamports: Number(process.env.BOUNTY_LAMPORTS || "50000000"),
    agentPubkey: process.env.AGENT_PUBKEY || "demo-agent",
    demoCache: (process.env.DEMO_CACHE || "1") === "1",
    mockSolana: (process.env.MOCK_SOLANA || "1") === "1",
    llmProvider: (process.env.LLM_PROVIDER || "openai") as "openai" | "anthropic",
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    agentKeypairPath:
      process.env.AGENT_KEYPAIR_PATH || path.resolve(process.cwd(), "../../.secrets/agent.json"),
    escrowPubkey: process.env.ESCROW_PUBKEY || undefined,
    solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || "2000"),
    pollTimeoutMs: Number(process.env.POLL_TIMEOUT_MS || "300000"),
  };
}
