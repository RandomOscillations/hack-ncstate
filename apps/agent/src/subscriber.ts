import { loadEnv } from "./env";
import { ServerApi } from "./api";
import { cachedCallLlm } from "./llm";
import prompts from "./prompts.json";

function log(msg: string) {
  console.log(`[subscriber] ${msg}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function subscriberMain() {
  const env = loadEnv();
  const api = new ServerApi(env.serverBaseUrl);

  log("Subscriber agent starting");
  log(`server:       ${env.serverBaseUrl}`);
  log(`demo cache:   ${env.demoCache ? "ON" : "OFF"}`);

  const ok = await api.health();
  if (!ok) {
    throw new Error(`Server health check failed at ${env.serverBaseUrl}.`);
  }
  log("Server healthy");

  // Register as subscriber
  const reg = await api.registerAgent({
    name: env.agentName,
    role: "subscriber",
    pubkey: env.agentPubkey,
  });
  log(`Registered: ${reg.agentId} (trust: ${reg.trustScore})`);

  // Main loop: poll for open tasks, claim, fulfill
  while (true) {
    try {
      const openTasks = await api.listOpenTasks();

      if (openTasks.length > 0) {
        const task = openTasks[0];
        log(`Found open task: ${task.id} — "${task.question}"`);

        // Claim
        const claimed = await api.claimTask(task.id, reg.agentId);
        log(`Claimed task ${task.id} (status: ${claimed.status})`);

        // Fulfill using LLM
        log("Generating fulfillment...");
        const prompt = prompts.subscriberFulfillment
          .replace("{{question}}", task.question)
          .replace("{{context}}", task.context || "N/A");

        const fulfillmentText = await cachedCallLlm(env, "subscriberFulfillment", prompt);

        await api.submitFulfillment(task.id, {
          subscriberAgentId: reg.agentId,
          fulfillmentText,
        });
        log(`Fulfilled task ${task.id}`);

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
            log(`Task ${task.id} DISPUTED — will be re-published`);
            break;
          }
          if (t.status === "CONFIRMED_PAID") {
            log(`Task ${task.id} CONFIRMED & PAID (legacy flow)`);
            break;
          }
          await sleep(env.pollIntervalMs);
        }
      }
    } catch (e: any) {
      log(`Error: ${e.message}`);
    }

    await sleep(env.pollIntervalMs);
  }
}
