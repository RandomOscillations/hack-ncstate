import type { Fulfillment } from "@unblock/common";

export class FulfillmentStore {
  private fulfillments = new Map<string, Fulfillment>();

  upsert(f: Fulfillment): void {
    this.fulfillments.set(f.id, f);
  }

  get(id: string): Fulfillment | undefined {
    return this.fulfillments.get(id);
  }

  listByTask(taskId: string): Fulfillment[] {
    return Array.from(this.fulfillments.values()).filter((f) => f.taskId === taskId);
  }
}
