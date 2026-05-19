import { Task } from "../protocol/index.js";

export interface TaskStore {
  save(task: Task): Promise<void>;
  getTask(id: string): Promise<Task | undefined>;
  listTasks(): Promise<Task[]>;
}
