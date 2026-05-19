import { AgentManifest, AgentManifestSchema } from "../protocol/index.js";

export interface AgentRegistry {
  register(agent: AgentManifest): Promise<void>;
  listAgents(): Promise<AgentManifest[]>;
  findForCapability(capability: string): Promise<AgentManifest | undefined>;
}

export class InMemoryAgentRegistry implements AgentRegistry {
  private readonly agents = new Map<string, AgentManifest>();

  async register(agent: AgentManifest): Promise<void> {
    const parsed = AgentManifestSchema.parse(agent);
    this.agents.set(parsed.id, parsed);
  }

  async listAgents(): Promise<AgentManifest[]> {
    return [...this.agents.values()];
  }

  async findForCapability(capability: string): Promise<AgentManifest | undefined> {
    const candidates = [...this.agents.values()].filter((agent) =>
      agent.capabilities.some((item) => item.id === capability),
    );

    candidates.sort((a, b) => {
      const scoreA = a.trust.score - a.cost.estimatedUsdPerTask * 0.05 - a.latency.estimatedMs / 1_000_000;
      const scoreB = b.trust.score - b.cost.estimatedUsdPerTask * 0.05 - b.latency.estimatedMs / 1_000_000;
      return scoreB - scoreA;
    });

    return candidates[0];
  }
}
