import crypto from "node:crypto";
import type { CreateTaskRequest, SubmitAnswerRequest, Task, TaskStatus } from "@unblock/common";
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
      expiresAtMs
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

  get(taskId: string): Task | undefined {
    return this.store.get(taskId);
  }

  list(): Task[] {
    return this.store.list();
  }

  private mustGet(taskId: string): Task {
    const task = this.store.get(taskId);
    if (!task) throw new Error("Task not found");
    return task;
  }
}

