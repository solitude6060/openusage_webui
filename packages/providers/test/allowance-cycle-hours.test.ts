import { describe, expect, test } from "bun:test";
import { buildAllowanceCycleSummaries } from "../src/allowance-cycles";
import type { AllowanceObservation, AllowanceTokenRow } from "../src/allowance-estimate";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function observation(observedAt: string, usedPercent: number, resetsAt: string): AllowanceObservation {
  return {
    providerId: "grok",
    observedAt,
    windowKey: "weekly",
    windowLabel: "Weekly",
    periodMs: WEEK_MS,
    resetsAt,
    present: true,
    usedPercent,
    limitValue: null,
    limitUnit: null,
  };
}

function hourBucket(startedAt: string, tokens: number, costUsd: number): AllowanceTokenRow {
  return {
    providerId: "grok",
    model: "model",
    startedAt,
    tokens,
    costUsd,
    bucketEnd: new Date(Date.parse(startedAt) + HOUR_MS).toISOString(),
  };
}

describe("allowance cycle hourly buckets", () => {
  test("counts an hour fully inside on the low side and a partial hour on the high side", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-10-07T12:00:00.000Z", 50, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-09T00:00:00.000Z", 12, "2026-10-15T00:00:00.000Z"),
      ],
      [
        hourBucket("2026-10-03T10:00:00.000Z", 100, 2),
        hourBucket("2026-10-07T23:30:00.000Z", 25, 1),
        hourBucket("2026-10-08T02:00:00.000Z", 999, 9),
      ],
      new Set(),
      new Date("2026-10-09T12:00:00.000Z"),
    );

    expect(summaries[0]?.cycles[0]).toEqual(expect.objectContaining({
      tokensLow: 100,
      tokensHigh: 125,
      apiCostLow: 2,
      apiCostHigh: 3,
      allowanceLow: 200,
      allowanceHigh: 250,
      apiDollarsLow: 4,
      apiDollarsHigh: 6,
    }));
  });
});
