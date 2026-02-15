import crypto from "node:crypto";
import type { AgentRegistration, AgentRole, RegisterAgentRequest } from "@unblock/common";

export class AgentRegistry {
  private agents = new Map<string, AgentRegistration>();

  register(req: RegisterAgentRequest): AgentRegistration {
    const agentId = crypto.randomUUID();
    const agent: AgentRegistration = {
      agentId,
      name: req.name,
      role: req.role,
      pubkey: req.pubkey,
      registeredAtMs: Date.now(),
      active: true,
    };
    this.agents.set(agentId, agent);
    console.log(`[registry] registered ${req.role} agent: ${req.name} (${agentId})`);
    return agent;
  }

  get(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  list(): AgentRegistration[] {
    return Array.from(this.agents.values());
  }

  listByRole(role: AgentRole): AgentRegistration[] {
    return this.list().filter((a) => a.role === role);
  }

  deactivate(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.active = false;
      this.agents.set(agentId, agent);
    }
  }
}
