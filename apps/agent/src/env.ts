import path from "node:path";
import { loadDotEnvFromCwd } from "./dotenv";

loadDotEnvFromCwd(".env");

export type AgentEnv = {
  serverBaseUrl: string;
  bountyLamports: number;
  agentPubkey: string;
  demoCache: boolean;
  mockSolana: boolean;
  llmProvider: "openai" | "anthropic" | "gemini";
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  openaiModel: string;
  anthropicModel: string;
  geminiModel: string;
  showPrompts: boolean;
  reasoningTest: boolean;
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
    llmProvider: (process.env.LLM_PROVIDER || "openai") as "openai" | "anthropic" | "gemini",
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    geminiApiKey: process.env.GEMINI_API_KEY || undefined,
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    showPrompts: (process.env.SHOW_PROMPTS || "0") === "1",
    reasoningTest: (process.env.REASONING_TEST || "0") === "1",
    agentKeypairPath:
      process.env.AGENT_KEYPAIR_PATH || path.resolve(process.cwd(), "../../.secrets/agent.json"),
    escrowPubkey: process.env.ESCROW_PUBKEY || undefined,
    solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || "2000"),
    pollTimeoutMs: Number(process.env.POLL_TIMEOUT_MS || "300000"),
  };
}
