import path from "node:path";

export type ServerEnv = {
  port: number;
  resolverDemoToken?: string;
  mockSolana: boolean;
  solanaRpcUrl: string;
  escrowKeypairPath: string;
  webPublicDir: string;
  supervisorScoreThreshold: number;
  subscriberPaymentShare: number;
  verifierPaymentShare: number;
  // Tier system
  auditSampleRate: number;
  autoApproveSubscriberMinTrust: number;
  subscriberMinClaimTrust: number;
  calibrationScoreTolerance: number;
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

  const supervisorScoreThreshold = Number(process.env.SUPERVISOR_SCORE_THRESHOLD || "60");
  const subscriberPaymentShare = Number(process.env.SUBSCRIBER_PAYMENT_SHARE || "0.7");
  const verifierPaymentShare = Number(process.env.VERIFIER_PAYMENT_SHARE || "0.3");

  const auditSampleRate = Number(process.env.AUDIT_SAMPLE_RATE || "0.20");
  const autoApproveSubscriberMinTrust = Number(process.env.AUTO_APPROVE_SUBSCRIBER_MIN_TRUST || "40");
  const subscriberMinClaimTrust = Number(process.env.SUBSCRIBER_MIN_CLAIM_TRUST || "10");
  const calibrationScoreTolerance = Number(process.env.CALIBRATION_SCORE_TOLERANCE || "15");

  return {
    port,
    resolverDemoToken,
    mockSolana,
    solanaRpcUrl,
    escrowKeypairPath,
    webPublicDir,
    supervisorScoreThreshold,
    subscriberPaymentShare,
    verifierPaymentShare,
    auditSampleRate,
    autoApproveSubscriberMinTrust,
    subscriberMinClaimTrust,
    calibrationScoreTolerance,
  };
}
