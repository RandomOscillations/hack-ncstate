import crypto from "node:crypto";
import type { CalibrationTask, CalibrationAttempt, Task } from "@unblock/common";

export class CalibrationStore {
  private tasks = new Map<string, CalibrationTask>();
  private attempts: CalibrationAttempt[] = [];
  /** Track which supervisors have attempted which calibration tasks */
  private attemptedBy = new Map<string, Set<string>>(); // calibTaskId -> Set<supervisorAgentId>

  createFromVerified(task: Task, threshold: number): CalibrationTask {
    // Don't create duplicates for the same source task
    for (const ct of this.tasks.values()) {
      if (ct.sourceTaskId === task.id) return ct;
    }

    const ct: CalibrationTask = {
      id: crypto.randomUUID(),
      sourceTaskId: task.id,
      question: task.question,
      context: task.context,
      fulfillmentText: task.fulfillment?.fulfillmentText || "",
      groundTruthScore: task.verifierReview?.groundTruthScore || 0,
      groundTruthPasses: (task.verifierReview?.groundTruthScore || 0) >= threshold,
      createdAtMs: Date.now(),
    };

    this.tasks.set(ct.id, ct);
    console.log(`[calibration] created calibration task ${ct.id} from verified task ${task.id}`);
    return ct;
  }

  /** List calibration tasks not yet attempted by a given supervisor */
  listFor(supervisorAgentId: string): CalibrationTask[] {
    const result: CalibrationTask[] = [];
    for (const ct of this.tasks.values()) {
      const attempted = this.attemptedBy.get(ct.id);
      if (!attempted || !attempted.has(supervisorAgentId)) {
        result.push(ct);
      }
    }
    return result;
  }

  get(id: string): CalibrationTask | undefined {
    return this.tasks.get(id);
  }

  recordAttempt(attempt: CalibrationAttempt): void {
    this.attempts.push(attempt);

    // Track that this supervisor attempted this task
    let set = this.attemptedBy.get(attempt.calibrationTaskId);
    if (!set) {
      set = new Set();
      this.attemptedBy.set(attempt.calibrationTaskId, set);
    }
    set.add(attempt.supervisorAgentId);
  }

  getAttemptsFor(supervisorAgentId: string): CalibrationAttempt[] {
    return this.attempts.filter((a) => a.supervisorAgentId === supervisorAgentId);
  }
}
