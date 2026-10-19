import {
  boundedCycles,
  chooseWindows,
  meterPoints,
  type AllowanceObservation,
  type AllowanceTokenRow,
} from "./allowance-estimate";
import { aliasCodexSevenDaySessions } from "./quota-observations";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_LIMIT = 4;
const CYCLE_MIN_PERCENT = 10;
const EDGE_UNCERTAIN_RATIO = 1.25;
// A meter that falls this many points while its stated reset holds was reset inside the cycle.
const MID_CYCLE_RESET_DROP = 5;
// Dollars per percent on the two sides of a reset differing by more than 30 percent mark a regime change.
const REGIME_SHIFT_RATIO = 1.3;
// A segment that climbs this much but has no tokens inside it cannot be measured.
const SEGMENT_MIN_PERCENT = 5;

export type AllowanceCycleExclusion =
  | "meter-fell"
  | "shared-log"
  | "history-truncated"
  | "no-tokens"
  | "below-min-percent"
  | "edge-uncertain"
  | "observation-gap"
  | "segment-unmeasured";

export interface AllowanceCycleStat {
  median: number;
  min: number;
  max: number;
  n: number;
}

export interface AllowanceCycleSegment {
  start: string;
  end: string;
  startPercent: number;
  endPercent: number;
  tokens: number;
  apiCost: number | null;
  tokensPerPercent: number | null;
  dollarsPerPercent: number | null;
}

export interface AllowanceCompletedCycle {
  start: string;
  end: string;
  lengthMs: number;
  endPercent: number;
  consumedPercent: number;
  segments: AllowanceCycleSegment[];
  tokensPerPercent: number | null;
  dollarsPerPercent: number | null;
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
    dollarsPerPercent: AllowanceCycleStat | null;
  };
  regimeChanged: boolean;
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
  const windows = aliasCodexSevenDaySessions(observations);
  const summaries: AllowanceCycleSummary[] = [];
  for (const window of chooseWindows(windows)) {
    const points = meterPoints(windows, window).filter((point) => point.at <= nowMs);
    const rows = tokenRows.filter((row) => row.providerId === window.providerId && row.tokens > 0);
    const bounded = boundedCycles(points);
    const cycles = bounded
      .filter((cycle) => cycle.end <= nowMs)
      .map((cycle) => measureCycle(cycle, rows, sharedProviderIds.has(window.providerId), history))
      .sort((left, right) => right.end.localeCompare(left.end));
    const open = bounded
      .filter((cycle) => cycle.start <= nowMs && nowMs < cycle.end)
      .sort((left, right) => right.start - left.start)[0] ?? null;
    const { baseline, regimeChanged } = baselineFrom(cycles);
    const summary = {
      providerId: window.providerId,
      windowKey: window.windowKey,
      windowLabel: window.windowLabel,
      baseline,
      regimeChanged,
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

interface Reading {
  at: number;
  usedPercent: number;
  resetsAt: string;
}

interface SegmentSpan {
  from: number;
  to: number;
  startPercent: number;
  endPercent: number;
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
  const runs = splitRuns(readings);
  const meterFell = runs.some((run) => run.some((point, index) =>
    index > 0 && point.usedPercent < run[index - 1]!.usedPercent));
  const spans = segmentSpans(runs, cycle);
  const consumedPercent = spans.reduce((sum, span) => sum + span.endPercent - span.startPercent, 0);
  const latest = readings.at(-1)?.at;
  const observationGap = latest == null || cycle.end - latest > DAY_MS;
  const sides = spans.map(emptySide);
  const inside = emptySide();
  const straddle = emptySide();
  for (const row of rows) {
    const places = spans.map((span) => bucketPlace(row, span.from, span.to));
    const index = places.indexOf("inside");
    if (index >= 0) {
      addRow(sides[index]!, row);
      addRow(inside, row);
    } else if (places.includes("straddle")) {
      // A row that crosses both edges of a mid-cycle reset still counts once.
      addRow(straddle, row);
    }
  }
  const tokensLow = inside.tokens;
  const tokensHigh = inside.tokens + straddle.tokens;
  const apiCostLow = sideCost(inside);
  const apiCostHigh = combinedCost(inside, straddle);
  const truncated = history != null && (
    cycle.start < history.observationStartMs || cycle.start < history.tokenStartMs
  );
  const segments = spans.map((span, index) => ({
    start: new Date(span.from).toISOString(),
    end: new Date(span.to).toISOString(),
    startPercent: span.startPercent,
    endPercent: span.endPercent,
    tokens: sides[index]!.tokens,
    apiCost: sideCost(sides[index]!),
    tokensPerPercent: perPercent(sides[index]!.tokens, span.endPercent - span.startPercent),
    dollarsPerPercent: perPercent(sideCost(sides[index]!), span.endPercent - span.startPercent),
  }));
  // Ratios divide by the climbs of the segments whose numerator is measured; a cycle with none keeps the full sum.
  const measured = measuredTotals(segments);
  const tokenPercent = measured.tokenPercent > 0 ? measured.tokenPercent : consumedPercent;
  const costPercent = measured.cost != null ? measured.costPercent : consumedPercent;
  const exclusion = cycleExclusion({
    meterFell,
    shared,
    historyTruncated: truncated,
    tokensLow,
    tokensHigh,
    consumedPercent,
    segmentUnmeasured: segments.some(climbsWithoutTokens),
    observationGap,
  });
  return {
    start: new Date(cycle.start).toISOString(),
    end: new Date(cycle.end).toISOString(),
    lengthMs: cycle.end - cycle.start,
    endPercent,
    consumedPercent,
    segments,
    tokensPerPercent: perPercent(tokensLow, tokenPercent),
    dollarsPerPercent: perPercent(measured.cost, costPercent),
    tokensLow,
    tokensHigh,
    apiCostLow,
    apiCostHigh,
    allowanceLow: perFullMeter(tokensLow, tokenPercent),
    allowanceHigh: perFullMeter(tokensHigh, tokenPercent),
    apiDollarsLow: perFullMeter(measured.cost, costPercent),
    apiDollarsHigh: perFullMeter(apiCostHigh, costPercent),
    included: exclusion == null,
    exclusion,
  };
}

// A fall of at least 5 points under an unchanged stated reset starts a new run of readings.
function splitRuns(readings: Reading[]): Reading[][] {
  const runs: Reading[][] = [[]];
  readings.forEach((point, index) => {
    const before = readings[index - 1];
    if (before && before.usedPercent - point.usedPercent >= MID_CYCLE_RESET_DROP
      && Math.abs(Date.parse(point.resetsAt) - Date.parse(before.resetsAt)) <= HOUR_MS) {
      runs.push([]);
    }
    runs.at(-1)!.push(point);
  });
  return runs;
}

// The first segment keeps the cycle's assumed 0 percent at its start and the last runs to the cycle's end.
// A later segment starts at its first reading; one without a climb cannot be measured and is left out.
function segmentSpans(runs: Reading[][], cycle: BoundedCycle): SegmentSpan[] {
  return runs
    .map((run, index) => ({
      from: index === 0 ? cycle.start : run[0]!.at,
      to: index === runs.length - 1 ? cycle.end : run.at(-1)!.at,
      startPercent: index === 0 ? 0 : run[0]!.usedPercent,
      endPercent: run.reduce((max, point) => Math.max(max, point.usedPercent), 0),
    }))
    .filter((span, index) => index === 0 || span.endPercent > span.startPercent);
}

function usableSummary(
  summary: AllowanceCycleSummary,
  points: Array<{ usedPercent: number }>,
): boolean {
  const included = summary.cycles.some((cycle) => cycle.included);
  if (summary.current == null && !included) return false;
  if ((summary.current?.tokens ?? 0) > 0) return true;
  return !(points.length > 0 && points.every((point) => point.usedPercent === 0));
}

interface BaselineUnit {
  allowance: number | null;
  dollars: number | null;
  dollarsPerPercent: number | null;
}

function baselineFrom(
  cycles: AllowanceCompletedCycle[],
): { baseline: AllowanceCycleSummary["baseline"]; regimeChanged: boolean } {
  const sample = cycles.filter((cycle) => cycle.included).slice(0, BASELINE_LIMIT);
  const boundary = latestRegimeBoundary(sample);
  const units = (boundary ? sample.slice(0, boundary.cycle + 1) : sample).map((cycle, index) =>
    boundary && index === boundary.cycle
      ? unitFrom(cycle.segments.slice(boundary.segment))
      : { allowance: cycle.allowanceLow, dollars: cycle.apiDollarsLow, dollarsPerPercent: cycle.dollarsPerPercent });
  return {
    baseline: {
      tokens: stats(presentNumbers(units.map((unit) => unit.allowance))),
      apiDollars: stats(presentNumbers(units.map((unit) => unit.dollars))),
      dollarsPerPercent: stats(presentNumbers(units.map((unit) => unit.dollarsPerPercent))),
    },
    regimeChanged: boundary != null,
  };
}

// The newest reset, scanning newest cycle first, whose two sides cost clearly different dollars per percent.
// ponytail: only a reset inside a cycle counts; a rate change exactly at a cycle edge is not detected.
function latestRegimeBoundary(sample: AllowanceCompletedCycle[]): { cycle: number; segment: number } | null {
  for (let cycle = 0; cycle < sample.length; cycle += 1) {
    const { segments } = sample[cycle]!;
    for (let segment = segments.length - 1; segment > 0; segment -= 1) {
      if (regimeShift(segments[segment - 1]!, segments[segment]!)) return { cycle, segment };
    }
  }
  return null;
}

function regimeShift(before: AllowanceCycleSegment, after: AllowanceCycleSegment): boolean {
  const left = before.dollarsPerPercent;
  const right = after.dollarsPerPercent;
  if (left == null || right == null || !(left > 0) || !(right > 0)) return false;
  // Climbs under the 10 percent cycle minimum are too coarse to compare.
  if (climbOf(before) < CYCLE_MIN_PERCENT || climbOf(after) < CYCLE_MIN_PERCENT) return false;
  return Math.max(left, right) / Math.min(left, right) > REGIME_SHIFT_RATIO;
}

// Totals over the segments whose numerator is measured: tokens above zero, and a known API cost.
function measuredTotals(segments: AllowanceCycleSegment[]): {
  tokens: number;
  tokenPercent: number;
  cost: number | null;
  costPercent: number;
} {
  const withTokens = segments.filter((segment) => segment.tokens > 0);
  const withCost = segments.filter((segment) => segment.apiCost != null);
  return {
    tokens: withTokens.reduce((sum, segment) => sum + segment.tokens, 0),
    tokenPercent: withTokens.reduce((sum, segment) => sum + climbOf(segment), 0),
    cost: withCost.length === 0 ? null : withCost.reduce((sum, segment) => sum + (segment.apiCost ?? 0), 0),
    costPercent: withCost.reduce((sum, segment) => sum + climbOf(segment), 0),
  };
}

function unitFrom(segments: AllowanceCycleSegment[]): BaselineUnit {
  const totals = measuredTotals(segments);
  return {
    allowance: perFullMeter(totals.tokens, totals.tokenPercent),
    dollars: perFullMeter(totals.cost, totals.costPercent),
    dollarsPerPercent: perPercent(totals.cost, totals.costPercent),
  };
}

function climbOf(segment: AllowanceCycleSegment): number {
  return segment.endPercent - segment.startPercent;
}

function climbsWithoutTokens(segment: AllowanceCycleSegment): boolean {
  return climbOf(segment) >= SEGMENT_MIN_PERCENT && segment.tokens <= 0;
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

function cycleExclusion(input: {
  meterFell: boolean;
  shared: boolean;
  historyTruncated: boolean;
  tokensLow: number;
  tokensHigh: number;
  consumedPercent: number;
  segmentUnmeasured: boolean;
  observationGap: boolean;
}): AllowanceCycleExclusion | null {
  if (input.meterFell) return "meter-fell";
  if (input.shared) return "shared-log";
  if (input.historyTruncated) return "history-truncated";
  if (input.tokensLow <= 0) return "no-tokens";
  if (input.consumedPercent < CYCLE_MIN_PERCENT) return "below-min-percent";
  if (input.segmentUnmeasured) return "segment-unmeasured";
  if (input.tokensHigh > input.tokensLow * EDGE_UNCERTAIN_RATIO) return "edge-uncertain";
  if (input.observationGap) return "observation-gap";
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

function perFullMeter(amount: number | null, percent: number): number | null {
  if (amount == null || !(percent > 0)) return null;
  return amount / (percent / 100);
}

function perPercent(amount: number | null, percent: number): number | null {
  if (amount == null || !(percent > 0)) return null;
  return amount / percent;
}

function bucketPlace(row: AllowanceTokenRow, cycleStart: number, cycleEnd: number): "inside" | "straddle" | "out" {
  const start = Date.parse(row.startedAt);
  if (!Number.isFinite(start)) return "out";
  if (!row.bucketEnd) return start >= cycleStart && start < cycleEnd ? "inside" : "out";
  const end = Date.parse(row.bucketEnd);
  if (!Number.isFinite(end) || !(start < cycleEnd && end > cycleStart)) return "out";
  return start >= cycleStart && end <= cycleEnd ? "inside" : "straddle";
}
