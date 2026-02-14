import type { Task } from "@unblock/common";

export class TaskStore {
  private tasks = new Map<string, Task>();

  upsert(task: Task) {
    this.tasks.set(task.id, task);
  }

  get(id: string) {
    return this.tasks.get(id);
  }

  list() {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
  }
}

