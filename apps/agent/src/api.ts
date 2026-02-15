import type { CreateTaskRequest, CreateTaskResponse, Task, ConfirmTaskResponse, RejectTaskResponse } from "@unblock/common";

export class ServerApi {
  constructor(private baseUrl: string) {}

  private async safeFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    try {
      return await fetch(url, init);
    } catch (e: any) {
      const msg =
        `Cannot reach server at ${this.baseUrl}. ` +
        `Start it with: MOCK_SOLANA=1 RESOLVER_DEMO_TOKEN=demo-token npm run dev:server. ` +
        `Original error: ${e?.message || String(e)}`;
      throw new Error(msg);
    }
  }

  async health(): Promise<boolean> {
    const res = await this.safeFetch("/api/health");
    if (!res.ok) return false;
    const data = (await res.json()) as any;
    return Boolean(data && data.ok);
  }

  async createTask(req: CreateTaskRequest): Promise<CreateTaskResponse> {
    const res = await this.safeFetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`createTask failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<CreateTaskResponse>;
  }

  async getTask(taskId: string): Promise<Task> {
    const res = await this.safeFetch(`/api/tasks/${taskId}`);
    if (!res.ok) throw new Error(`getTask failed: ${res.status}`);
    const data = (await res.json()) as { task: Task };
    return data.task;
  }

  async confirmTask(taskId: string): Promise<ConfirmTaskResponse> {
    const res = await this.safeFetch(`/api/tasks/${taskId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) throw new Error(`confirmTask failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<ConfirmTaskResponse>;
  }

  async rejectTask(taskId: string): Promise<RejectTaskResponse> {
    const res = await this.safeFetch(`/api/tasks/${taskId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) throw new Error(`rejectTask failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<RejectTaskResponse>;
  }
}
