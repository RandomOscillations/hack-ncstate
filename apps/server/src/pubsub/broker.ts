export type PubSubMessage = {
  topic: string;
  payload: Record<string, unknown>;
  publishedAtMs: number;
};

export type Subscriber = {
  id: string;
  topicPattern: string;
  callback: (msg: PubSubMessage) => void;
};

export class PubSubBroker {
  private subscribers = new Map<string, Subscriber>();
  private messageLog: PubSubMessage[] = [];
  private maxLog = 200;

  subscribe(sub: Subscriber): () => void {
    this.subscribers.set(sub.id, sub);
    return () => {
      this.subscribers.delete(sub.id);
    };
  }

  publish(topic: string, payload: Record<string, unknown>): void {
    const msg: PubSubMessage = { topic, payload, publishedAtMs: Date.now() };
    this.messageLog.push(msg);
    if (this.messageLog.length > this.maxLog) this.messageLog.shift();

    for (const sub of this.subscribers.values()) {
      if (this.matches(sub.topicPattern, topic)) {
        try {
          sub.callback(msg);
        } catch (e) {
          console.error(`[pubsub] subscriber ${sub.id} error:`, e);
        }
      }
    }
  }

  getLog(): PubSubMessage[] {
    return [...this.messageLog];
  }

  private matches(pattern: string, topic: string): boolean {
    if (pattern === "*") return true;
    if (pattern === topic) return true;
    // Simple wildcard: "tasks/*" matches "tasks/new", "tasks/abc123/claimed"
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1); // "tasks/"
      return topic.startsWith(prefix);
    }
    return false;
  }
}
