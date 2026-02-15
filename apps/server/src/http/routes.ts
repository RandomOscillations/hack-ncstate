import crypto from "node:crypto";
import express from "express";
import type {
  CreateTaskRequest,
  SubmitAnswerRequest,
  ClaimTaskRequest,
  SubmitFulfillmentRequest,
  SubmitScoreRequest,
  SubmitVerificationRequest,
  RegisterAgentRequest,
  SubmitCalibrationScoreRequest,
  TaskStatus,
  ConfusionOutcome,
} from "@unblock/common";
import {
  CreateTaskRequestSchema,
  SubmitAnswerRequestSchema,
  ClaimTaskRequestSchema,
  SubmitFulfillmentRequestSchema,
  SubmitScoreRequestSchema,
  SubmitVerificationRequestSchema,
  RegisterAgentRequestSchema,
  SubmitCalibrationScoreRequestSchema,
} from "@unblock/common";
import type { WsHub } from "../ws/hub";
import type { TaskService } from "../tasks/service";
import type { ServerEnv } from "../env";
import type { EscrowService } from "../solana";
import type { PubSubBroker } from "../pubsub";
import type { AgentRegistry, TrustStore } from "../agents";
import type { ChainLogger } from "../solana/chain-logger";
import type { FulfillmentStore } from "../tasks/fulfillment-store";
import type { CalibrationStore } from "../tasks/calibration-store";

export function makeRoutes(
  env: ServerEnv,
  tasks: TaskService,
  ws: WsHub,
  escrow: EscrowService,
  broker: PubSubBroker,
  agents: AgentRegistry,
  trust: TrustStore,
  chainLogger: ChainLogger,
  fulfillments: FulfillmentStore,
  calibrations: CalibrationStore
) {
  const router = express.Router();

  router.get("/health", (_req, res) => res.json({ ok: true }));

  // ── Legacy + core task routes ──

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
    broker.publish(`tasks/${task.id}/created`, { taskId: task.id, status: task.status });
    return res.json({ taskId: task.id, status: task.status });
  });

  router.get("/tasks", (req, res) => {
    const status = req.query.status as TaskStatus | undefined;
    return res.json({ tasks: tasks.list(status) });
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

  // ── Agent Management ──

  router.post("/agents/register", (req, res) => {
    const parsed = RegisterAgentRequestSchema.safeParse(req.body as RegisterAgentRequest);
    if (!parsed.success) return res.status(400).json({ error: "bad_body", issues: parsed.error.issues });

    try {
      const agent = agents.register(parsed.data);
      const trustRecord = trust.getOrCreate(agent.agentId);
      const tierInfo = trust.getTier(agent.agentId);
      ws.broadcast({ type: "agent.registered", agentId: agent.agentId, role: agent.role });
      return res.json({ agentId: agent.agentId, trustScore: trustRecord.score, tier: tierInfo.tier });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "error" });
    }
  });

  router.get("/agents", (_req, res) => {
    return res.json({ agents: agents.list() });
  });

  router.get("/agents/:agentId", (req, res) => {
    const agent = agents.get(req.params.agentId);
    if (!agent) return res.status(404).json({ error: "not_found" });
    const tierInfo = trust.getTier(req.params.agentId);
    return res.json({ agent, trust: trust.get(req.params.agentId), tier: tierInfo });
  });

  // ── Extended Task Flow ──

  router.post("/tasks/:id/claim", (req, res) => {
    const parsed = ClaimTaskRequestSchema.safeParse(req.body as ClaimTaskRequest);
    if (!parsed.success) return res.status(400).json({ error: "bad_body", issues: parsed.error.issues });

    // Subscriber trust gate
    const subscriberTrust = trust.getOrCreate(parsed.data.subscriberAgentId);
    if (subscriberTrust.score < env.subscriberMinClaimTrust) {
      return res.status(403).json({
        error: "trust_too_low",
        score: subscriberTrust.score,
        required: env.subscriberMinClaimTrust,
        message: "Subscriber trust too low to claim tasks.",
      });
    }

    try {
      const updated = tasks.claimTask(req.params.id, parsed.data.subscriberAgentId);
      ws.broadcast({ type: "task.updated", taskId: updated.id, status: updated.status });
      broker.publish(`tasks/${req.params.id}/claimed`, { taskId: req.params.id, subscriberAgentId: parsed.data.subscriberAgentId });
      return res.json({ task: updated });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "error" });
    }
  });

  router.post("/tasks/:id/fulfill", async (req, res) => {
    const parsed = SubmitFulfillmentRequestSchema.safeParse(req.body as SubmitFulfillmentRequest);
    if (!parsed.success) return res.status(400).json({ error: "bad_body", issues: parsed.error.issues });

    try {
      const updated = tasks.submitFulfillment(req.params.id, parsed.data);
      const fulfillment = updated.fulfillment!;

      // Store fulfillment in dedicated store
      fulfillments.upsert(fulfillment);

      // Log on chain
      const chainTxSig = await chainLogger.logFulfillment(
        req.params.id,
        parsed.data.subscriberAgentId,
        fulfillment.id
      );
      // Update task with chain log tx sig
      const taskWithChainLog = { ...updated, chainLogTxSig: chainTxSig };

      ws.broadcast({ type: "task.updated", taskId: updated.id, status: updated.status });
      broker.publish(`tasks/${req.params.id}/fulfilled`, { taskId: req.params.id, fulfillmentId: fulfillment.id });
      return res.json({ task: taskWithChainLog });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "error" });
    }
  });

  router.post("/tasks/:id/score", async (req, res) => {
    const parsed = SubmitScoreRequestSchema.safeParse(req.body as SubmitScoreRequest);
    if (!parsed.success) return res.status(400).json({ error: "bad_body", issues: parsed.error.issues });

    // Tier gate: Tier 4 supervisors cannot score real tasks
    const tierInfo = trust.getTier(parsed.data.supervisorAgentId);
    if (!tierInfo.canScoreRealTasks) {
      return res.status(403).json({
        error: "supervisor_suspended",
        tier: tierInfo.tier,
        label: tierInfo.label,
        message: "Tier 4 supervisors cannot score real tasks. Use /api/calibration-tasks to rehabilitate.",
      });
    }

    try {
      // Score the task
      let updated = tasks.submitScore(req.params.id, parsed.data, env.supervisorScoreThreshold);
      const supervisorScore = updated.supervisorScore!;

      // Auto-approve path: Tier 1 supervisor + score passes threshold + trusted subscriber
      if (tierInfo.canAutoApprove && supervisorScore.passesThreshold && updated.subscriberAgentId) {
        const subscriberTrust = trust.getOrCreate(updated.subscriberAgentId);

        if (subscriberTrust.score >= env.autoApproveSubscriberMinTrust) {
          const shouldAudit = Math.random() < env.auditSampleRate;

          if (!shouldAudit) {
            // AUTO-APPROVE: skip verifier entirely
            const autoApproved = tasks.autoApprove(req.params.id);

            // Full bounty to subscriber (no verifier)
            const subscriberAgent = agents.get(autoApproved.subscriberAgentId!);
            const subscriberPubkey = subscriberAgent?.pubkey || autoApproved.subscriberAgentId!;
            const releaseTxSig = await escrow.releaseToSubscriber(autoApproved, subscriberPubkey);

            const paidTask = { ...autoApproved, subscriberPaymentTxSig: releaseTxSig };

            // Trust: reward both (assumed TP)
            trust.applyDelta(parsed.data.supervisorAgentId, 3, req.params.id, "auto-approve TP (T1 supervisor)");
            trust.recordConfusionOutcome(parsed.data.supervisorAgentId, "TP");
            trust.applyDelta(autoApproved.subscriberAgentId!, 3, req.params.id, "auto-approved fulfillment");

            ws.broadcast({ type: "task.updated", taskId: autoApproved.id, status: autoApproved.status });
            broker.publish(`tasks/${req.params.id}/auto-approved`, { taskId: req.params.id });
            return res.json({ task: paidTask, autoApproved: true });
          }
          // else: audited — fall through to normal UNDER_REVIEW
        }
      }

      // Normal path: assign verifier
      updated = tasks.assignVerifier(req.params.id);

      ws.broadcast({ type: "task.updated", taskId: updated.id, status: updated.status });
      broker.publish(`tasks/${req.params.id}/scored`, { taskId: req.params.id, score: parsed.data.score });
      return res.json({ task: updated });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "error" });
    }
  });

  router.post("/tasks/:id/verify", async (req, res) => {
    const parsed = SubmitVerificationRequestSchema.safeParse(req.body as SubmitVerificationRequest);
    if (!parsed.success) return res.status(400).json({ error: "bad_body", issues: parsed.error.issues });

    try {
      const updated = tasks.submitVerification(req.params.id, parsed.data);
      const taskId = req.params.id;

      // ── Confusion matrix trust adjustment ──
      const supervisorScore = updated.supervisorScore!;
      const passesThreshold = supervisorScore.passesThreshold;
      const agreesWithSupervisor = parsed.data.agreesWithSupervisor;

      let outcome: ConfusionOutcome;
      let supervisorDelta: number;

      if (passesThreshold && agreesWithSupervisor) {
        outcome = "TP"; supervisorDelta = 3;   // Correctly approved good work
      } else if (!passesThreshold && agreesWithSupervisor) {
        outcome = "TN"; supervisorDelta = 3;   // Correctly flagged bad work
      } else if (passesThreshold && !agreesWithSupervisor) {
        outcome = "FP"; supervisorDelta = -8;  // Let bad work through
      } else {
        outcome = "FN"; supervisorDelta = -3;  // Too harsh on good work
      }

      trust.applyDelta(supervisorScore.supervisorAgentId, supervisorDelta, taskId, `confusion:${outcome}`);
      trust.recordConfusionOutcome(supervisorScore.supervisorAgentId, outcome);

      if (updated.status === "VERIFIED_PAID") {
        // Get subscriber pubkey from the agent registry
        const subscriberAgent = agents.get(updated.subscriberAgentId!);
        const subscriberPubkey = subscriberAgent?.pubkey || updated.subscriberAgentId!;

        // Release split payment
        const { subscriberTxSig, verifierTxSig } = await escrow.releaseSplit(
          updated,
          subscriberPubkey,
          parsed.data.verifierPubkey,
          env.subscriberPaymentShare
        );

        // Update task with payment sigs
        const paidTask = {
          ...updated,
          subscriberPaymentTxSig: subscriberTxSig,
          verifierPaymentTxSig: verifierTxSig,
        };

        // Trust: reward subscriber
        trust.applyDelta(updated.subscriberAgentId!, 5, taskId, "fulfillment verified and paid");

        // Log verification on chain
        await chainLogger.logVerification(taskId, parsed.data.verifierPubkey, parsed.data.groundTruthScore);

        // Create calibration task from this verified task
        calibrations.createFromVerified(updated, env.supervisorScoreThreshold);

        ws.broadcast({ type: "task.updated", taskId: updated.id, status: updated.status });
        broker.publish(`tasks/${taskId}/verified`, { taskId, status: "VERIFIED_PAID" });
        return res.json({ task: paidTask });
      } else {
        // DISPUTED
        // Trust: penalize subscriber
        trust.applyDelta(updated.subscriberAgentId!, -10, taskId, "fulfillment disputed by verifier");

        // Log verification on chain
        await chainLogger.logVerification(taskId, parsed.data.verifierPubkey, parsed.data.groundTruthScore);

        // Republish as new task
        const newTask = tasks.republishDisputed(taskId);
        ws.broadcast({ type: "task.updated", taskId: updated.id, status: updated.status });
        ws.broadcast({ type: "task.created", taskId: newTask.id });
        broker.publish(`tasks/${taskId}/disputed`, { taskId, newTaskId: newTask.id });
        broker.publish(`tasks/${newTask.id}/created`, { taskId: newTask.id, status: "OPEN" });
        return res.json({ task: updated, newTask });
      }
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "error" });
    }
  });

  // ── Calibration Endpoints ──

  router.get("/calibration-tasks", (req, res) => {
    const supervisorAgentId = req.query.supervisorAgentId as string;
    if (!supervisorAgentId) {
      return res.status(400).json({ error: "supervisorAgentId query param required" });
    }

    // Only Tier 4 (suspended) supervisors need calibration
    const tierInfo = trust.getTier(supervisorAgentId);
    const available = calibrations.listFor(supervisorAgentId);
    return res.json({ tasks: available, tier: tierInfo });
  });

  router.post("/calibration-tasks/:id/score", (req, res) => {
    const parsed = SubmitCalibrationScoreRequestSchema.safeParse(req.body as SubmitCalibrationScoreRequest);
    if (!parsed.success) return res.status(400).json({ error: "bad_body", issues: parsed.error.issues });

    const ct = calibrations.get(req.params.id);
    if (!ct) return res.status(404).json({ error: "calibration_task_not_found" });

    const supervisorPassesThreshold = parsed.data.score >= env.supervisorScoreThreshold;
    const scoreDiff = Math.abs(parsed.data.score - ct.groundTruthScore);
    const matchesGroundTruth = supervisorPassesThreshold === ct.groundTruthPasses && scoreDiff <= env.calibrationScoreTolerance;

    const trustDelta = matchesGroundTruth ? 1 : 0;

    if (trustDelta > 0) {
      trust.applyDelta(parsed.data.supervisorAgentId, trustDelta, ct.sourceTaskId, "calibration: correct");
    }
    trust.recordCalibrationAttempt(parsed.data.supervisorAgentId, matchesGroundTruth);

    const attempt = {
      id: crypto.randomUUID(),
      calibrationTaskId: ct.id,
      supervisorAgentId: parsed.data.supervisorAgentId,
      score: parsed.data.score,
      passesThreshold: supervisorPassesThreshold,
      matchesGroundTruth,
      trustDelta,
      attemptedAtMs: Date.now(),
    };
    calibrations.recordAttempt(attempt);

    const tierInfo = trust.getTier(parsed.data.supervisorAgentId);

    return res.json({ attempt, tier: tierInfo });
  });

  // ── Trust & Audit ──

  router.get("/trust", (_req, res) => {
    return res.json({ scores: trust.list() });
  });

  router.get("/trust/:agentId", (req, res) => {
    const record = trust.get(req.params.agentId);
    if (!record) return res.status(404).json({ error: "not_found" });
    const tierInfo = trust.getTier(req.params.agentId);
    return res.json({ ...record, tierInfo });
  });

  router.get("/audit", (_req, res) => {
    return res.json({ log: broker.getLog() });
  });

  return router;
}
