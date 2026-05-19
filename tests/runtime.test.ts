import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileArtifactStore } from "../src/artifacts/artifact-store.js";
import { MockModelAdapter } from "../src/adapters/mock-adapter.js";
import { FileTaskLedger } from "../src/ledger/file-ledger.js";
import { SimplePolicyEngine } from "../src/policy/policy-engine.js";
import { AgentManifest } from "../src/protocol/index.js";
import { InMemoryAgentRegistry } from "../src/registry/agent-registry.js";
import { AgentMeshRuntime } from "../src/runtime/agent-mesh-runtime.js";
import { SQLiteAgentMeshStore } from "../src/storage/sqlite-store.js";
import { BasicContextProjector } from "../src/memory/memory-system.js";

test("runtime creates task, writes ledger events, and stores artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-mesh-"));
  const registry = new InMemoryAgentRegistry();
  const agent: AgentManifest = {
    id: "mock-worker",
    name: "Mock Worker",
    version: "0.1.0",
    provider: "mock",
    capabilities: [{ id: "reason", description: "Reason about a task", requiredTools: [] }],
    trust: { level: "medium", score: 0.8 },
    cost: { estimatedUsdPerTask: 0 },
    latency: { estimatedMs: 1 },
    security: { sandboxed: true, signedArtifacts: false },
  };
  await registry.register(agent);

  const ledger = new FileTaskLedger(join(dir, "events.jsonl"));
  const runtime = new AgentMeshRuntime({
    registry,
    ledger,
    policy: new SimplePolicyEngine({ maxCostUsd: 1, deniedTools: [] }),
    artifacts: new FileArtifactStore(join(dir, "artifacts")),
    adapters: new Map([["mock", new MockModelAdapter()]]),
  });

  const result = await runtime.createAndRunTask({
    objective: "Explain task ledgers",
    capability: "reason",
    input: { audience: "engineers" },
    createdBy: "test",
    metadata: {},
  });

  assert.equal(result.task.status, "completed");
  assert.ok(result.artifact);
  assert.equal(result.artifact?.producerAgentId, "mock-worker");
  assert.deepEqual(
    result.events.map((event) => event.type),
    [
      "TaskCreated",
      "AgentSelected",
      "PolicyChecked",
      "DelegationIssued",
      "TaskStarted",
      "PolicyChecked",
      "ModelCalled",
      "PolicyChecked",
      "ArtifactCreated",
      "ArtifactVerified",
      "TaskCompleted",
    ],
  );
});

test("sqlite store persists tasks, ledger events, artifacts, registry, and memory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-mesh-sqlite-"));
  const dbPath = join(dir, "agent-mesh.sqlite");
  const store = new SQLiteAgentMeshStore(dbPath);
  const agent: AgentManifest = {
    id: "sqlite-worker",
    name: "SQLite Worker",
    version: "0.1.0",
    provider: "mock",
    capabilities: [{ id: "design", description: "Design systems", requiredTools: [] }],
    trust: { level: "medium", score: 0.9 },
    cost: { estimatedUsdPerTask: 0 },
    latency: { estimatedMs: 1 },
    security: { sandboxed: true, signedArtifacts: false },
  };
  await store.register(agent);
  await store.write({
    scope: "org",
    ownerId: "default",
    content: { rule: "Prefer task ledgers for auditability." },
    tags: ["architecture"],
  });

  const runtime = new AgentMeshRuntime({
    registry: store,
    ledger: store,
    tasks: store,
    memory: store,
    contextProjector: new BasicContextProjector(store),
    policy: new SimplePolicyEngine({ maxCostUsd: 1, deniedTools: [] }),
    artifacts: store,
    adapters: new Map([["mock", new MockModelAdapter()]]),
  });

  const result = await runtime.createAndRunTask({
    objective: "Design a task ledger",
    capability: "design",
    input: {},
    createdBy: "test",
    metadata: {},
  });

  assert.equal(result.task.status, "completed");
  assert.ok(result.artifact);
  assert.ok(result.events.some((event) => event.type === "ContextProjected"));
  assert.ok(result.events.some((event) => event.type === "MemoryWritten"));
  store.close();

  const reopened = new SQLiteAgentMeshStore(dbPath);
  assert.equal((await reopened.listAgents()).length, 1);
  assert.equal((await reopened.getTask(result.task.id))?.status, "completed");
  assert.equal((await reopened.listEvents(result.task.id)).at(-1)?.type, "TaskCompleted");
  assert.equal((await reopened.listByTask(result.task.id)).length, 1);
  assert.ok((await reopened.listMemory({ scope: "task", taskId: result.task.id })).length >= 1);
  reopened.close();
});

test("policy denial fails task before model execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-mesh-policy-"));
  const registry = new InMemoryAgentRegistry();
  const agent: AgentManifest = {
    id: "expensive-worker",
    name: "Expensive Worker",
    version: "0.1.0",
    provider: "mock",
    capabilities: [{ id: "reason", description: "Reason about a task", requiredTools: [] }],
    trust: { level: "medium", score: 0.8 },
    cost: { estimatedUsdPerTask: 10 },
    latency: { estimatedMs: 1 },
    security: { sandboxed: true, signedArtifacts: false },
  };
  await registry.register(agent);

  const ledger = new FileTaskLedger(join(dir, "events.jsonl"));
  const runtime = new AgentMeshRuntime({
    registry,
    ledger,
    policy: new SimplePolicyEngine({ maxCostUsd: 1, deniedTools: [] }),
    artifacts: new FileArtifactStore(join(dir, "artifacts")),
    adapters: new Map([["mock", new MockModelAdapter()]]),
  });

  const result = await runtime.createAndRunTask({
    objective: "This should be blocked",
    capability: "reason",
    input: {},
    createdBy: "test",
    metadata: {},
  });

  assert.equal(result.task.status, "failed");
  assert.ok(result.events.some((event) => event.type === "PolicyChecked"));
  assert.ok(!result.events.some((event) => event.type === "ModelCalled"));
});
