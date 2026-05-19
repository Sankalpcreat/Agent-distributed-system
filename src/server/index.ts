import { createServer } from "node:http";
import { bootstrapRuntime } from "./bootstrap.js";
import { readJson, sendError, sendJson } from "./http.js";
import { AgentManifestSchema, CreateTaskRequestSchema } from "../protocol/index.js";

const port = Number(process.env.PORT ?? 8787);
const { runtime, registry, manifest } = await bootstrapRuntime(process.cwd());

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
      sendJson(res, 200, {
        protocol: "agent-mesh/0.1",
        a2aCompatible: true,
        runtime: manifest,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/agents") {
      sendJson(res, 200, { agents: await registry.listAgents() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/agents/register") {
      const body = await readJson(req);
      const agent = AgentManifestSchema.parse(body);
      await registry.register(agent);
      sendJson(res, 201, { agent });
      return;
    }

    if (req.method === "GET" && url.pathname === "/tasks") {
      sendJson(res, 200, { tasks: await runtime.listTasks() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/tasks") {
      const body = await readJson(req);
      const request = CreateTaskRequestSchema.parse(body);
      const result = await runtime.createAndRunTask(request);
      sendJson(res, result.task.status === "failed" ? 500 : 201, result);
      return;
    }

    const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
    if (req.method === "GET" && taskMatch) {
      const task = await runtime.getTask(taskMatch[1]);
      if (!task) {
        sendError(res, 404, "task not found");
        return;
      }
      sendJson(res, 200, { task });
      return;
    }

    const taskEventsMatch = url.pathname.match(/^\/tasks\/([^/]+)\/events$/);
    if (req.method === "GET" && taskEventsMatch) {
      const events = await runtime.listEvents(taskEventsMatch[1]);
      sendJson(res, 200, { events });
      return;
    }

    const taskArtifactsMatch = url.pathname.match(/^\/tasks\/([^/]+)\/artifacts$/);
    if (req.method === "GET" && taskArtifactsMatch) {
      const artifacts = await runtime.listTaskArtifacts(taskArtifactsMatch[1]);
      sendJson(res, 200, { artifacts });
      return;
    }

    const artifactMatch = url.pathname.match(/^\/artifacts\/([^/]+)$/);
    if (req.method === "GET" && artifactMatch) {
      const artifact = await runtime.getArtifact(artifactMatch[1]);
      if (!artifact) {
        sendError(res, 404, "artifact not found");
        return;
      }
      sendJson(res, 200, { artifact });
      return;
    }

    const artifactGraphMatch = url.pathname.match(/^\/artifacts\/([^/]+)\/graph$/);
    if (req.method === "GET" && artifactGraphMatch) {
      const graph = await runtime.getArtifactGraph(artifactGraphMatch[1]);
      if (!graph) {
        sendError(res, 404, "artifact not found");
        return;
      }
      sendJson(res, 200, { graph });
      return;
    }

    if (req.method === "GET" && url.pathname === "/memory") {
      const scope = url.searchParams.get("scope") ?? undefined;
      const ownerId = url.searchParams.get("ownerId") ?? undefined;
      const taskId = url.searchParams.get("taskId") ?? undefined;
      const memory = await runtime.listMemory({
        scope: scope === "task" || scope === "agent" || scope === "org" || scope === "artifact" ? scope : undefined,
        ownerId,
        taskId,
      });
      sendJson(res, 200, { memory });
      return;
    }

    sendError(res, 404, "not found");
  } catch (error) {
    sendError(res, 400, error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, () => {
  console.log(`Agent Mesh Runtime listening on http://localhost:${port}`);
  console.log(`Primary provider: ${manifest.provider}`);
});
