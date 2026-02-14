import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";

export type WsEvent =
  | { type: "task.created"; taskId: string }
  | { type: "task.updated"; taskId: string; status: string };

export class WsHub {
  private wss: WebSocketServer;

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
  }

  broadcast(evt: WsEvent) {
    const payload = JSON.stringify(evt);
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }
}

