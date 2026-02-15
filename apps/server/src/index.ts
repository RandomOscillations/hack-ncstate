import http from "node:http";
import express from "express";
import cors from "cors";

import { loadEnv } from "./env";
import { TaskStore } from "./tasks/store";
import { TaskService } from "./tasks/service";
import { WsHub } from "./ws/hub";
import { EscrowService } from "./solana";
import { makeRoutes } from "./http/routes";

const env = loadEnv();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const server = http.createServer(app);
const ws = new WsHub(server);

const store = new TaskStore();
const tasks = new TaskService(store, { nowMs: () => Date.now() });

const escrow = new EscrowService({
  mockSolana: env.mockSolana,
  solanaRpcUrl: env.solanaRpcUrl,
  escrowKeypairPath: env.escrowKeypairPath,
});

// API routes
app.use("/api", makeRoutes(env, tasks, ws, escrow));

// Static UI + assets
app.use(express.static(env.webPublicDir));

server.listen(env.port, () => {
  // Keep logs simple and demo-friendly.
  console.log(`[server] listening on http://localhost:${env.port}`);
  console.log(`[server] web dir: ${env.webPublicDir}`);
  console.log(`[server] mock solana: ${env.mockSolana ? "ON" : "OFF"}`);
});

