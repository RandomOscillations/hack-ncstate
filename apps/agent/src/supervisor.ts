import { loadEnv } from "./env";
import { ServerApi } from "./api";
import { cachedCallLlm } from "./llm";
import prompts from "./prompts.json";

function log(msg: string) {
  console.log(`[supervisor] ${msg}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function supervisorMain() {
  const env = loadEnv();
  const api = new ServerApi(env.serverBaseUrl);

  log("Supervisor agent starting");
  log(`server:       ${env.serverBaseUrl}`);
  log(`demo cache:   ${env.demoCache ? "ON" : "OFF"}`);

  const ok = await api.health();
  if (!ok) {
    throw new Error(`Server health check failed at ${env.serverBaseUrl}.`);
  }
  log("Server healthy");

  // Register as supervisor
  const reg = await api.registerAgent({
    name: env.agentName,
    role: "supervisor",
    pubkey: env.agentPubkey,
  });
  log(`Registered: ${reg.agentId} (trust: ${reg.trustScore}, tier: ${reg.tier})`);

  // Main loop: check tier and route to correct mode
  while (true) {
    try {
      const { tier } = await api.getAgentTier(reg.agentId);

      if (!tier.canScoreRealTasks) {
        // Tier 4: Calibration mode
        await runCalibrationRound(env, api, reg.agentId);
      } else {
        // Tier 1-3: Normal scoring
        await runScoringRound(env, api, reg.agentId);
      }
    } catch (e: any) {
      log(`Error: ${e.message}`);
    }

    await sleep(env.pollIntervalMs);
  }
}

async function runScoringRound(env: ReturnType<typeof loadEnv>, api: ServerApi, agentId: string) {
  const fulfilledTasks = await api.listFulfilledTasks();

  if (fulfilledTasks.length === 0) return;

  const task = fulfilledTasks[0];
  log(`Found fulfilled task: ${task.id} — "${task.question}"`);

  if (!task.fulfillment) {
    log(`Task ${task.id} has no fulfillment data, skipping`);
    return;
  }

  // Score using LLM
  log("Generating score...");
  const prompt = prompts.supervisorScore
    .replace("{{question}}", task.question)
    .replace("{{context}}", task.context || "N/A")
    .replace("{{fulfillment}}", task.fulfillment.fulfillmentText);

  const scoreText = await cachedCallLlm(env, "supervisorScore", prompt);

  // Parse the JSON score response
  let score: number;
  let reasoning: string;
  try {
    const parsed = JSON.parse(scoreText);
    score = parsed.score;
    reasoning = parsed.reasoning;
  } catch {
    log(`Failed to parse score JSON, using defaults. Raw: ${scoreText}`);
    score = 50;
    reasoning = scoreText;
  }

  log(`Score: ${score}/100 — ${reasoning}`);

  const result = await api.submitScore(task.id, {
    supervisorAgentId: agentId,
    score,
    reasoning,
  });
  log(`Scored task ${task.id}`);

  if (result.autoApproved) {
    log(`Task ${task.id} AUTO-APPROVED (Tier 1 supervisor)`);
    return;
  }

  // Poll for final status
  log("Waiting for verification...");
  const deadline = Date.now() + env.pollTimeoutMs;
  while (Date.now() < deadline) {
    const t = await api.getTask(task.id);
    if (t.status === "VERIFIED_PAID") {
      log(`Task ${task.id} VERIFIED & PAID!`);
      break;
    }
    if (t.status === "DISPUTED") {
      log(`Task ${task.id} DISPUTED`);
      break;
    }
    if (t.status === "SCORED" || t.status === "UNDER_REVIEW") {
      await sleep(env.pollIntervalMs);
      continue;
    }
    break;
  }
}

async function runCalibrationRound(env: ReturnType<typeof loadEnv>, api: ServerApi, agentId: string) {
  log("Tier 4 (suspended) — entering calibration mode");

  const calibrationTasks = await api.listCalibrationTasks(agentId);

  if (calibrationTasks.length === 0) {
    log("No calibration tasks available. Waiting...");
    return;
  }

  const ct = calibrationTasks[0];
  log(`Calibration task: ${ct.id} — "${ct.question}"`);

  // Score using LLM (same prompt as normal scoring)
  log("Generating calibration score...");
  const prompt = prompts.supervisorScore
    .replace("{{question}}", ct.question)
    .replace("{{context}}", ct.context || "N/A")
    .replace("{{fulfillment}}", ct.fulfillmentText);

  const scoreText = await cachedCallLlm(env, `calibration_${ct.id}`, prompt);

  let score: number;
  let reasoning: string;
  try {
    const parsed = JSON.parse(scoreText);
    score = parsed.score;
    reasoning = parsed.reasoning;
  } catch {
    log(`Failed to parse calibration score JSON, using defaults`);
    score = 50;
    reasoning = scoreText;
  }

  log(`Calibration score: ${score}/100 — ${reasoning}`);

  const result = await api.submitCalibrationScore(ct.id, {
    supervisorAgentId: agentId,
    score,
    reasoning,
  });

  if (result.attempt.matchesGroundTruth) {
    log(`Calibration CORRECT! Trust +${result.attempt.trustDelta} → Tier ${result.tier.tier}`);
  } else {
    log(`Calibration INCORRECT. No trust change. Tier ${result.tier.tier}`);
  }

  if (result.tier.canScoreRealTasks) {
    log("Promoted! Can now score real tasks again.");
  }
}
