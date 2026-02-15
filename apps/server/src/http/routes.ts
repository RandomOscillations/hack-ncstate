import express from "express";
import type { CreateTaskRequest, SubmitAnswerRequest } from "@unblock/common";
import { CreateTaskRequestSchema, SubmitAnswerRequestSchema } from "@unblock/common";
import type { WsHub } from "../ws/hub";
import type { TaskService } from "../tasks/service";
import type { ServerEnv } from "../env";
import type { EscrowService } from "../solana";

export function makeRoutes(env: ServerEnv, tasks: TaskService, ws: WsHub, escrow: EscrowService) {
  const router = express.Router();

  router.get("/health", (_req, res) => res.json({ ok: true }));

  router.post("/tasks", async (req, res) => {
    const parsed = CreateTaskRequestSchema.safeParse(req.body as CreateTaskRequest);
    if (!parsed.success) return res.status(400).json({ error: "bad_body", issues: parsed.error.issues });

    if (parsed.data.lockTxSig && !env.mockSolana) {
      const result = await escrow.verifyLockTx(
        parsed.data.lockTxSig,
        parsed.data.agentPubkey,
        parsed.data.bountyLamports
      );
      if (!result.ok) {
        return res.status(400).json({ error: "lock_tx_invalid", detail: result.error });
      }
    }

    const task = tasks.create(parsed.data);
    ws.broadcast({ type: "task.created", taskId: task.id });
    return res.json({ taskId: task.id, status: task.status });
  });

  router.get("/tasks", (_req, res) => {
    return res.json({ tasks: tasks.list() });
  });

  router.get("/tasks/:id", (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) return res.status(404).json({ error: "not_found" });
    return res.json({ task });
  });

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

