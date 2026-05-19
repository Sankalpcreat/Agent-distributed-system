import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LedgerEvent, LedgerEventSchema } from "../protocol/index.js";

export interface TaskLedger {
  append(event: LedgerEvent): Promise<void>;
  listEvents(taskId?: string): Promise<LedgerEvent[]>;
}

export class FileTaskLedger implements TaskLedger {
  constructor(private readonly filePath: string) {}

  async append(event: LedgerEvent): Promise<void> {
    const parsed = LedgerEventSchema.parse(event);
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(parsed)}\n`, "utf8");
  }

  async listEvents(taskId?: string): Promise<LedgerEvent[]> {
    let raw = "";
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => LedgerEventSchema.parse(JSON.parse(line)))
      .filter((event) => (taskId ? event.taskId === taskId : true));
  }
}
