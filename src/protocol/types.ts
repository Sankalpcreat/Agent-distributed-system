import { z } from "zod";

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const TaskStateSchema = z.enum([
  "created",
  "submitted",
  "working",
  "input_required",
  "auth_required",
  "completed",
  "failed",
  "canceled",
  "rejected",
]);

export type TaskState = z.infer<typeof TaskStateSchema>;

export const CapabilitySchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.record(z.string(), JsonValueSchema).optional(),
  outputSchema: z.record(z.string(), JsonValueSchema).optional(),
  requiredTools: z.array(z.string()).default([]),
});

export type Capability = z.infer<typeof CapabilitySchema>;

export const AgentManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default("0.1.0"),
  provider: z.string().default("local"),
  capabilities: z.array(CapabilitySchema),
  trust: z
    .object({
      level: z.enum(["unknown", "low", "medium", "high"]).default("unknown"),
      score: z.number().min(0).max(1).default(0.5),
    })
    .default({ level: "unknown", score: 0.5 }),
  cost: z
    .object({
      estimatedUsdPerTask: z.number().nonnegative().default(0),
    })
    .default({ estimatedUsdPerTask: 0 }),
  latency: z
    .object({
      estimatedMs: z.number().int().nonnegative().default(0),
    })
    .default({ estimatedMs: 0 }),
  security: z
    .object({
      sandboxed: z.boolean().default(false),
      signedArtifacts: z.boolean().default(false),
    })
    .default({ sandboxed: false, signedArtifacts: false }),
});

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  objective: z.string().min(1),
  capability: z.string().min(1),
  status: TaskStateSchema,
  input: JsonValueSchema.default({}),
  createdBy: z.string().default("user"),
  assignedAgentId: z.string().optional(),
  parentTaskId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.string(), JsonValueSchema).default({}),
});

export type Task = z.infer<typeof TaskSchema>;

export const MessageActSchema = z.enum([
  "request",
  "accept",
  "reject",
  "ask",
  "inform",
  "delegate",
  "progress",
  "complete",
  "fail",
  "cancel",
  "verify",
]);

export type MessageAct = z.infer<typeof MessageActSchema>;

export const MessageSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  act: MessageActSchema,
  payload: JsonValueSchema.default({}),
  createdAt: z.string().datetime(),
});

export type Message = z.infer<typeof MessageSchema>;

export const DelegationSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  fromAgentId: z.string().min(1),
  toAgentId: z.string().min(1),
  capability: z.string().min(1),
  expectedOutput: z.string().default("artifact"),
  permissions: z
    .object({
      tools: z.array(z.string()).default([]),
      readArtifacts: z.array(z.string()).default([]),
      writeArtifacts: z.boolean().default(true),
      canDelegate: z.boolean().default(false),
      maxCostUsd: z.number().nonnegative().default(1),
      expiresAt: z.string().datetime().optional(),
    })
    .default({
      tools: [],
      readArtifacts: [],
      writeArtifacts: true,
      canDelegate: false,
      maxCostUsd: 1,
    }),
  createdAt: z.string().datetime(),
});

export type Delegation = z.infer<typeof DelegationSchema>;

export const PolicyDecisionSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  action: z.string().min(1),
  allowed: z.boolean(),
  reason: z.string(),
  createdAt: z.string().datetime(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  producerAgentId: z.string().min(1),
  type: z.string().min(1),
  content: JsonValueSchema,
  contentHash: z.string().min(1),
  parentArtifactIds: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

export const ArtifactGraphSchema = z.object({
  artifact: ArtifactSchema,
  parents: z.array(ArtifactSchema),
  children: z.array(ArtifactSchema),
});

export type ArtifactGraph = z.infer<typeof ArtifactGraphSchema>;

export const TraceEventSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().optional(),
  name: z.string().min(1),
  attributes: z.record(z.string(), JsonValueSchema).default({}),
  createdAt: z.string().datetime(),
});

export type TraceEvent = z.infer<typeof TraceEventSchema>;

export const LedgerEventTypeSchema = z.enum([
  "TaskCreated",
  "AgentSelected",
  "PolicyChecked",
  "DelegationIssued",
  "DelegationAccepted",
  "ContextProjected",
  "TaskStarted",
  "ModelCalled",
  "RetryScheduled",
  "ArtifactCreated",
  "ArtifactVerified",
  "MemoryWritten",
  "TaskCompleted",
  "TaskFailed",
  "TaskCanceled",
]);

export type LedgerEventType = z.infer<typeof LedgerEventTypeSchema>;

export const LedgerEventSchema = z.object({
  id: z.string().min(1),
  type: LedgerEventTypeSchema,
  taskId: z.string().min(1),
  agentId: z.string().optional(),
  payload: z.record(z.string(), JsonValueSchema).default({}),
  createdAt: z.string().datetime(),
});

export type LedgerEvent = z.infer<typeof LedgerEventSchema>;

export const CreateTaskRequestSchema = z.object({
  objective: z.string().min(1),
  capability: z.string().min(1).default("reason"),
  input: JsonValueSchema.default({}),
  createdBy: z.string().default("user"),
  metadata: z.record(z.string(), JsonValueSchema).default({}),
});

export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const MemoryScopeSchema = z.enum(["task", "agent", "org", "artifact"]);

export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string().min(1),
  scope: MemoryScopeSchema,
  ownerId: z.string().min(1),
  taskId: z.string().optional(),
  content: JsonValueSchema,
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const ContextProjectionSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  summary: z.string(),
  memoryIds: z.array(z.string()).default([]),
  artifactIds: z.array(z.string()).default([]),
  tokenBudget: z.number().int().positive().default(4000),
  createdAt: z.string().datetime(),
});

export type ContextProjection = z.infer<typeof ContextProjectionSchema>;
