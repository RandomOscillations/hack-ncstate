import type {
  CreateTaskRequest,
  CreateTaskResponse,
  Task,
  ConfirmTaskResponse,
  RejectTaskResponse,
  RegisterAgentRequest,
  RegisterAgentResponse,
  SubmitFulfillmentRequest,
  SubmitScoreRequest,
  CalibrationTask,
  CalibrationAttempt,
  SubmitCalibrationScoreRequest,
  SupervisorTierInfo,
} from "@unblock/common";

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

  async registerAgent(req: RegisterAgentRequest): Promise<RegisterAgentResponse> {
    const res = await this.safeFetch("/api/agents/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`registerAgent failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<RegisterAgentResponse>;
  }

  async listOpenTasks(): Promise<Task[]> {
    const res = await this.safeFetch("/api/tasks?status=OPEN");
    if (!res.ok) throw new Error(`listOpenTasks failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { tasks: Task[] };
    return data.tasks;
  }

  async listFulfilledTasks(): Promise<Task[]> {
    const res = await this.safeFetch("/api/tasks?status=FULFILLED");
    if (!res.ok) throw new Error(`listFulfilledTasks failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { tasks: Task[] };
    return data.tasks;
  }

  async claimTask(taskId: string, subscriberAgentId: string): Promise<Task> {
    const res = await this.safeFetch(`/api/tasks/${taskId}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscriberAgentId }),
    });
    if (!res.ok) throw new Error(`claimTask failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { task: Task };
    return data.task;
  }

  async submitFulfillment(taskId: string, req: SubmitFulfillmentRequest): Promise<Task> {
    const res = await this.safeFetch(`/api/tasks/${taskId}/fulfill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`submitFulfillment failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { task: Task };
    return data.task;
  }

  async submitScore(taskId: string, req: SubmitScoreRequest): Promise<{ task: Task; autoApproved?: boolean }> {
    const res = await this.safeFetch(`/api/tasks/${taskId}/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`submitScore failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<{ task: Task; autoApproved?: boolean }>;
  }

  async getAgentTier(agentId: string): Promise<{ tier: SupervisorTierInfo }> {
    const res = await this.safeFetch(`/api/agents/${agentId}`);
    if (!res.ok) throw new Error(`getAgentTier failed: ${res.status}`);
    const data = (await res.json()) as { tier: SupervisorTierInfo };
    return data;
  }

  async listCalibrationTasks(supervisorAgentId: string): Promise<CalibrationTask[]> {
    const res = await this.safeFetch(`/api/calibration-tasks?supervisorAgentId=${encodeURIComponent(supervisorAgentId)}`);
    if (!res.ok) throw new Error(`listCalibrationTasks failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { tasks: CalibrationTask[] };
    return data.tasks;
  }

  async submitCalibrationScore(calibrationTaskId: string, req: SubmitCalibrationScoreRequest): Promise<{ attempt: CalibrationAttempt; tier: SupervisorTierInfo }> {
    const res = await this.safeFetch(`/api/calibration-tasks/${calibrationTaskId}/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`submitCalibrationScore failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<{ attempt: CalibrationAttempt; tier: SupervisorTierInfo }>;
  }
}
