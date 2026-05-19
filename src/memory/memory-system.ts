import {
  AgentManifest,
  ContextProjection,
  JsonValue,
  MemoryRecord,
  MemoryRecordSchema,
  Task,
  newId,
  nowIso,
} from "../protocol/index.js";

export interface CreateMemoryInput {
  scope: MemoryRecord["scope"];
  ownerId: string;
  taskId?: string;
  content: JsonValue;
  tags?: string[];
}

export interface MemoryStore {
  write(input: CreateMemoryInput): Promise<MemoryRecord>;
  search(query: string, options?: { scope?: MemoryRecord["scope"]; ownerId?: string; limit?: number }): Promise<MemoryRecord[]>;
  listMemory(options?: { scope?: MemoryRecord["scope"]; ownerId?: string; taskId?: string }): Promise<MemoryRecord[]>;
}

export interface ContextProjector {
  project(task: Task, agent: AgentManifest): Promise<ContextProjection>;
}

export class BasicContextProjector implements ContextProjector {
  constructor(
    private readonly memory: MemoryStore,
    private readonly options: { tokenBudget: number } = { tokenBudget: 4000 },
  ) {}

  async project(task: Task, agent: AgentManifest): Promise<ContextProjection> {
    const taskMemories = await this.memory.listMemory({ scope: "task", taskId: task.id });
    const agentMemories = await this.memory.search(task.objective, {
      scope: "agent",
      ownerId: agent.id,
      limit: 3,
    });
    const orgMemories = await this.memory.search(task.objective, {
      scope: "org",
      ownerId: "default",
      limit: 3,
    });
    const selected = [...taskMemories, ...agentMemories, ...orgMemories];
    const memorySummary = selected
      .map((memory) => `- [${memory.scope}:${memory.id}] ${compact(memory.content)}`)
      .join("\n");

    return {
      id: newId("ctx"),
      taskId: task.id,
      agentId: agent.id,
      summary: [
        `Task: ${task.objective}`,
        `Capability: ${task.capability}`,
        `Agent: ${agent.id}`,
        selected.length ? `Relevant memory:\n${memorySummary}` : "Relevant memory: none",
      ].join("\n"),
      memoryIds: selected.map((memory) => memory.id),
      artifactIds: [],
      tokenBudget: this.options.tokenBudget,
      createdAt: nowIso(),
    };
  }
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly records = new Map<string, MemoryRecord>();

  async write(input: CreateMemoryInput): Promise<MemoryRecord> {
    const now = nowIso();
    const record = MemoryRecordSchema.parse({
      id: newId("mem"),
      scope: input.scope,
      ownerId: input.ownerId,
      taskId: input.taskId,
      content: input.content,
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
    });
    this.records.set(record.id, record);
    return record;
  }

  async search(query: string, options: { scope?: MemoryRecord["scope"]; ownerId?: string; limit?: number } = {}): Promise<MemoryRecord[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...this.records.values()]
      .filter((record) => (options.scope ? record.scope === options.scope : true))
      .filter((record) => (options.ownerId ? record.ownerId === options.ownerId : true))
      .map((record) => ({
        record,
        score: terms.reduce((score, term) => score + (JSON.stringify(record.content).toLowerCase().includes(term) ? 1 : 0), 0),
      }))
      .filter((item) => item.score > 0 || terms.length === 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit ?? 10)
      .map((item) => item.record);
  }

  async listMemory(options: { scope?: MemoryRecord["scope"]; ownerId?: string; taskId?: string } = {}): Promise<MemoryRecord[]> {
    return [...this.records.values()]
      .filter((record) => (options.scope ? record.scope === options.scope : true))
      .filter((record) => (options.ownerId ? record.ownerId === options.ownerId : true))
      .filter((record) => (options.taskId ? record.taskId === options.taskId : true));
  }
}

function compact(value: JsonValue): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}
