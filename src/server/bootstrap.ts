import { join } from "node:path";
import { MockModelAdapter } from "../adapters/mock-adapter.js";
import { OpenAIModelAdapter } from "../adapters/openai-adapter.js";
import { GeminiModelAdapter } from "../adapters/gemini-adapter.js";
import { ModelAdapter } from "../adapters/model-adapter.js";
import { BasicContextProjector } from "../memory/memory-system.js";
import { SimplePolicyEngine } from "../policy/policy-engine.js";
import { AgentManifest } from "../protocol/index.js";
import { AgentMeshRuntime } from "../runtime/agent-mesh-runtime.js";
import { SQLiteAgentMeshStore } from "../storage/sqlite-store.js";

export async function bootstrapRuntime(rootDir = process.cwd()): Promise<{
  runtime: AgentMeshRuntime;
  registry: SQLiteAgentMeshStore;
  manifest: AgentManifest;
}> {
  const store = new SQLiteAgentMeshStore(join(rootDir, "data", "agent-mesh.sqlite"));
  const registry = store;
  const adapters = new Map<string, ModelAdapter>();
  adapters.set("mock", new MockModelAdapter());

  const manifests: AgentManifest[] = [];

  if (process.env.OPENAI_API_KEY) {
    adapters.set("openai", new OpenAIModelAdapter());
    manifests.push(createManifest("openai"));
  }
  if (process.env.GEMINI_API_KEY) {
    adapters.set("gemini", new GeminiModelAdapter());
    manifests.push(createManifest("gemini"));
  }
  if (manifests.length === 0 || process.env.AGENT_MESH_PROVIDER === "mock") {
    manifests.push(createManifest("mock"));
  }

  const preferredProvider = process.env.AGENT_MESH_PROVIDER;
  const sortedManifests = preferredProvider
    ? [...manifests].sort((a, b) => Number(b.provider === preferredProvider) - Number(a.provider === preferredProvider))
    : manifests;

  for (const agentManifest of sortedManifests) {
    await registry.register(agentManifest);
  }

  const manifest = sortedManifests[0];

  const runtime = new AgentMeshRuntime({
    registry,
    policy: new SimplePolicyEngine({
      maxCostUsd: 1,
      deniedTools: [],
    }),
    ledger: store,
    artifacts: store,
    tasks: store,
    memory: store,
    contextProjector: new BasicContextProjector(store),
    adapters,
    retry: {
      maxAttempts: 2,
      baseDelayMs: 250,
    },
  });

  return { runtime, registry, manifest };
}

function createManifest(provider: "openai" | "gemini" | "mock"): AgentManifest {
  const providerProfile = {
    openai: {
      id: "agent-mesh-openai-worker",
      name: "Agent Mesh OpenAI Worker",
      trust: 0.7,
      cost: 0.05,
      latency: 3000,
    },
    gemini: {
      id: "agent-mesh-gemini-worker",
      name: "Agent Mesh Gemini Worker",
      trust: 0.72,
      cost: 0.03,
      latency: 2500,
    },
    mock: {
      id: "agent-mesh-mock-worker",
      name: "Agent Mesh Mock Worker",
      trust: 0.4,
      cost: 0,
      latency: 50,
    },
  }[provider];

  return {
    id: providerProfile.id,
    name: providerProfile.name,
    version: "0.1.0",
    provider,
    capabilities: [
      {
        id: "reason",
        description: "General reasoning and structured work product generation.",
        requiredTools: [],
      },
      {
        id: "summarize",
        description: "Summarize input into concise structured output.",
        requiredTools: [],
      },
      {
        id: "design",
        description: "Design architecture or implementation plans.",
        requiredTools: [],
      },
    ],
    trust: {
      level: provider === "mock" ? "low" : "medium",
      score: providerProfile.trust,
    },
    cost: {
      estimatedUsdPerTask: providerProfile.cost,
    },
    latency: {
      estimatedMs: providerProfile.latency,
    },
    security: {
      sandboxed: false,
      signedArtifacts: false,
    },
  };
}
