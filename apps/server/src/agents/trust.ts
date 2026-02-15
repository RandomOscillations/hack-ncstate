import type { TrustRecord, TrustEvent, SupervisorTier, SupervisorTierInfo, ConfusionOutcome } from "@unblock/common";

const INITIAL_SCORE = 50;
const MAX_HISTORY = 50;

function scoreToTier(score: number): SupervisorTier {
  if (score >= 80) return 1;
  if (score >= 40) return 2;
  if (score >= 15) return 3;
  return 4;
}

const TIER_INFO: Record<SupervisorTier, Omit<SupervisorTierInfo, "tier">> = {
  1: { label: "autonomous", canScoreRealTasks: true, canAutoApprove: true, taskAllocationWeight: 1.0 },
  2: { label: "standard", canScoreRealTasks: true, canAutoApprove: false, taskAllocationWeight: 1.0 },
  3: { label: "probation", canScoreRealTasks: true, canAutoApprove: false, taskAllocationWeight: 0.5 },
  4: { label: "suspended", canScoreRealTasks: false, canAutoApprove: false, taskAllocationWeight: 0.0 },
};

export class TrustStore {
  private records = new Map<string, TrustRecord>();

  getOrCreate(agentId: string): TrustRecord {
    let rec = this.records.get(agentId);
    if (!rec) {
      rec = {
        agentId,
        score: INITIAL_SCORE,
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        lastUpdatedMs: Date.now(),
        history: [],
        tier: scoreToTier(INITIAL_SCORE),
        confusionMatrix: { tp: 0, tn: 0, fp: 0, fn: 0 },
        calibrationAttempts: 0,
        calibrationSuccesses: 0,
      };
      this.records.set(agentId, rec);
    }
    return rec;
  }

  applyDelta(
    agentId: string,
    delta: number,
    taskId: string,
    reason: string,
    txSig?: string
  ): TrustRecord {
    const rec = this.getOrCreate(agentId);
    rec.score = Math.max(0, Math.min(100, rec.score + delta));
    rec.tier = scoreToTier(rec.score);
    rec.totalTasks += 1;
    if (delta > 0) rec.successfulTasks += 1;
    if (delta < 0) rec.failedTasks += 1;
    rec.lastUpdatedMs = Date.now();

    const event: TrustEvent = {
      taskId,
      delta,
      reason,
      timestampMs: Date.now(),
      txSig,
    };
    rec.history.push(event);
    if (rec.history.length > MAX_HISTORY) rec.history.shift();

    this.records.set(agentId, rec);
    console.log(`[trust] ${agentId}: ${rec.score} T${rec.tier} (${delta >= 0 ? "+" : ""}${delta} — ${reason})`);
    return rec;
  }

  getTier(agentId: string): SupervisorTierInfo {
    const rec = this.getOrCreate(agentId);
    const tier = scoreToTier(rec.score);
    return { tier, ...TIER_INFO[tier] };
  }

  recordConfusionOutcome(agentId: string, outcome: ConfusionOutcome): void {
    const rec = this.getOrCreate(agentId);
    const key = outcome.toLowerCase() as "tp" | "tn" | "fp" | "fn";
    rec.confusionMatrix[key] += 1;
    this.records.set(agentId, rec);
  }

  recordCalibrationAttempt(agentId: string, success: boolean): void {
    const rec = this.getOrCreate(agentId);
    rec.calibrationAttempts += 1;
    if (success) rec.calibrationSuccesses += 1;
    this.records.set(agentId, rec);
  }

  get(agentId: string): TrustRecord | undefined {
    return this.records.get(agentId);
  }

  list(): TrustRecord[] {
    return Array.from(this.records.values());
  }

  meetsThreshold(agentId: string, threshold = 20): boolean {
    const rec = this.records.get(agentId);
    return rec ? rec.score >= threshold : true; // new agents pass by default
  }
}
