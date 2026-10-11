import type { AllowanceObservation, AllowanceTokenRow } from "./allowance-estimate";

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
  _observations: AllowanceObservation[],
  _tokenRows: AllowanceTokenRow[],
  _sharedProviderIds: ReadonlySet<string>,
  _now: Date,
): AllowanceCycleSummary[] {
  return [];
}
