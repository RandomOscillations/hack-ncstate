import { describe, it, expect, beforeEach } from "vitest";
import { TaskStore } from "./store";
import { TaskService } from "./service";
import type { CreateTaskRequest, SubmitAnswerRequest } from "@unblock/common";

const VALID_CREATE: CreateTaskRequest = {
  question: "What color is this button?",
  imageUrls: ["https://example.com/img.png"],
  bountyLamports: 100_000,
  agentPubkey: "AgentPubkey1234567890",
};

const VALID_ANSWER: SubmitAnswerRequest = {
  resolverPubkey: "ResolverPubkey1234567890",
  answerText: "It is blue",
};

let svc: TaskService;
let clock: { now: number };

beforeEach(() => {
  clock = { now: 1_000_000 };
  svc = new TaskService(new TaskStore(), { nowMs: () => clock.now });
});

describe("TaskService.create", () => {
  it("creates a task with OPEN status", () => {
    const task = svc.create(VALID_CREATE);
    expect(task.status).toBe("OPEN");
    expect(task.question).toBe(VALID_CREATE.question);
    expect(task.bountyLamports).toBe(VALID_CREATE.bountyLamports);
    expect(task.agentPubkey).toBe(VALID_CREATE.agentPubkey);
    expect(task.imageUrls).toEqual(VALID_CREATE.imageUrls);
    expect(task.id).toBeTruthy();
    expect(task.createdAtMs).toBe(clock.now);
  });

  it("sets expiresAtMs when expiresInSec provided", () => {
    const task = svc.create({ ...VALID_CREATE, expiresInSec: 60 });
    expect(task.expiresAtMs).toBe(clock.now + 60_000);
  });

  it("leaves expiresAtMs undefined when not provided", () => {
    const task = svc.create(VALID_CREATE);
    expect(task.expiresAtMs).toBeUndefined();
  });
});

describe("TaskService.submitAnswer", () => {
  it("transitions OPEN → ANSWERED", () => {
    const task = svc.create(VALID_CREATE);
    clock.now += 5000;
    const updated = svc.submitAnswer(task.id, VALID_ANSWER);
    expect(updated.status).toBe("ANSWERED");
    expect(updated.answerText).toBe("It is blue");
    expect(updated.resolverPubkey).toBe(VALID_ANSWER.resolverPubkey);
    expect(updated.updatedAtMs).toBe(clock.now);
  });

  it("throws if task not OPEN", () => {
    const task = svc.create(VALID_CREATE);
    svc.submitAnswer(task.id, VALID_ANSWER);
    expect(() => svc.submitAnswer(task.id, VALID_ANSWER)).toThrow("Task not open");
  });

  it("throws if task not found", () => {
    expect(() => svc.submitAnswer("nonexistent", VALID_ANSWER)).toThrow("Task not found");
  });
});

describe("TaskService.markConfirmedPaid", () => {
  it("transitions ANSWERED → CONFIRMED_PAID with tx sig", () => {
    const task = svc.create(VALID_CREATE);
    svc.submitAnswer(task.id, VALID_ANSWER);
    clock.now += 10000;
    const updated = svc.markConfirmedPaid(task.id, "MOCK_RELEASE_TX");
    expect(updated.status).toBe("CONFIRMED_PAID");
    expect(updated.releaseTxSig).toBe("MOCK_RELEASE_TX");
    expect(updated.updatedAtMs).toBe(clock.now);
  });

  it("throws if task not ANSWERED", () => {
    const task = svc.create(VALID_CREATE);
    expect(() => svc.markConfirmedPaid(task.id)).toThrow("Task not answered");
  });
});

describe("TaskService.markRejectedRefunded", () => {
  it("transitions ANSWERED → REJECTED_REFUNDED with tx sig", () => {
    const task = svc.create(VALID_CREATE);
    svc.submitAnswer(task.id, VALID_ANSWER);
    clock.now += 10000;
    const updated = svc.markRejectedRefunded(task.id, "MOCK_REFUND_TX");
    expect(updated.status).toBe("REJECTED_REFUNDED");
    expect(updated.refundTxSig).toBe("MOCK_REFUND_TX");
  });

  it("throws if task not ANSWERED", () => {
    const task = svc.create(VALID_CREATE);
    expect(() => svc.markRejectedRefunded(task.id)).toThrow("Task not answered");
  });
});

describe("TaskService.list", () => {
  it("returns tasks sorted newest first", () => {
    clock.now = 1000;
    const t1 = svc.create({ ...VALID_CREATE, question: "First" });
    clock.now = 2000;
    const t2 = svc.create({ ...VALID_CREATE, question: "Second" });
    clock.now = 3000;
    const t3 = svc.create({ ...VALID_CREATE, question: "Third" });

    const list = svc.list();
    expect(list).toHaveLength(3);
    expect(list[0].id).toBe(t3.id);
    expect(list[1].id).toBe(t2.id);
    expect(list[2].id).toBe(t1.id);
  });

  it("returns empty array when no tasks", () => {
    expect(svc.list()).toEqual([]);
  });
});

describe("TaskService.get", () => {
  it("returns undefined for missing id", () => {
    expect(svc.get("nope")).toBeUndefined();
  });

  it("returns the task by id", () => {
    const task = svc.create(VALID_CREATE);
    expect(svc.get(task.id)).toEqual(task);
  });
});

describe("full happy path", () => {
  it("OPEN → ANSWERED → CONFIRMED_PAID", () => {
    const task = svc.create(VALID_CREATE);
    expect(task.status).toBe("OPEN");

    const answered = svc.submitAnswer(task.id, VALID_ANSWER);
    expect(answered.status).toBe("ANSWERED");

    const confirmed = svc.markConfirmedPaid(task.id, "RELEASE_SIG");
    expect(confirmed.status).toBe("CONFIRMED_PAID");
    expect(confirmed.releaseTxSig).toBe("RELEASE_SIG");
  });

  it("OPEN → ANSWERED → REJECTED_REFUNDED", () => {
    const task = svc.create(VALID_CREATE);
    svc.submitAnswer(task.id, VALID_ANSWER);

    const rejected = svc.markRejectedRefunded(task.id, "REFUND_SIG");
    expect(rejected.status).toBe("REJECTED_REFUNDED");
    expect(rejected.refundTxSig).toBe("REFUND_SIG");
  });
});
