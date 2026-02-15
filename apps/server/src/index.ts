import http from "node:http";
import express from "express";
import cors from "cors";

import { loadDotEnvFromCwd } from "./dotenv";
import { loadEnv } from "./env";
import { TaskStore } from "./tasks/store";
import { TaskService } from "./tasks/service";
import { FulfillmentStore } from "./tasks/fulfillment-store";
import { CalibrationStore } from "./tasks/calibration-store";
import { LedgerStore } from "./tasks/ledger-store";
import { WsHub } from "./ws/hub";
import { EscrowService, ChainLogger } from "./solana";
import { makeRoutes } from "./http/routes";
import { PubSubBroker } from "./pubsub";
import { AgentRegistry, TrustStore } from "./agents";

// Load apps/server/.env automatically when running via npm workspaces.
loadDotEnvFromCwd(".env");

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

const broker = new PubSubBroker();
const agentRegistry = new AgentRegistry();
const trustStore = new TrustStore();
const fulfillmentStore = new FulfillmentStore();
const calibrationStore = new CalibrationStore();
const ledgerStore = new LedgerStore();
const chainLogger = new ChainLogger({
  mockSolana: env.mockSolana,
  conn: null,
  keypair: null,
});

// Bridge pub-sub to WebSocket
broker.subscribe({
  id: "ws-bridge",
  topicPattern: "*",
  callback: (msg) => ws.broadcast({ type: "pubsub", topic: msg.topic, payload: msg.payload }),
});

// API routes
app.use("/api", makeRoutes(env, tasks, ws, escrow, broker, agentRegistry, trustStore, chainLogger, fulfillmentStore, calibrationStore, ledgerStore));

// Static UI + assets
app.use(express.static(env.webPublicDir));

server.listen(env.port, () => {
  // Keep logs simple and demo-friendly.
  console.log(`[server] listening on http://localhost:${env.port}`);
  console.log(`[server] web dir: ${env.webPublicDir}`);
  console.log(`[server] mock solana: ${env.mockSolana ? "ON" : "OFF"}`);
});
