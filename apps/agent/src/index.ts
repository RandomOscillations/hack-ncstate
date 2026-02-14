import type { CreateTaskRequest, CreateTaskResponse } from "@unblock/common";

async function main() {
  const baseUrl = process.env.SERVER_BASE_URL || "http://localhost:4000";
  const bountyLamports = Number(process.env.BOUNTY_LAMPORTS || "50000000");

  // This is a scaffold entrypoint so parallel work can start immediately.
  // Dev3 owns the full agent implementation (LLM calls + Solana signing + polling).
  console.log("[agent] starting (scaffold)");
  console.log(`[agent] server: ${baseUrl}`);
  console.log(`[agent] bountyLamports: ${bountyLamports}`);

  const payload: CreateTaskRequest = {
    question: "Which landing page has better UX and why?",
    context: "Compare these two fintech onboarding landing pages.",
    imageUrls: ["/assets/landing_a.svg", "/assets/landing_b.svg"],
    bountyLamports,
    agentPubkey: process.env.AGENT_PUBKEY || "demo-agent",
    lockTxSig: "MOCK_LOCK_SIG",
    expiresInSec: 600
  };

  const res = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const json = (await res.json()) as CreateTaskResponse;
  console.log(`[agent] created task: ${json.taskId} (status=${json.status})`);
  console.log("[agent] next: implement polling + confirm/reject (Dev3)");
}

main().catch((e) => {
  console.error("[agent] fatal:", e);
  process.exit(1);
});

