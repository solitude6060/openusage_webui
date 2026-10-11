import {
  boundedCycles,
  chooseWindows,
  meterPoints,
  type AllowanceObservation,
  type AllowanceTokenRow,
} from "./allowance-estimate";
import { IMPLIED_MIN_PERCENT } from "./quota-view";

export type AllowanceCycleExclusion =
  | "meter-fell"
  | "shared-log"
  | "no-tokens"
  | "below-min-percent"
  | "observation-gap";

export interface AllowanceCycleStat {
  median: number;
  min: number;
  max: number;
  n: number;
}

export interface AllowanceCompletedCycle {
  start: string;
  end: string;
  lengthMs: number;
  endPercent: number;
  tokensLow: number;
  tokensHigh: number;
  apiCostLow: number | null;
  apiCostHigh: number | null;
  allowanceLow: number | null;
  allowanceHigh: number | null;
  apiDollarsLow: number | null;
  apiDollarsHigh: number | null;
  included: boolean;
  exclusion: AllowanceCycleExclusion | null;
}

export interface AllowanceCycleCurrent {
  start: string;
  end: string;
  lengthMs: number;
  usedPercent: number | null;
  tokens: number;
  apiCost: number | null;
  elapsedFraction: number;
  remainingTokens: number | null;
  remainingApiCost: number | null;
  projectedEndPercent: number | null;
  projectionReliable: boolean;
}

export interface AllowanceCycleSummary {
  providerId: string;
  windowKey: string;
  windowLabel: string;
  baseline: {
    tokens: AllowanceCycleStat | null;
    apiDollars: AllowanceCycleStat | null;
  };
  current: AllowanceCycleCurrent | null;
  cycles: AllowanceCompletedCycle[];
}

export function buildAllowanceCycleSummaries(
  observations: AllowanceObservation[],
  tokenRows: AllowanceTokenRow[],
  _sharedProviderIds: ReadonlySet<string>,
  now: Date,
): AllowanceCycleSummary[] {
  const nowMs = now.getTime();
  const summaries: AllowanceCycleSummary[] = [];
  for (const window of chooseWindows(observations)) {
    const points = meterPoints(observations, window).filter((point) => point.at <= nowMs);
    const rows = tokenRows.filter((row) => row.providerId === window.providerId && row.tokens > 0);
    const cycles = boundedCycles(points)
      .filter((cycle) => cycle.end <= nowMs)
      .map((cycle) => measureCycle(cycle, rows))
      .sort((left, right) => right.end.localeCompare(left.end));
    summaries.push({
      providerId: window.providerId,
      windowKey: window.windowKey,
      windowLabel: window.windowLabel,
      baseline: { tokens: null, apiDollars: null },
      current: null,
      cycles,
    });
  }
  return summaries.sort((left, right) => left.providerId.localeCompare(right.providerId));
}

interface BoundedCycle {
  points: Array<{ at: number; usedPercent: number }>;
  start: number;
  end: number;
}

interface UsageSide {
  tokens: number;
  cost: number | null;
  rows: number;
}

function measureCycle(cycle: BoundedCycle, rows: AllowanceTokenRow[]): AllowanceCompletedCycle {
  const readings = cycle.points
    .filter((point) => point.at >= cycle.start && point.at < cycle.end)
    .sort((left, right) => left.at - right.at);
  const endPercent = readings.reduce((max, point) => Math.max(max, point.usedPercent), 0);
  const meterFell = readings.some((point, index) =>
    index > 0 && point.usedPercent < readings[index - 1]!.usedPercent);
  const inside = emptySide();
  const straddle = emptySide();
  for (const row of rows) {
    const place = bucketPlace(row, cycle.start, cycle.end);
    if (place === "inside") addRow(inside, row);
    else if (place === "straddle") addRow(straddle, row);
  }
  const tokensLow = inside.tokens;
  const tokensHigh = inside.tokens + straddle.tokens;
  const apiCostLow = sideCost(inside);
  const apiCostHigh = combinedCost(inside, straddle);
  const exclusion = cycleExclusion(meterFell, tokensLow, endPercent);
  return {
    start: new Date(cycle.start).toISOString(),
    end: new Date(cycle.end).toISOString(),
    lengthMs: cycle.end - cycle.start,
    endPercent,
    tokensLow,
    tokensHigh,
    apiCostLow,
    apiCostHigh,
    allowanceLow: perFullMeter(tokensLow, endPercent),
    allowanceHigh: perFullMeter(tokensHigh, endPercent),
    apiDollarsLow: perFullMeter(apiCostLow, endPercent),
    apiDollarsHigh: perFullMeter(apiCostHigh, endPercent),
    included: exclusion == null,
    exclusion,
  };
}

function cycleExclusion(meterFell: boolean, tokensLow: number, endPercent: number): AllowanceCycleExclusion | null {
  if (meterFell) return "meter-fell";
  if (tokensLow <= 0) return "no-tokens";
  if (endPercent < IMPLIED_MIN_PERCENT) return "below-min-percent";
  return null;
}

function emptySide(): UsageSide {
  return { tokens: 0, cost: 0, rows: 0 };
}

function addRow(side: UsageSide, row: AllowanceTokenRow): void {
  side.tokens += row.tokens;
  side.rows += 1;
  if (side.cost == null) return;
  if (row.costUsd == null || !Number.isFinite(row.costUsd) || row.costUsd < 0) {
    side.cost = null;
    return;
  }
  side.cost += row.costUsd;
}

function sideCost(side: UsageSide): number | null {
  return side.rows === 0 ? null : side.cost;
}

function combinedCost(low: UsageSide, extra: UsageSide): number | null {
  if ((low.rows > 0 && low.cost == null) || (extra.rows > 0 && extra.cost == null)) return null;
  if (low.rows === 0 && extra.rows === 0) return null;
  return (low.rows === 0 ? 0 : low.cost ?? 0) + (extra.rows === 0 ? 0 : extra.cost ?? 0);
}

function perFullMeter(amount: number | null, endPercent: number): number | null {
  if (amount == null || !(endPercent > 0)) return null;
  return amount / (endPercent / 100);
}

function bucketPlace(row: AllowanceTokenRow, cycleStart: number, cycleEnd: number): "inside" | "straddle" | "out" {
  const start = Date.parse(row.startedAt);
  if (!Number.isFinite(start)) return "out";
  if (!row.bucketEnd) return start >= cycleStart && start < cycleEnd ? "inside" : "out";
  const end = Date.parse(row.bucketEnd);
  if (!Number.isFinite(end) || !(start < cycleEnd && end > cycleStart)) return "out";
  return start >= cycleStart && end <= cycleEnd ? "inside" : "straddle";
}
