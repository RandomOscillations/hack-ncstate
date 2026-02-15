import { z } from "zod";

// ── Legacy schemas (existing single-agent flow) ──

export const CreateTaskRequestSchema = z.object({
  question: z.string().min(1),
  context: z.string().min(1).optional(),
  imageUrls: z.array(z.string().min(1)).default([]),
  bountyLamports: z.number().int().positive(),
  agentPubkey: z.string().min(10),
  lockTxSig: z.string().min(10).optional(),
  expiresInSec: z.number().int().positive().optional(),
  publisherAgentId: z.string().min(1).optional()
});

export const SubmitAnswerRequestSchema = z.object({
  resolverPubkey: z.string().min(10),
  answerText: z.string().min(1)
});

// ── New protocol schemas ──

export const ClaimTaskRequestSchema = z.object({
  subscriberAgentId: z.string().min(1)
});

export const SubmitFulfillmentRequestSchema = z.object({
  subscriberAgentId: z.string().min(1),
  fulfillmentText: z.string().min(1),
  fulfillmentData: z.record(z.unknown()).optional()
});

export const SubmitScoreRequestSchema = z.object({
  supervisorAgentId: z.string().min(1),
  score: z.number().min(0).max(100),
  reasoning: z.string().min(1)
});

export const SubmitVerificationRequestSchema = z.object({
  verifierPubkey: z.string().min(10),
  groundTruthScore: z.number().min(0).max(100),
  agreesWithSupervisor: z.boolean(),
  feedback: z.string().min(1)
});

export const RegisterAgentRequestSchema = z.object({
  name: z.string().min(1),
  role: z.enum(["publisher", "subscriber", "supervisor"]),
  pubkey: z.string().min(10)
});

// ── Calibration ──

export const SubmitCalibrationScoreRequestSchema = z.object({
  supervisorAgentId: z.string().min(1),
  score: z.number().min(0).max(100),
  reasoning: z.string().min(1)
});
