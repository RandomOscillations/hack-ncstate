import type { CreateTaskRequest, CreateTaskResponse, Task, ConfirmTaskResponse, RejectTaskResponse } from "@unblock/common";

export class ServerApi {
  constructor(private baseUrl: string) {}

  async createTask(req: CreateTaskRequest): Promise<CreateTaskResponse> {
    const res = await fetch(`${this.baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`createTask failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<CreateTaskResponse>;
  }

  async getTask(taskId: string): Promise<Task> {
    const res = await fetch(`${this.baseUrl}/api/tasks/${taskId}`);
    if (!res.ok) throw new Error(`getTask failed: ${res.status}`);
    const data = (await res.json()) as { task: Task };
    return data.task;
  }

  async confirmTask(taskId: string): Promise<ConfirmTaskResponse> {
    const res = await fetch(`${this.baseUrl}/api/tasks/${taskId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) throw new Error(`confirmTask failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<ConfirmTaskResponse>;
  }

  async rejectTask(taskId: string): Promise<RejectTaskResponse> {
    const res = await fetch(`${this.baseUrl}/api/tasks/${taskId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) throw new Error(`rejectTask failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<RejectTaskResponse>;
  }
}
