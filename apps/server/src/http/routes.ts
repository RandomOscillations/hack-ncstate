import express from "express";
import type {
  CreateTaskRequest,
  SubmitAnswerRequest,
  Task
} from "@unblock/common";
import { CreateTaskRequestSchema, SubmitAnswerRequestSchema } from "@unblock/common";
import type { WsHub } from "../ws/hub";
import type { TaskService } from "../tasks/service";
import type { ServerEnv } from "../env";

/** Escrow adapter — decoupled from Dev1's concrete impl so branches stay independent. */
export type EscrowAdapter = {
  verifyLockTx(lockTxSig: string, agentPubkey: string, bountyLamports: number): Promise<{ ok: true } | { ok: false; error: string }>;
  release(task: Task): Promise<string>;
  refund(task: Task): Promise<string>;
};

export function makeRoutes(env: ServerEnv, tasks: TaskService, ws: WsHub, escrow: EscrowAdapter) {
  const router = express.Router();

  router.get("/health", (_req, res) => res.json({ ok: true }));

  // --- Create task (agent) ---
  router.post("/tasks", async (req, res) => {
    const parsed = CreateTaskRequestSchema.safeParse(req.body as CreateTaskRequest);
    if (!parsed.success) return res.status(400).json({ error: "bad_body", issues: parsed.error.issues });

    // Verify lock-tx (escrow adapter handles mock mode internally)
    if (parsed.data.lockTxSig) {
      const verification = await escrow.verifyLockTx(
        parsed.data.lockTxSig,
        parsed.data.agentPubkey,
        parsed.data.bountyLamports
      );
      if (!verification.ok) {
        return res.status(400).json({ error: "lock_tx_invalid", detail: verification.error });
      }
    }

    const task = tasks.create(parsed.data);
    ws.broadcast({ type: "task.created", taskId: task.id });
    return res.json({ taskId: task.id, status: task.status });
  });

  // --- List tasks (UI) ---
  router.get("/tasks", (_req, res) => {
    return res.json({ tasks: tasks.list() });
  });

  // --- Get single task (agent polling) ---
  router.get("/tasks/:id", (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) return res.status(404).json({ error: "not_found" });
    return res.json({ task });
  });

  // --- Submit answer (UI / resolver) ---
  router.post("/tasks/:id/answer", (req, res) => {
    if (env.resolverDemoToken) {
      const token = String(req.header("x-demo-token") || "");
      if (token !== env.resolverDemoToken) return res.status(401).json({ error: "bad_token" });
    }

    const parsed = SubmitAnswerRequestSchema.safeParse(req.body as SubmitAnswerRequest);
    if (!parsed.success) return res.status(400).json({ error: "bad_body" });

    try {
      const updated = tasks.submitAnswer(req.params.id, parsed.data);
      ws.broadcast({ type: "task.updated", taskId: updated.id, status: updated.status });
      return res.json({ ok: true, task: updated });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "error" });
    }
  });

  // --- Confirm + release payment (agent) ---
  router.post("/tasks/:id/confirm", async (req, res) => {
    try {
      const task = tasks.get(req.params.id);
      if (!task) return res.status(404).json({ error: "not_found" });

      const releaseTxSig = await escrow.release(task);
      const updated = tasks.markConfirmedPaid(req.params.id, releaseTxSig);
      ws.broadcast({ type: "task.updated", taskId: updated.id, status: updated.status });
      return res.json({ status: updated.status, releaseTxSig });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "error" });
    }
  });

  // --- Reject + refund (agent) ---
  router.post("/tasks/:id/reject", async (req, res) => {
    try {
      const task = tasks.get(req.params.id);
      if (!task) return res.status(404).json({ error: "not_found" });

      const refundTxSig = await escrow.refund(task);
      const updated = tasks.markRejectedRefunded(req.params.id, refundTxSig);
      ws.broadcast({ type: "task.updated", taskId: updated.id, status: updated.status });
      return res.json({ status: updated.status, refundTxSig });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "error" });
    }
  });

  return router;
}
