import crypto from "node:crypto";
import type {
  CreateTaskRequest,
  SubmitAnswerRequest,
  SubmitFulfillmentRequest,
  SubmitScoreRequest,
  SubmitVerificationRequest,
  Task,
  TaskStatus,
  Fulfillment,
  SupervisorScore,
  VerifierReview,
} from "@unblock/common";
import { TaskStore } from "./store";

export type CreateTaskDeps = {
  nowMs: () => number;
};

export class TaskService {
  constructor(
    private store: TaskStore,
    private deps: CreateTaskDeps
  ) {}

  create(req: CreateTaskRequest): Task {
    const now = this.deps.nowMs();
    const id = crypto.randomUUID();

    const expiresAtMs = req.expiresInSec ? now + req.expiresInSec * 1000 : undefined;

    const task: Task = {
      id,
      createdAtMs: now,
      updatedAtMs: now,
      question: req.question,
      context: req.context,
      imageUrls: req.imageUrls || [],
      bountyLamports: req.bountyLamports,
      agentPubkey: req.agentPubkey,
      lockTxSig: req.lockTxSig,
      status: "OPEN",
      expiresAtMs,
      publisherAgentId: req.publisherAgentId,
    };

    this.store.upsert(task);
    return task;
  }

  submitAnswer(taskId: string, req: SubmitAnswerRequest): Task {
    const task = this.mustGet(taskId);
    if (task.status !== "OPEN") throw new Error(`Task not open (status=${task.status})`);

    const now = this.deps.nowMs();
    const updated: Task = {
      ...task,
      updatedAtMs: now,
      status: "ANSWERED",
      resolverPubkey: req.resolverPubkey,
      answerText: req.answerText
    };
    this.store.upsert(updated);
    return updated;
  }

  markConfirmedPaid(taskId: string, releaseTxSig?: string): Task {
    const task = this.mustGet(taskId);
    if (task.status !== "ANSWERED") throw new Error(`Task not answered (status=${task.status})`);

    const now = this.deps.nowMs();
    const updated: Task = { ...task, updatedAtMs: now, status: "CONFIRMED_PAID", releaseTxSig };
    this.store.upsert(updated);
    return updated;
  }

  markRejectedRefunded(taskId: string, refundTxSig?: string): Task {
    const task = this.mustGet(taskId);
    if (task.status !== "ANSWERED") throw new Error(`Task not answered (status=${task.status})`);

    const now = this.deps.nowMs();
    const updated: Task = { ...task, updatedAtMs: now, status: "REJECTED_REFUNDED", refundTxSig };
    this.store.upsert(updated);
    return updated;
  }

  // ── New protocol transitions ──

  claimTask(taskId: string, subscriberAgentId: string): Task {
    const task = this.mustGet(taskId);
    if (task.status !== "OPEN") throw new Error(`Task not open (status=${task.status})`);

    const now = this.deps.nowMs();
    const updated: Task = {
      ...task,
      updatedAtMs: now,
      status: "CLAIMED",
      subscriberAgentId,
    };
    this.store.upsert(updated);
    return updated;
  }

  submitFulfillment(taskId: string, req: SubmitFulfillmentRequest): Task {
    const task = this.mustGet(taskId);
    if (task.status !== "CLAIMED") throw new Error(`Task not claimed (status=${task.status})`);
    if (task.subscriberAgentId !== req.subscriberAgentId) {
      throw new Error("Subscriber agent mismatch");
    }

    const now = this.deps.nowMs();
    const fulfillment: Fulfillment = {
      id: crypto.randomUUID(),
      taskId,
      subscriberAgentId: req.subscriberAgentId,
      fulfillmentText: req.fulfillmentText,
      fulfillmentData: req.fulfillmentData,
      submittedAtMs: now,
    };

    const updated: Task = {
      ...task,
      updatedAtMs: now,
      status: "FULFILLED",
      fulfillment,
    };
    this.store.upsert(updated);
    return updated;
  }

  submitScore(taskId: string, req: SubmitScoreRequest, threshold: number): Task {
    const task = this.mustGet(taskId);
    if (task.status !== "FULFILLED") throw new Error(`Task not fulfilled (status=${task.status})`);

    const now = this.deps.nowMs();
    const supervisorScore: SupervisorScore = {
      id: crypto.randomUUID(),
      taskId,
      fulfillmentId: task.fulfillment!.id,
      supervisorAgentId: req.supervisorAgentId,
      score: req.score,
      reasoning: req.reasoning,
      passesThreshold: req.score >= threshold,
      scoredAtMs: now,
    };

    const updated: Task = {
      ...task,
      updatedAtMs: now,
      status: "SCORED",
      supervisorScore,
    };
    this.store.upsert(updated);
    return updated;
  }

  assignVerifier(taskId: string): Task {
    const task = this.mustGet(taskId);
    if (task.status !== "SCORED") throw new Error(`Task not scored (status=${task.status})`);

    const now = this.deps.nowMs();
    const updated: Task = {
      ...task,
      updatedAtMs: now,
      status: "UNDER_REVIEW",
    };
    this.store.upsert(updated);
    return updated;
  }

  submitVerification(taskId: string, req: SubmitVerificationRequest): Task {
    const task = this.mustGet(taskId);
    if (task.status !== "UNDER_REVIEW") throw new Error(`Task not under review (status=${task.status})`);

    const now = this.deps.nowMs();
    const verifierReview: VerifierReview = {
      id: crypto.randomUUID(),
      taskId,
      fulfillmentId: task.fulfillment!.id,
      scoreId: task.supervisorScore!.id,
      verifierPubkey: req.verifierPubkey,
      groundTruthScore: req.groundTruthScore,
      agreesWithSupervisor: req.agreesWithSupervisor,
      feedback: req.feedback,
      reviewedAtMs: now,
    };

    const newStatus: TaskStatus = req.agreesWithSupervisor ? "VERIFIED_PAID" : "DISPUTED";

    const updated: Task = {
      ...task,
      updatedAtMs: now,
      status: newStatus,
      verifierReview,
    };
    this.store.upsert(updated);
    return updated;
  }

  republishDisputed(taskId: string): Task {
    const task = this.mustGet(taskId);
    if (task.status !== "DISPUTED") throw new Error(`Task not disputed (status=${task.status})`);

    const now = this.deps.nowMs();
    const newTask: Task = {
      id: crypto.randomUUID(),
      createdAtMs: now,
      updatedAtMs: now,
      question: task.question,
      context: task.context,
      imageUrls: task.imageUrls,
      bountyLamports: task.bountyLamports,
      agentPubkey: task.agentPubkey,
      lockTxSig: task.lockTxSig,
      status: "OPEN",
      previousTaskId: task.id,
      attemptNumber: (task.attemptNumber || 1) + 1,
    };

    this.store.upsert(newTask);
    return newTask;
  }

  autoApprove(taskId: string): Task {
    const task = this.mustGet(taskId);
    if (task.status !== "SCORED") throw new Error(`Task not scored (status=${task.status})`);

    const now = this.deps.nowMs();
    const updated: Task = {
      ...task,
      updatedAtMs: now,
      status: "VERIFIED_PAID",
      autoApproved: true,
    };
    this.store.upsert(updated);
    return updated;
  }

  patch(taskId: string, fields: Partial<Task>): Task {
    const task = this.mustGet(taskId);
    const updated: Task = { ...task, ...fields, updatedAtMs: this.deps.nowMs() };
    this.store.upsert(updated);
    return updated;
  }

  get(taskId: string): Task | undefined {
    return this.store.get(taskId);
  }

  list(status?: TaskStatus): Task[] {
    const all = this.store.list();
    if (status) return all.filter((t) => t.status === status);
    return all;
  }

  private mustGet(taskId: string): Task {
    const task = this.store.get(taskId);
    if (!task) throw new Error("Task not found");
    return task;
  }
}

