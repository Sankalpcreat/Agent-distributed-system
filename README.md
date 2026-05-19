# Agent Mesh Runtime

This is the first MVP for a provider-neutral distributed agent runtime.

The runtime owns:

- Agent Mesh protocol objects: `Task`, `Message`, `Delegation`, `Artifact`, `PolicyDecision`, `TraceEvent`
- append-only task ledger
- agent capability registry
- policy checks
- retry/recovery
- SQLite-backed task, ledger, registry, memory, and artifact storage
- artifact graph storage
- context projection and task memory
- model adapters, starting with OpenAI and Gemini

The first goal is simple:

```text
create task -> select agent -> policy check -> call adapter -> write artifact -> record ledger -> complete task
```

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Without `OPENAI_API_KEY` or `GEMINI_API_KEY`, the server uses the mock adapter.

Provider selection:

```bash
OPENAI_API_KEY=... npm run dev
GEMINI_API_KEY=... npm run dev
AGENT_MESH_PROVIDER=gemini npm run dev
```

Gemini uses the current `@google/genai` SDK and defaults to `gemini-3-flash-preview`.

## API

```bash
curl http://localhost:8787/.well-known/agent-card.json

curl -X POST http://localhost:8787/tasks \
  -H 'content-type: application/json' \
  -d '{"objective":"Write a short explanation of task ledgers","capability":"reason"}'

curl http://localhost:8787/tasks/{task_id}/events
curl http://localhost:8787/tasks/{task_id}/artifacts
curl http://localhost:8787/artifacts/{artifact_id}/graph
curl http://localhost:8787/memory?scope=task
```

## Current v0.2 Core

- `Agent Mesh Protocol`: Zod schemas for tasks, messages, delegations, artifacts, policies, traces, ledger events, memory, and context projections.
- `Agent Mesh Runtime`: deterministic task loop with capability routing, policy checks, retry, context projection, model invocation, artifact verification, and memory writeback.
- `Agent Registry`: persistent SQLite registry with capability-based selection.
- `Task Ledger`: append-only SQLite ledger with ordered events.
- `Artifact Graph`: content-hashed artifacts with parent/child graph lookup.
- `Policy Engine`: deny-capable policy checks before delegation, model calls, and artifact writes.
- `Memory System`: task, agent, org, and artifact memory records with basic context projection.
- `Adapters`: mock, OpenAI, and Gemini model adapters.
- `Conformance Suite`: tests for runtime event order, SQLite persistence, memory writeback, and policy denial.
