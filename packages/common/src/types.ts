export type TaskStatus =
  | "OPEN"
  | "ANSWERED"
  | "CONFIRMED_PAID"
  | "REJECTED_REFUNDED"
  | "EXPIRED_REFUNDED";

export type Task = {
  id: string;
  createdAtMs: number;
  updatedAtMs: number;

  question: string;
  context?: string;
  imageUrls: string[];

  bountyLamports: number;
  agentPubkey: string;
  lockTxSig?: string;

  resolverPubkey?: string;
  answerText?: string;

  status: TaskStatus;

  releaseTxSig?: string;
  refundTxSig?: string;

  expiresAtMs?: number;
};

export type CreateTaskRequest = {
  question: string;
  context?: string;
  imageUrls: string[];
  bountyLamports: number;
  agentPubkey: string;
  lockTxSig?: string;
  expiresInSec?: number;
};

export type CreateTaskResponse = {
  taskId: string;
  status: TaskStatus;
};

export type ListTasksResponse = {
  tasks: Task[];
};

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

