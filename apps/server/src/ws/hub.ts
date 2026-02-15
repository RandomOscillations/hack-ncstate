import type { Server as HttpServer } from "node:http";
import type { TaskStatus, LedgerEntry } from "@unblock/common";
import { WebSocketServer } from "ws";

export type WsEvent =
  | { type: "task.created"; taskId: string }
  | { type: "task.updated"; taskId: string; status: TaskStatus }
  | { type: "agent.registered"; agentId: string; role: string }
  | { type: "trust.updated"; agentId: string; score: number }
  | { type: "pubsub"; topic: string; payload: Record<string, unknown> }
  | { type: "ledger.new"; entry: LedgerEntry };

export class WsHub {
  private wss: WebSocketServer;

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (socket) => {
      console.log("[ws] client connected");
      socket.on("close", () => console.log("[ws] client disconnected"));
    });
  }

  broadcast(evt: WsEvent) {
    const payload = JSON.stringify(evt);
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }
}
