import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Artifact, ArtifactGraph, ArtifactSchema, JsonValue, newId, nowIso } from "../protocol/index.js";

export interface CreateArtifactInput {
  taskId: string;
  producerAgentId: string;
  type: string;
  content: JsonValue;
  parentArtifactIds?: string[];
}

export interface ArtifactStore {
  create(input: CreateArtifactInput): Promise<Artifact>;
  get(id: string): Promise<Artifact | undefined>;
  listByTask(taskId: string): Promise<Artifact[]>;
  graph(id: string): Promise<ArtifactGraph | undefined>;
}

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly directory: string) {}

  async create(input: CreateArtifactInput): Promise<Artifact> {
    await mkdir(this.directory, { recursive: true });
    const stableContent = JSON.stringify(input.content);
    const artifact: Artifact = {
      id: newId("artifact"),
      taskId: input.taskId,
      producerAgentId: input.producerAgentId,
      type: input.type,
      content: input.content,
      contentHash: createHash("sha256").update(stableContent).digest("hex"),
      parentArtifactIds: input.parentArtifactIds ?? [],
      createdAt: nowIso(),
    };

    const parsed = ArtifactSchema.parse(artifact);
    await writeFile(this.pathFor(parsed.id), JSON.stringify(parsed, null, 2), "utf8");
    return parsed;
  }

  async get(id: string): Promise<Artifact | undefined> {
    try {
      const raw = await readFile(this.pathFor(id), "utf8");
      return ArtifactSchema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async listByTask(taskId: string): Promise<Artifact[]> {
    try {
      const filenames = await readdir(this.directory);
      const artifacts = await Promise.all(
        filenames
          .filter((filename) => filename.endsWith(".json"))
          .map(async (filename) => ArtifactSchema.parse(JSON.parse(await readFile(join(this.directory, filename), "utf8")))),
      );
      return artifacts.filter((artifact) => artifact.taskId === taskId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async graph(id: string): Promise<ArtifactGraph | undefined> {
    const artifact = await this.get(id);
    if (!artifact) return undefined;
    const parents = (await Promise.all(artifact.parentArtifactIds.map((parentId) => this.get(parentId)))).filter(
      (item): item is Artifact => Boolean(item),
    );
    return { artifact, parents, children: [] };
  }

  private pathFor(id: string): string {
    return join(this.directory, `${id}.json`);
  }
}
