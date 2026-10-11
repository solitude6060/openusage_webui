import {
  boundedCycles,
  chooseWindows,
  meterPoints,
  type AllowanceObservation,
  type AllowanceTokenRow,
} from "./allowance-estimate";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_LIMIT = 4;
const CYCLE_MIN_PERCENT = 10;
const EDGE_UNCERTAIN_RATIO = 1.25;

export type AllowanceCycleExclusion =
  | "meter-fell"
  | "shared-log"
  | "history-truncated"
  | "no-tokens"
  | "below-min-percent"
  | "edge-uncertain"
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
  meterFell: boolean;
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

export interface AllowanceCycleHistory {
  observationStartMs: number;
  tokenStartMs: number;
}

export function buildAllowanceCycleSummaries(
  observations: AllowanceObservation[],
  tokenRows: AllowanceTokenRow[],
  sharedProviderIds: ReadonlySet<string>,
  now: Date,
  history?: AllowanceCycleHistory,
): AllowanceCycleSummary[] {
  const nowMs = now.getTime();
  const summaries: AllowanceCycleSummary[] = [];
  for (const window of chooseWindows(observations)) {
    const points = meterPoints(observations, window).filter((point) => point.at <= nowMs);
    const rows = tokenRows.filter((row) => row.providerId === window.providerId && row.tokens > 0);
    const bounded = boundedCycles(points);
    const cycles = bounded
      .filter((cycle) => cycle.end <= nowMs)
      .map((cycle) => measureCycle(cycle, rows, sharedProviderIds.has(window.providerId), history))
      .sort((left, right) => right.end.localeCompare(left.end));
    const open = bounded
      .filter((cycle) => cycle.start <= nowMs && nowMs < cycle.end)
      .sort((left, right) => right.start - left.start)[0] ?? null;
    const baseline = baselineFrom(cycles);
    const summary = {
      providerId: window.providerId,
      windowKey: window.windowKey,
      windowLabel: window.windowLabel,
      baseline,
      current: open ? currentCycle(open, rows, nowMs, baseline, bounded.filter((cycle) => cycle.end <= nowMs)) : null,
      cycles,
    };
    if (usableSummary(summary, points)) summaries.push(summary);
  }
  return summaries.sort((left, right) => left.providerId.localeCompare(right.providerId));
}

interface BoundedCycle {
  points: Array<{ at: number; usedPercent: number; resetsAt: string }>;
  start: number;
  end: number;
}

interface UsageSide {
  tokens: number;
  cost: number | null;
  rows: number;
}

function measureCycle(
  cycle: BoundedCycle,
  rows: AllowanceTokenRow[],
  shared: boolean,
  history: AllowanceCycleHistory | undefined,
): AllowanceCompletedCycle {
  const readings = cycle.points
    .filter((point) => point.at >= cycle.start && point.at < cycle.end)
    .sort((left, right) => left.at - right.at);
  const endPercent = readings.reduce((max, point) => Math.max(max, point.usedPercent), 0);
  const meterFell = readings.some((point, index) =>
    index > 0 && point.usedPercent < readings[index - 1]!.usedPercent);
  const latest = readings.at(-1)?.at;
  const observationGap = latest == null || cycle.end - latest > DAY_MS;
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
  const truncated = history != null && (
    cycle.start < history.observationStartMs || cycle.start < history.tokenStartMs
  );
  const exclusion = cycleExclusion(meterFell, shared, truncated, tokensLow, tokensHigh, endPercent, observationGap);
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

function usableSummary(
  summary: AllowanceCycleSummary,
  points: Array<{ usedPercent: number }>,
): boolean {
  const included = summary.cycles.some((cycle) => cycle.included);
  if (summary.current == null && !included) return false;
  return !(points.length > 0 && points.every((point) => point.usedPercent === 0));
}

function baselineFrom(cycles: AllowanceCompletedCycle[]): AllowanceCycleSummary["baseline"] {
  const sample = cycles.filter((cycle) => cycle.included).slice(0, BASELINE_LIMIT);
  return {
    tokens: stats(presentNumbers(sample.map((cycle) => cycle.allowanceLow))),
    apiDollars: stats(presentNumbers(sample.map((cycle) => cycle.apiDollarsLow))),
  };
}

function currentCycle(
  cycle: BoundedCycle,
  rows: AllowanceTokenRow[],
  nowMs: number,
  baseline: AllowanceCycleSummary["baseline"],
  completed: BoundedCycle[],
): AllowanceCycleCurrent {
  const readings = cycle.points
    .filter((point) => point.at >= cycle.start && point.at <= nowMs)
    .sort((left, right) => left.at - right.at);
  const usedPercent = readings.at(-1)?.usedPercent ?? null;
  const meterFell = readings.some((point, index) =>
    index > 0 && point.usedPercent < readings[index - 1]!.usedPercent);
  const usage = usageInside(rows, cycle.start, nowMs);
  const lengthMs = cycle.end - cycle.start;
  const elapsedFraction = lengthMs > 0 ? (nowMs - cycle.start) / lengthMs : 0;
  const restarted = completed
    .slice()
    .sort((left, right) => right.end - left.end)
    .slice(0, 4)
    .some(restartedEarly);
  return {
    start: new Date(cycle.start).toISOString(),
    end: new Date(cycle.end).toISOString(),
    lengthMs,
    usedPercent,
    tokens: usage.tokens,
    apiCost: usage.cost,
    elapsedFraction,
    remainingTokens: scaleRemaining(baseline.tokens?.median ?? null, usedPercent),
    remainingApiCost: scaleRemaining(baseline.apiDollars?.median ?? null, usedPercent),
    projectedEndPercent: elapsedFraction > 0 && usedPercent != null ? usedPercent / elapsedFraction : null,
    projectionReliable: nowMs - cycle.start >= DAY_MS && !restarted && !meterFell,
    meterFell,
  };
}

function usageInside(rows: AllowanceTokenRow[], from: number, to: number): { tokens: number; cost: number | null } {
  const side = emptySide();
  for (const row of rows) {
    if (bucketPlace(row, from, to) === "inside") addRow(side, row);
  }
  return { tokens: side.tokens, cost: sideCost(side) };
}

function restartedEarly(cycle: BoundedCycle): boolean {
  const stated = Math.max(...cycle.points.map((point) => Date.parse(point.resetsAt)));
  return Number.isFinite(stated) && stated - cycle.end > HOUR_MS;
}

function scaleRemaining(median: number | null, usedPercent: number | null): number | null {
  if (median == null || usedPercent == null) return null;
  return ((100 - usedPercent) / 100) * median;
}

function presentNumbers(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value != null);
}

function stats(values: number[]): AllowanceCycleStat | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { median, min: sorted[0]!, max: sorted[sorted.length - 1]!, n: sorted.length };
}

function cycleExclusion(
  meterFell: boolean,
  shared: boolean,
  historyTruncated: boolean,
  tokensLow: number,
  tokensHigh: number,
  endPercent: number,
  observationGap: boolean,
): AllowanceCycleExclusion | null {
  if (meterFell) return "meter-fell";
  if (shared) return "shared-log";
  if (historyTruncated) return "history-truncated";
  if (tokensLow <= 0) return "no-tokens";
  if (endPercent < CYCLE_MIN_PERCENT) return "below-min-percent";
  if (tokensHigh > tokensLow * EDGE_UNCERTAIN_RATIO) return "edge-uncertain";
  if (observationGap) return "observation-gap";
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
