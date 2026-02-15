import type { CreateTaskRequest } from "@unblock/common";
import { loadDotEnvFromCwd } from "./dotenv";
import { loadEnv } from "./env";
import { ServerApi } from "./api";
import { runReasoningProbe, runStep1, runStep2, runAmbiguityCheck, runFinalStep } from "./llm";
import { sendLockTransaction } from "./solana";

// Load apps/agent/.env automatically when running via npm workspaces.
loadDotEnvFromCwd(".env");

function log(msg: string) {
  console.log(`[agent] ${msg}`);
}

function divider() {
  console.log("\n" + "-".repeat(60) + "\n");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const env = loadEnv();
  const api = new ServerApi(env.serverBaseUrl);

  log("Unblock.Agent v2 starting");
  log(`server:       ${env.serverBaseUrl}`);
  log(`mock solana:  ${env.mockSolana ? "ON" : "OFF"}`);
  log(`demo cache:   ${env.demoCache ? "ON" : "OFF"}`);
  log(`llm provider: ${env.llmProvider}`);
  divider();

  // Fail fast before spending LLM tokens if the server isn't up.
  const ok = await api.health();
  if (!ok) {
    throw new Error(
      `Server health check failed at ${env.serverBaseUrl}. ` +
        `Start it with: MOCK_SOLANA=1 RESOLVER_DEMO_TOKEN=demo-token npm run dev:server`
    );
  }

  // Optional: explicit LLM reasoning probe (for testing that "real LLM" is wired correctly).
  if (env.reasoningTest) {
    log("Reasoning probe (LLM test case)...");
    const probe = await runReasoningProbe(env);
    console.log(probe.text);
    divider();
  }

  // ── Step 1: Analyze Landing Page A ────────────────────────
  log("Step 1/5 - Analyzing Landing Page A...");
  const step1 = await runStep1(env);
  console.log(step1.text);
  divider();

  // ── Step 2: Analyze Landing Page B ────────────────────────
  log("Step 2/5 - Analyzing Landing Page B...");
  const step2 = await runStep2(env);
  console.log(step2.text);
  divider();

  // ── Step 3: Ambiguity detected ────────────────────────────
  log("Step 3/5 - Ambiguity detected! Need human judgment.");
  const ambiguity = await runAmbiguityCheck(env);
  console.log(ambiguity.text);
  divider();

  // Lock bounty into escrow
  log("Locking bounty into escrow...");
  const { lockTxSig } = await sendLockTransaction(env);
  log(`lock tx: ${lockTxSig}`);

  // Create task on server
  log("Creating task on server...");
  const payload: CreateTaskRequest = {
    question: "Which landing page has better UX and why?",
    context:
      "Compare these two fintech onboarding landing pages. " +
      "Page A is trust-focused with a clean layout. " +
      "Page B is engagement-focused with progressive disclosure.",
    imageUrls: ["/assets/landing_a.svg", "/assets/landing_b.svg"],
    bountyLamports: env.bountyLamports,
    agentPubkey: env.agentPubkey,
    lockTxSig,
    expiresInSec: 600,
  };

  const created = await api.createTask(payload);
  log(`task created: ${created.taskId} (status=${created.status})`);
  log(`bounty: ${env.bountyLamports.toLocaleString()} lamports`);
  log("Waiting for human resolver...");
  divider();

  // ── Step 4: Poll for answer ───────────────────────────────
  log("Step 4/5 - Polling for human answer...");
  const startMs = Date.now();
  let answered = false;
  let answerText = "";

  while (Date.now() - startMs < env.pollTimeoutMs) {
    const task = await api.getTask(created.taskId);

    if (task.status === "ANSWERED") {
      answered = true;
      answerText = task.answerText || "";
      console.log(); // newline after dots
      log(`Human answered! Resolver: ${task.resolverPubkey}`);
      log(`Answer: "${answerText}"`);
      break;
    }

    if (task.status !== "OPEN") {
      console.log();
      log(`Unexpected status: ${task.status} - aborting.`);
      return;
    }

    process.stdout.write(".");
    await sleep(env.pollIntervalMs);
  }

  if (!answered) {
    console.log();
    log("Timed out waiting for human answer.");
    log("Rejecting task (refund)...");
    await api.rejectTask(created.taskId);
    log("Task rejected and refunded.");
    return;
  }

  divider();

  // ── Step 5: Confirm + release payment ─────────────────────
  log("Step 5/5 - Confirming answer and releasing payment...");
  const confirmed = await api.confirmTask(created.taskId);
  log(`status: ${confirmed.status}`);
  if (confirmed.releaseTxSig) {
    log(`release tx: ${confirmed.releaseTxSig}`);
  }
  divider();

  // Final output incorporating human feedback
  const final = runFinalStep(env, answerText);
  console.log(final.text);
  divider();

  log("Done. Agent workflow complete.");
}

main().catch((e) => {
  console.error("[agent] fatal:", e);
  process.exit(1);
});
