import { z } from "zod";

export const CreateTaskRequestSchema = z.object({
  question: z.string().min(1),
  context: z.string().min(1).optional(),
  imageUrls: z.array(z.string().min(1)).default([]),
  bountyLamports: z.number().int().positive(),
  agentPubkey: z.string().min(10),
  lockTxSig: z.string().min(10).optional(),
  expiresInSec: z.number().int().positive().optional()
});

export const SubmitAnswerRequestSchema = z.object({
  resolverPubkey: z.string().min(10),
  answerText: z.string().min(1)
});

