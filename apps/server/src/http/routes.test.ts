import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import { makeRoutes, type EscrowAdapter } from "./routes";
import { TaskStore } from "../tasks/store";
import { TaskService } from "../tasks/service";
import type { WsHub } from "../ws/hub";
import type { ServerEnv } from "../env";

// Minimal stub for WsHub — we only care that broadcast doesn't crash.
const stubWs: WsHub = { broadcast: () => {} } as any;

const stubEscrow: EscrowAdapter = {
  async verifyLockTx() { return { ok: true as const }; },
  async release(task) { return `MOCK_RELEASE_${task.id}`; },
  async refund(task) { return `MOCK_REFUND_${task.id}`; },
};

const env: ServerEnv = {
  port: 0,
  mockSolana: true,
  solanaRpcUrl: "",
  escrowKeypairPath: "",
  webPublicDir: "",
};

let app: express.Express;
let svc: TaskService;
let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  svc = new TaskService(new TaskStore(), { nowMs: () => Date.now() });
  app = express();
  app.use(express.json());
  app.use("/api", makeRoutes(env, svc, stubWs, stubEscrow));
  server = app.listen(0);
  const addr = server.address() as { port: number };
  baseUrl = `http://localhost:${addr.port}`;

  return () => server.close();
});

async function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function get(path: string) {
  return fetch(`${baseUrl}${path}`);
}

const VALID_CREATE = {
  question: "What is the button color?",
  imageUrls: ["https://example.com/img.png"],
  bountyLamports: 50_000,
  agentPubkey: "AgentPubkey1234567890",
};

const VALID_ANSWER = {
  resolverPubkey: "ResolverPubkey1234567890",
  answerText: "It is blue",
};

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /api/tasks", () => {
  it("creates a task", async () => {
    const res = await post("/api/tasks", VALID_CREATE);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.taskId).toBeTruthy();
    expect(data.status).toBe("OPEN");
  });

  it("rejects invalid body", async () => {
    const res = await post("/api/tasks", { question: "" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tasks", () => {
  it("returns empty list", async () => {
    const res = await get("/api/tasks");
    const data = await res.json();
    expect(data.tasks).toEqual([]);
  });

  it("returns created tasks", async () => {
    await post("/api/tasks", VALID_CREATE);
    await post("/api/tasks", VALID_CREATE);
    const res = await get("/api/tasks");
    const data = await res.json();
    expect(data.tasks).toHaveLength(2);
  });
});

describe("GET /api/tasks/:id", () => {
  it("returns 404 for missing task", async () => {
    const res = await get("/api/tasks/nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns a task by id", async () => {
    const createRes = await post("/api/tasks", VALID_CREATE);
    const { taskId } = await createRes.json();
    const res = await get(`/api/tasks/${taskId}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.id).toBe(taskId);
  });
});

describe("POST /api/tasks/:id/answer", () => {
  it("submits an answer", async () => {
    const createRes = await post("/api/tasks", VALID_CREATE);
    const { taskId } = await createRes.json();

    const res = await post(`/api/tasks/${taskId}/answer`, VALID_ANSWER);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.task.status).toBe("ANSWERED");
  });

  it("rejects invalid body", async () => {
    const createRes = await post("/api/tasks", VALID_CREATE);
    const { taskId } = await createRes.json();
    const res = await post(`/api/tasks/${taskId}/answer`, { answerText: "" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/tasks/:id/confirm", () => {
  it("confirms and releases payment", async () => {
    const createRes = await post("/api/tasks", VALID_CREATE);
    const { taskId } = await createRes.json();
    await post(`/api/tasks/${taskId}/answer`, VALID_ANSWER);

    const res = await post(`/api/tasks/${taskId}/confirm`, {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("CONFIRMED_PAID");
    expect(data.releaseTxSig).toBe(`MOCK_RELEASE_${taskId}`);
  });

  it("returns 404 for missing task", async () => {
    const res = await post("/api/tasks/nonexistent/confirm", {});
    expect(res.status).toBe(404);
  });
});

describe("POST /api/tasks/:id/reject", () => {
  it("rejects and refunds payment", async () => {
    const createRes = await post("/api/tasks", VALID_CREATE);
    const { taskId } = await createRes.json();
    await post(`/api/tasks/${taskId}/answer`, VALID_ANSWER);

    const res = await post(`/api/tasks/${taskId}/reject`, {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("REJECTED_REFUNDED");
    expect(data.refundTxSig).toBe(`MOCK_REFUND_${taskId}`);
  });

  it("returns 404 for missing task", async () => {
    const res = await post("/api/tasks/nonexistent/reject", {});
    expect(res.status).toBe(404);
  });
});

describe("full happy path via HTTP", () => {
  it("create → answer → confirm", async () => {
    // Create
    const c = await post("/api/tasks", VALID_CREATE);
    const { taskId } = await c.json();

    // Answer
    const a = await post(`/api/tasks/${taskId}/answer`, VALID_ANSWER);
    expect((await a.json()).task.status).toBe("ANSWERED");

    // Confirm
    const cf = await post(`/api/tasks/${taskId}/confirm`, {});
    const cfData = await cf.json();
    expect(cfData.status).toBe("CONFIRMED_PAID");
    expect(cfData.releaseTxSig).toContain("MOCK_RELEASE_");

    // Verify final state
    const final = await get(`/api/tasks/${taskId}`);
    const finalData = await final.json();
    expect(finalData.task.status).toBe("CONFIRMED_PAID");
  });
});
