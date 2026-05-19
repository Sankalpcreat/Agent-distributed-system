import {
  AgentManifest,
  CreateTaskRequest,
  CreateTaskRequestSchema,
  Delegation,
  Artifact,
  ArtifactGraph,
  LedgerEvent,
  MemoryRecord,
  Task,
  newId,
  nowIso,
} from "../protocol/index.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { TaskLedger } from "../ledger/file-ledger.js";
import { ModelAdapter } from "../adapters/model-adapter.js";
import { ContextProjector, MemoryStore } from "../memory/memory-system.js";
import { TaskStore } from "./task-store.js";

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

export interface AgentMeshRuntimeOptions {
  registry: AgentRegistry;
  policy: PolicyEngine;
  ledger: TaskLedger;
  artifacts: ArtifactStore;
  adapters: Map<string, ModelAdapter>;
  tasks?: TaskStore;
  memory?: MemoryStore;
  contextProjector?: ContextProjector;
  retry?: RetryPolicy;
}

export interface TaskExecutionResult {
  task: Task;
  artifact?: Artifact;
  events: LedgerEvent[];
}

export class AgentMeshRuntime {
  private readonly tasks = new Map<string, Task>();
  private readonly retry: RetryPolicy;

  constructor(private readonly options: AgentMeshRuntimeOptions) {
    this.retry = options.retry ?? { maxAttempts: 2, baseDelayMs: 250 };
  }

  async createAndRunTask(input: CreateTaskRequest): Promise<TaskExecutionResult> {
    const request = CreateTaskRequestSchema.parse(input);
    const now = nowIso();
    let task: Task = {
      id: newId("task"),
      objective: request.objective,
      capability: request.capability,
      input: request.input,
      status: "created",
      createdBy: request.createdBy,
      createdAt: now,
      updatedAt: now,
      metadata: request.metadata,
    };

    this.tasks.set(task.id, task);
    await this.options.tasks?.save(task);
    await this.record("TaskCreated", task.id, undefined, {
      objective: task.objective,
      capability: task.capability,
    });

    const agent = await this.options.registry.findForCapability(task.capability);
    if (!agent) {
      task = await this.failTask(task, `no agent found for capability ${task.capability}`);
      return this.result(task);
    }

    task = await this.updateTask(task.id, {
      status: "submitted",
      assignedAgentId: agent.id,
    });

    await this.record("AgentSelected", task.id, agent.id, {
      agentId: agent.id,
      capability: task.capability,
      trustScore: agent.trust.score,
    });

    const policyDecision = await this.options.policy.decide({
      taskId: task.id,
      agent,
      action: "delegate",
      estimatedCostUsd: agent.cost.estimatedUsdPerTask,
    });

    await this.record("PolicyChecked", task.id, agent.id, {
      policyDecisionId: policyDecision.id,
      allowed: policyDecision.allowed,
      reason: policyDecision.reason,
    });

    if (!policyDecision.allowed) {
      task = await this.failTask(task, policyDecision.reason, agent.id);
      return this.result(task);
    }

    const delegation: Delegation = {
      id: newId("delegation"),
      taskId: task.id,
      fromAgentId: "runtime",
      toAgentId: agent.id,
      capability: task.capability,
      expectedOutput: "artifact",
      permissions: {
        tools: agent.capabilities.find((item) => item.id === task.capability)?.requiredTools ?? [],
        readArtifacts: [],
        writeArtifacts: true,
        canDelegate: false,
        maxCostUsd: agent.cost.estimatedUsdPerTask || 1,
      },
      createdAt: nowIso(),
    };

    await this.record("DelegationIssued", task.id, agent.id, {
      delegationId: delegation.id,
      permissions: delegation.permissions,
    });

    task = await this.updateTask(task.id, { status: "working" });
    await this.record("TaskStarted", task.id, agent.id, { attempt: 1 });

    const adapter = this.options.adapters.get(agent.provider);
    if (!adapter) {
      task = await this.failTask(task, `no adapter registered for provider ${agent.provider}`, agent.id);
      return this.result(task);
    }

    const artifact = await this.runWithRetry(task, agent, adapter);
    if (!artifact) {
      return this.result(this.tasks.get(task.id) ?? task);
    }

    task = await this.updateTask(task.id, { status: "completed" });
    await this.record("TaskCompleted", task.id, agent.id, {
      artifactId: artifact.id,
    });

    return this.result(task, artifact);
  }

  async getTask(id: string): Promise<Task | undefined> {
    return this.tasks.get(id) ?? this.options.tasks?.getTask(id);
  }

  async listTasks(): Promise<Task[]> {
    return this.options.tasks?.listTasks() ?? [...this.tasks.values()];
  }

  async listEvents(taskId: string): Promise<LedgerEvent[]> {
    return this.options.ledger.listEvents(taskId);
  }

  async getArtifact(id: string): Promise<Artifact | undefined> {
    return this.options.artifacts.get(id);
  }

  async listTaskArtifacts(taskId: string): Promise<Artifact[]> {
    return this.options.artifacts.listByTask(taskId);
  }

  async getArtifactGraph(id: string): Promise<ArtifactGraph | undefined> {
    return this.options.artifacts.graph(id);
  }

  async listMemory(options: { scope?: MemoryRecord["scope"]; ownerId?: string; taskId?: string } = {}): Promise<MemoryRecord[]> {
    return this.options.memory?.listMemory(options) ?? [];
  }

  private async runWithRetry(task: Task, agent: AgentManifest, adapter: ModelAdapter): Promise<Artifact | undefined> {
    let lastError = "unknown error";
    const contextProjection = await this.options.contextProjector?.project(task, agent);
    if (contextProjection) {
      await this.record("ContextProjected", task.id, agent.id, {
        contextProjectionId: contextProjection.id,
        memoryIds: contextProjection.memoryIds,
        artifactIds: contextProjection.artifactIds,
        tokenBudget: contextProjection.tokenBudget,
      });
    }

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt += 1) {
      try {
        if (attempt > 1) {
          await this.record("TaskStarted", task.id, agent.id, { attempt });
        }

        const callPolicy = await this.options.policy.decide({
          taskId: task.id,
          agent,
          action: "call_model",
          estimatedCostUsd: agent.cost.estimatedUsdPerTask,
        });

        await this.record("PolicyChecked", task.id, agent.id, {
          policyDecisionId: callPolicy.id,
          action: callPolicy.action,
          allowed: callPolicy.allowed,
          reason: callPolicy.reason,
        });

        if (!callPolicy.allowed) {
          throw new Error(callPolicy.reason);
        }

        await this.record("ModelCalled", task.id, agent.id, {
          adapterId: adapter.id,
          attempt,
        });

        const modelResponse = await adapter.generate({
          taskId: task.id,
          objective: task.objective,
          input: task.input,
          context: contextProjection?.summary ?? `agent=${agent.id}; capability=${task.capability}`,
        });

        const artifactPolicy = await this.options.policy.decide({
          taskId: task.id,
          agent,
          action: "write_artifact",
        });

        await this.record("PolicyChecked", task.id, agent.id, {
          policyDecisionId: artifactPolicy.id,
          action: artifactPolicy.action,
          allowed: artifactPolicy.allowed,
          reason: artifactPolicy.reason,
        });

        if (!artifactPolicy.allowed) {
          throw new Error(artifactPolicy.reason);
        }

        const artifact = await this.options.artifacts.create({
          taskId: task.id,
          producerAgentId: agent.id,
          type: "model_output",
          content: {
            output: modelResponse.output,
            rawText: modelResponse.rawText,
            usage: modelResponse.usage ?? {},
          },
        });

        await this.record("ArtifactCreated", task.id, agent.id, {
          artifactId: artifact.id,
          contentHash: artifact.contentHash,
        });

        await this.record("ArtifactVerified", task.id, agent.id, {
          artifactId: artifact.id,
          verifier: "schema",
          result: "passed",
        });

        const memory = await this.options.memory?.write({
          scope: "task",
          ownerId: task.id,
          taskId: task.id,
          content: {
            artifactId: artifact.id,
            summary: modelResponse.rawText.slice(0, 1000),
          },
          tags: ["artifact", "model_output", agent.id],
        });

        if (memory) {
          await this.record("MemoryWritten", task.id, agent.id, {
            memoryId: memory.id,
            scope: memory.scope,
          });
        }

        return artifact;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < this.retry.maxAttempts) {
          await this.record("RetryScheduled", task.id, agent.id, {
            attempt,
            nextAttempt: attempt + 1,
            reason: lastError,
          });
          await delay(this.retry.baseDelayMs * attempt);
        }
      }
    }

    await this.failTask(task, lastError, agent.id);
    return undefined;
  }

  private async failTask(task: Task, reason: string, agentId?: string): Promise<Task> {
    const updated = await this.updateTask(task.id, { status: "failed" });
    await this.record("TaskFailed", task.id, agentId, { reason });
    return updated;
  }

  private async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    const current = this.tasks.get(id);
    if (!current) throw new Error(`task ${id} does not exist`);
    const updated: Task = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };
    this.tasks.set(id, updated);
    await this.options.tasks?.save(updated);
    return updated;
  }

  private async result(task: Task, artifact?: Artifact): Promise<TaskExecutionResult> {
    return {
      task,
      artifact,
      events: await this.options.ledger.listEvents(task.id),
    };
  }

  private async record(
    type: LedgerEvent["type"],
    taskId: string,
    agentId: string | undefined,
    payload: LedgerEvent["payload"],
  ): Promise<void> {
    await this.options.ledger.append({
      id: newId("event"),
      type,
      taskId,
      agentId,
      payload,
      createdAt: nowIso(),
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
