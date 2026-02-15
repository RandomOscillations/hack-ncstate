// ── Task Status (extended state machine) ──

export type TaskStatus =
  | "OPEN"
  | "CLAIMED"
  | "FULFILLED"
  | "SCORED"
  | "UNDER_REVIEW"
  | "VERIFIED_PAID"
  | "DISPUTED"
  | "EXPIRED_REFUNDED"
  // Legacy compat (existing single-agent flow)
  | "ANSWERED"
  | "CONFIRMED_PAID"
  | "REJECTED_REFUNDED";

// ── Agent Roles ──

export type AgentRole = "publisher" | "subscriber" | "supervisor";

export type AgentRegistration = {
  agentId: string;
  name: string;
  role: AgentRole;
  pubkey: string;
  registeredAtMs: number;
  active: boolean;
};

// ── Trust System ──

export type TrustEvent = {
  taskId: string;
  delta: number;
  reason: string;
  timestampMs: number;
  txSig?: string;
};

export type SupervisorTier = 1 | 2 | 3 | 4;

export type SupervisorTierInfo = {
  tier: SupervisorTier;
  label: "autonomous" | "standard" | "probation" | "suspended";
  canScoreRealTasks: boolean;
  canAutoApprove: boolean;
  taskAllocationWeight: number; // 1.0 for T1/T2, 0.5 for T3, 0 for T4
};

export type ConfusionOutcome = "TP" | "TN" | "FP" | "FN";

export type TrustRecord = {
  agentId: string;
  score: number; // 0-100, starts at 50
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  lastUpdatedMs: number;
  history: TrustEvent[];
  // Tier & confusion matrix
  tier: SupervisorTier;
  confusionMatrix: { tp: number; tn: number; fp: number; fn: number };
  calibrationAttempts: number;
  calibrationSuccesses: number;
};

// ── Fulfillment ──

export type Fulfillment = {
  id: string;
  taskId: string;
  subscriberAgentId: string;
  fulfillmentText: string;
  fulfillmentData?: Record<string, unknown>;
  submittedAtMs: number;
};

// ── Supervisor Score ──

export type SupervisorScore = {
  id: string;
  taskId: string;
  fulfillmentId: string;
  supervisorAgentId: string;
  score: number; // 0-100
  reasoning: string;
  passesThreshold: boolean;
  scoredAtMs: number;
};

// ── Verifier Review ──

export type VerifierReview = {
  id: string;
  taskId: string;
  fulfillmentId: string;
  scoreId: string;
  verifierPubkey: string;
  groundTruthScore: number; // 0-100
  agreesWithSupervisor: boolean;
  feedback: string;
  reviewedAtMs: number;
};

// ── Task ──

export type Task = {
  id: string;
  createdAtMs: number;
  updatedAtMs: number;

  // Publisher-provided
  question: string;
  context?: string;
  imageUrls: string[];

  bountyLamports: number;
  agentPubkey: string;
  lockTxSig?: string;

  status: TaskStatus;
  expiresAtMs?: number;

  // Protocol fields
  publisherAgentId?: string;
  subscriberAgentId?: string;

  fulfillment?: Fulfillment;
  supervisorScore?: SupervisorScore;
  verifierReview?: VerifierReview;

  // Payment tracking
  releaseTxSig?: string;
  refundTxSig?: string;
  subscriberPaymentTxSig?: string;
  verifierPaymentTxSig?: string;
  chainLogTxSig?: string;

  // Re-circulation
  previousTaskId?: string;
  attemptNumber?: number;

  // Auto-approve (Tier 1 supervisor)
  autoApproved?: boolean;

  // Legacy compat
  resolverPubkey?: string;
  answerText?: string;
};

// ── Request / Response Types ──

export type CreateTaskRequest = {
  question: string;
  context?: string;
  imageUrls: string[];
  bountyLamports: number;
  agentPubkey: string;
  lockTxSig?: string;
  expiresInSec?: number;
  publisherAgentId?: string;
};

export type CreateTaskResponse = {
  taskId: string;
  status: TaskStatus;
};

export type ListTasksResponse = {
  tasks: Task[];
};

// Legacy
export type SubmitAnswerRequest = {
  resolverPubkey: string;
  answerText: string;
};

export type ConfirmTaskResponse = {
  status: TaskStatus;
  releaseTxSig?: string;
};

export type RejectTaskResponse = {
  status: TaskStatus;
  refundTxSig?: string;
};

// New protocol requests
export type ClaimTaskRequest = {
  subscriberAgentId: string;
};

export type SubmitFulfillmentRequest = {
  subscriberAgentId: string;
  fulfillmentText: string;
  fulfillmentData?: Record<string, unknown>;
};

export type SubmitScoreRequest = {
  supervisorAgentId: string;
  score: number;
  reasoning: string;
};

export type SubmitVerificationRequest = {
  verifierPubkey: string;
  groundTruthScore: number;
  agreesWithSupervisor: boolean;
  feedback: string;
};

export type RegisterAgentRequest = {
  name: string;
  role: AgentRole;
  pubkey: string;
};

export type RegisterAgentResponse = {
  agentId: string;
  trustScore: number;
  tier: SupervisorTier;
};

// ── Calibration ──

export type CalibrationTask = {
  id: string;
  sourceTaskId: string;
  question: string;
  context?: string;
  fulfillmentText: string;
  groundTruthScore: number;
  groundTruthPasses: boolean;
  createdAtMs: number;
};

export type CalibrationAttempt = {
  id: string;
  calibrationTaskId: string;
  supervisorAgentId: string;
  score: number;
  passesThreshold: boolean;
  matchesGroundTruth: boolean;
  trustDelta: number;
  attemptedAtMs: number;
};

export type SubmitCalibrationScoreRequest = {
  supervisorAgentId: string;
  score: number;
  reasoning: string;
};
