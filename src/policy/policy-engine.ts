import { AgentManifest, PolicyDecision, newId, nowIso } from "../protocol/index.js";

export interface PolicyRequest {
  taskId: string;
  agent: AgentManifest;
  action: "delegate" | "call_model" | "write_artifact" | "use_tool";
  tool?: string;
  estimatedCostUsd?: number;
}

export interface PolicyEngine {
  decide(request: PolicyRequest): Promise<PolicyDecision>;
}

export interface SimplePolicyConfig {
  maxCostUsd: number;
  deniedTools: string[];
  allowedAgents?: string[];
}

export class SimplePolicyEngine implements PolicyEngine {
  constructor(
    private readonly config: SimplePolicyConfig = {
      maxCostUsd: 1,
      deniedTools: [],
    },
  ) {}

  async decide(request: PolicyRequest): Promise<PolicyDecision> {
    if (this.config.allowedAgents && !this.config.allowedAgents.includes(request.agent.id)) {
      return this.deny(request, `agent ${request.agent.id} is not allowlisted`);
    }

    if (request.tool && this.config.deniedTools.includes(request.tool)) {
      return this.deny(request, `tool ${request.tool} is denied`);
    }

    if ((request.estimatedCostUsd ?? 0) > this.config.maxCostUsd) {
      return this.deny(request, `estimated cost exceeds max ${this.config.maxCostUsd}`);
    }

    return {
      id: newId("policy"),
      taskId: request.taskId,
      agentId: request.agent.id,
      action: request.action,
      allowed: true,
      reason: "allowed by simple policy",
      createdAt: nowIso(),
    };
  }

  private deny(request: PolicyRequest, reason: string): PolicyDecision {
    return {
      id: newId("policy"),
      taskId: request.taskId,
      agentId: request.agent.id,
      action: request.action,
      allowed: false,
      reason,
      createdAt: nowIso(),
    };
  }
}
