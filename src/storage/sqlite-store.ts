import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CreateArtifactInput, ArtifactStore } from "../artifacts/artifact-store.js";
import { CreateMemoryInput, MemoryStore } from "../memory/memory-system.js";
import {
  AgentManifest,
  AgentManifestSchema,
  Artifact,
  ArtifactGraph,
  ArtifactSchema,
  LedgerEvent,
  LedgerEventSchema,
  MemoryRecord,
  MemoryRecordSchema,
  Task,
  TaskSchema,
  newId,
  nowIso,
} from "../protocol/index.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { TaskLedger } from "../ledger/file-ledger.js";
import { TaskStore } from "../runtime/task-store.js";

export class SQLiteAgentMeshStore implements AgentRegistry, TaskLedger, TaskStore, ArtifactStore, MemoryStore {
  private readonly db: DatabaseSync;

  constructor(private readonly dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  async register(agent: AgentManifest): Promise<void> {
    const parsed = AgentManifestSchema.parse(agent);
    this.db
      .prepare(
        `INSERT INTO agents (id, provider, capability_ids, manifest_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           capability_ids = excluded.capability_ids,
           manifest_json = excluded.manifest_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        parsed.id,
        parsed.provider,
        JSON.stringify(parsed.capabilities.map((capability) => capability.id)),
        JSON.stringify(parsed),
        nowIso(),
      );
  }

  async listAgents(): Promise<AgentManifest[]> {
    return this.db
      .prepare("SELECT manifest_json FROM agents ORDER BY id")
      .all()
      .map((row) => AgentManifestSchema.parse(JSON.parse(String((row as Row).manifest_json))));
  }

  async findForCapability(capability: string): Promise<AgentManifest | undefined> {
    const candidates = (await this.listAgents()).filter((agent) => agent.capabilities.some((item) => item.id === capability));
    candidates.sort((a, b) => {
      const scoreA = a.trust.score - a.cost.estimatedUsdPerTask * 0.05 - a.latency.estimatedMs / 1_000_000;
      const scoreB = b.trust.score - b.cost.estimatedUsdPerTask * 0.05 - b.latency.estimatedMs / 1_000_000;
      return scoreB - scoreA;
    });
    return candidates[0];
  }

  async save(task: Task): Promise<void> {
    const parsed = TaskSchema.parse(task);
    this.db
      .prepare(
        `INSERT INTO tasks (id, status, capability, assigned_agent_id, task_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           capability = excluded.capability,
           assigned_agent_id = excluded.assigned_agent_id,
           task_json = excluded.task_json,
           updated_at = excluded.updated_at`,
      )
      .run(parsed.id, parsed.status, parsed.capability, parsed.assignedAgentId ?? null, JSON.stringify(parsed), parsed.updatedAt);
  }

  async getTask(id: string): Promise<Task | undefined> {
    const taskRow = this.db.prepare("SELECT task_json FROM tasks WHERE id = ?").get(id) as Row | undefined;
    if (taskRow?.task_json) return TaskSchema.parse(JSON.parse(String(taskRow.task_json)));
    return undefined;
  }

  async listTasks(): Promise<Task[]> {
    return this.db
      .prepare("SELECT task_json FROM tasks ORDER BY updated_at DESC")
      .all()
      .map((row) => TaskSchema.parse(JSON.parse(String((row as Row).task_json))));
  }

  async append(event: LedgerEvent): Promise<void> {
    const parsed = LedgerEventSchema.parse(event);
    this.db
      .prepare(
        `INSERT INTO ledger_events (id, type, task_id, agent_id, event_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(parsed.id, parsed.type, parsed.taskId, parsed.agentId ?? null, JSON.stringify(parsed), parsed.createdAt);
  }

  async listEvents(taskId?: string): Promise<LedgerEvent[]> {
    const rows = taskId
      ? this.db
          .prepare("SELECT event_json FROM ledger_events WHERE task_id = ? ORDER BY seq ASC")
          .all(taskId)
      : this.db.prepare("SELECT event_json FROM ledger_events ORDER BY seq ASC").all();
    return rows.map((row) => LedgerEventSchema.parse(JSON.parse(String((row as Row).event_json))));
  }

  async create(input: CreateArtifactInput): Promise<Artifact> {
    const stableContent = JSON.stringify(input.content);
    const artifact = ArtifactSchema.parse({
      id: newId("artifact"),
      taskId: input.taskId,
      producerAgentId: input.producerAgentId,
      type: input.type,
      content: input.content,
      contentHash: createHash("sha256").update(stableContent).digest("hex"),
      parentArtifactIds: input.parentArtifactIds ?? [],
      createdAt: nowIso(),
    });
    this.db
      .prepare(
        `INSERT INTO artifacts (id, task_id, producer_agent_id, type, content_hash, parent_artifact_ids, artifact_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.taskId,
        artifact.producerAgentId,
        artifact.type,
        artifact.contentHash,
        JSON.stringify(artifact.parentArtifactIds),
        JSON.stringify(artifact),
        artifact.createdAt,
      );
    return artifact;
  }

  async get(id: string): Promise<Artifact | undefined> {
    const row = this.db.prepare("SELECT artifact_json FROM artifacts WHERE id = ?").get(id) as Row | undefined;
    return row ? ArtifactSchema.parse(JSON.parse(String(row.artifact_json))) : undefined;
  }

  async listByTask(taskId: string): Promise<Artifact[]> {
    return this.db
      .prepare("SELECT artifact_json FROM artifacts WHERE task_id = ? ORDER BY created_at ASC")
      .all(taskId)
      .map((row) => ArtifactSchema.parse(JSON.parse(String((row as Row).artifact_json))));
  }

  async graph(id: string): Promise<ArtifactGraph | undefined> {
    const artifact = await this.get(id);
    if (!artifact) return undefined;
    const parents = (await Promise.all(artifact.parentArtifactIds.map((parentId) => this.get(parentId)))).filter(
      (item): item is Artifact => Boolean(item),
    );
    const children = this.db
      .prepare("SELECT artifact_json FROM artifacts WHERE parent_artifact_ids LIKE ? ORDER BY created_at ASC")
      .all(`%${id}%`)
      .map((row) => ArtifactSchema.parse(JSON.parse(String((row as Row).artifact_json))));
    return { artifact, parents, children };
  }

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
    this.db
      .prepare(
        `INSERT INTO memories (id, scope, owner_id, task_id, tags_json, content_json, memory_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.scope,
        record.ownerId,
        record.taskId ?? null,
        JSON.stringify(record.tags),
        JSON.stringify(record.content),
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  async search(
    query: string,
    options: { scope?: MemoryRecord["scope"]; ownerId?: string; limit?: number } = {},
  ): Promise<MemoryRecord[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (await this.listMemory({ scope: options.scope, ownerId: options.ownerId }))
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
    const rows = this.db.prepare("SELECT memory_json FROM memories ORDER BY updated_at DESC").all();
    return rows
      .map((row) => MemoryRecordSchema.parse(JSON.parse(String((row as Row).memory_json))))
      .filter((record) => (options.scope ? record.scope === options.scope : true))
      .filter((record) => (options.ownerId ? record.ownerId === options.ownerId : true))
      .filter((record) => (options.taskId ? record.taskId === options.taskId : true));
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        capability_ids TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        capability TEXT NOT NULL,
        assigned_agent_id TEXT,
        task_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ledger_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        task_id TEXT NOT NULL,
        agent_id TEXT,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        producer_agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        parent_artifact_ids TEXT NOT NULL,
        artifact_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        task_id TEXT,
        tags_json TEXT NOT NULL,
        content_json TEXT NOT NULL,
        memory_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agents_provider ON agents(provider);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_ledger_task ON ledger_events(task_id, seq);
      CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);
      CREATE INDEX IF NOT EXISTS idx_memories_scope_owner ON memories(scope, owner_id);
      CREATE INDEX IF NOT EXISTS idx_memories_task ON memories(task_id);
    `);
  }
}

type Row = Record<string, unknown>;
