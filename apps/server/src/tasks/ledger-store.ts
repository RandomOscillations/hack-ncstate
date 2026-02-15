import type { LedgerEntry } from "@unblock/common";

const MAX_ENTRIES = 500;

export class LedgerStore {
  private entries = new Map<string, LedgerEntry>();

  add(entry: LedgerEntry): void {
    this.entries.set(entry.id, entry);

    // Cap at MAX_ENTRIES — remove oldest first
    if (this.entries.size > MAX_ENTRIES) {
      const oldest = this.list().pop();
      if (oldest) this.entries.delete(oldest.id);
    }
  }

  list(): LedgerEntry[] {
    return Array.from(this.entries.values()).sort(
      (a, b) => b.timestampMs - a.timestampMs
    );
  }

  getByTask(taskId: string): LedgerEntry[] {
    return this.list().filter((e) => e.taskId === taskId);
  }
}
