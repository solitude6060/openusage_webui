import {
  boundedCycles,
  chooseWindows,
  meterPoints,
  type AllowanceObservation,
  type AllowanceTokenRow,
} from "./allowance-estimate";

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
  _tokenRows: AllowanceTokenRow[],
  _sharedProviderIds: ReadonlySet<string>,
  now: Date,
): AllowanceCycleSummary[] {
  const nowMs = now.getTime();
  const summaries: AllowanceCycleSummary[] = [];
  for (const window of chooseWindows(observations)) {
    const points = meterPoints(observations, window).filter((point) => point.at <= nowMs);
    const cycles = boundedCycles(points)
      .filter((cycle) => cycle.end <= nowMs)
      .map((cycle) => emptyCycle(cycle.start, cycle.end))
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

function emptyCycle(start: number, end: number): AllowanceCompletedCycle {
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    lengthMs: end - start,
    endPercent: 0,
    tokensLow: 0,
    tokensHigh: 0,
    apiCostLow: null,
    apiCostHigh: null,
    allowanceLow: null,
    allowanceHigh: null,
    apiDollarsLow: null,
    apiDollarsHigh: null,
    included: true,
    exclusion: null,
  };
}
