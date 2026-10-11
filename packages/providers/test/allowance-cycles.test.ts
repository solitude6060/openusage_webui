import { describe, expect, test } from "bun:test";
import { buildAllowanceCycleSummaries } from "../src/allowance-cycles";
import type { AllowanceObservation, AllowanceTokenRow } from "../src/allowance-estimate";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function observation(
  observedAt: string,
  usedPercent: number,
  resetsAt: string,
  providerId = "grok",
  periodMs = WEEK_MS,
): AllowanceObservation {
  return {
    providerId,
    observedAt,
    windowKey: "weekly",
    windowLabel: "Weekly",
    periodMs,
    resetsAt,
    present: true,
    usedPercent,
    limitValue: null,
    limitUnit: null,
  };
}

function bucket(
  startedAt: string,
  tokens: number,
  options: { costUsd?: number | null; providerId?: string } = {},
): AllowanceTokenRow {
  return {
    providerId: options.providerId ?? "grok",
    model: "model",
    startedAt,
    tokens,
    ...(options.costUsd !== undefined ? { costUsd: options.costUsd } : {}),
    bucketEnd: new Date(Date.parse(startedAt) + DAY_MS).toISOString(),
  };
}

describe("allowance cycle boundaries", () => {
  test("ends a cycle at the next cycle's start when the provider restarts early", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-10-08T00:00:00.000Z", 10, "2026-10-14T00:00:00.000Z"),
        observation("2026-10-10T00:00:00.000Z", 40, "2026-10-14T00:00:00.000Z"),
        observation("2026-10-10T18:00:00.000Z", 5, "2026-10-17T12:00:00.000Z"),
      ],
      [],
      new Set(),
      new Date("2026-10-11T00:00:00.000Z"),
    );

    expect(summaries.flatMap((item) => item.cycles)).toEqual([
      expect.objectContaining({
        start: "2026-10-07T00:00:00.000Z",
        end: "2026-10-10T12:00:00.000Z",
        lengthMs: 3.5 * DAY_MS,
      }),
    ]);
  });
});

describe("allowance cycle exclusion", () => {
  test("excludes a cycle whose meter falls", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-10-02T00:00:00.000Z", 10, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-05T00:00:00.000Z", 40, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-07T12:00:00.000Z", 25, "2026-10-08T00:00:00.000Z"),
      ],
      [],
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    );

    expect(summaries.flatMap((item) => item.cycles)).toEqual([
      expect.objectContaining({ included: false, exclusion: "meter-fell", endPercent: 40 }),
    ]);
  });

  test("counts a daily bucket that crosses either cycle edge in the high total only", () => {
    const summaries = buildAllowanceCycleSummaries(
      [observation("2026-10-07T12:00:00.000Z", 50, "2026-10-08T00:00:00.000Z")],
      [
        bucket("2026-09-20T00:00:00.000Z", 999, { costUsd: 99 }),
        bucket("2026-09-30T12:00:00.000Z", 40, { costUsd: 4 }),
        bucket("2026-10-03T00:00:00.000Z", 100, { costUsd: 10 }),
        bucket("2026-10-07T12:00:00.000Z", 25, { costUsd: 2.5 }),
      ],
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    );

    const cycle = summaries[0]?.cycles[0];
    expect(cycle?.tokensLow).toBeLessThan(cycle?.tokensHigh ?? 0);
    expect(cycle).toEqual(expect.objectContaining({
      tokensLow: 100,
      tokensHigh: 165,
      apiCostLow: 10,
      apiCostHigh: 16.5,
      allowanceLow: 200,
      allowanceHigh: 330,
      apiDollarsLow: 20,
      apiDollarsHigh: 33,
    }));
  });

  test("drops API dollars when any fully inside row has no cost", () => {
    const summaries = buildAllowanceCycleSummaries(
      [observation("2026-10-07T12:00:00.000Z", 50, "2026-10-08T00:00:00.000Z")],
      [
        bucket("2026-10-03T00:00:00.000Z", 60, { costUsd: 1.5 }),
        bucket("2026-10-04T00:00:00.000Z", 40, { costUsd: null }),
      ],
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    );

    expect(summaries[0]?.cycles[0]).toEqual(expect.objectContaining({
      tokensLow: 100,
      apiCostLow: null,
      apiCostHigh: null,
      apiDollarsLow: null,
      apiDollarsHigh: null,
    }));
  });

  test("keeps inside API dollars when only a straddling row has no cost", () => {
    const summaries = buildAllowanceCycleSummaries(
      [observation("2026-10-07T12:00:00.000Z", 50, "2026-10-08T00:00:00.000Z")],
      [
        bucket("2026-10-03T00:00:00.000Z", 100, { costUsd: 2 }),
        bucket("2026-10-07T12:00:00.000Z", 25, { costUsd: null }),
      ],
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    );

    expect(summaries[0]?.cycles[0]).toEqual(expect.objectContaining({
      tokensLow: 100,
      tokensHigh: 125,
      apiCostLow: 2,
      apiDollarsLow: 4,
      apiCostHigh: null,
      apiDollarsHigh: null,
    }));
  });

  test("excludes an end percent below 20 and keeps a cycle that ends at 20", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-09-30T12:00:00.000Z", 20, "2026-10-01T00:00:00.000Z"),
        observation("2026-10-07T12:00:00.000Z", 19, "2026-10-08T00:00:00.000Z"),
      ],
      [
        bucket("2026-09-26T00:00:00.000Z", 100, { costUsd: 1 }),
        bucket("2026-10-03T00:00:00.000Z", 100, { costUsd: 1 }),
      ],
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    );

    const cycles = summaries[0]?.cycles ?? [];
    expect(cycles.find((cycle) => cycle.end === "2026-10-01T00:00:00.000Z")).toEqual(
      expect.objectContaining({ included: true, exclusion: null, endPercent: 20 }),
    );
    expect(cycles.find((cycle) => cycle.end === "2026-10-08T00:00:00.000Z")).toEqual(
      expect.objectContaining({ included: false, exclusion: "below-min-percent", endPercent: 19 }),
    );
  });

  test("excludes a cycle with no tokens fully inside", () => {
    const summaries = buildAllowanceCycleSummaries(
      [observation("2026-10-07T12:00:00.000Z", 50, "2026-10-08T00:00:00.000Z")],
      [bucket("2026-10-07T12:00:00.000Z", 25, { costUsd: 1 })],
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    );

    expect(summaries[0]?.cycles[0]).toEqual(expect.objectContaining({
      tokensLow: 0,
      tokensHigh: 25,
      included: false,
      exclusion: "no-tokens",
    }));
  });

  test("excludes a cycle with no reading in its last day", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-09-30T00:00:00.000Z", 40, "2026-10-01T00:00:00.000Z"),
        observation("2026-10-06T23:59:00.000Z", 40, "2026-10-08T00:00:00.000Z"),
      ],
      [
        bucket("2026-09-26T00:00:00.000Z", 80, { costUsd: 1 }),
        bucket("2026-10-03T00:00:00.000Z", 80, { costUsd: 1 }),
      ],
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    );

    const cycles = summaries[0]?.cycles ?? [];
    expect(cycles.find((cycle) => cycle.end === "2026-10-01T00:00:00.000Z")).toEqual(
      expect.objectContaining({ included: true, exclusion: null }),
    );
    expect(cycles.find((cycle) => cycle.end === "2026-10-08T00:00:00.000Z")).toEqual(
      expect.objectContaining({ included: false, exclusion: "observation-gap" }),
    );
  });
});

describe("allowance current cycle", () => {
  test("keeps the open cycle out of the baseline and projects the end percent", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-09-30T12:00:00.000Z", 50, "2026-10-01T00:00:00.000Z"),
        observation("2026-10-02T00:00:00.000Z", 10, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-04T00:00:00.000Z", 20, "2026-10-08T00:00:00.000Z"),
      ],
      [
        bucket("2026-09-26T00:00:00.000Z", 500, { costUsd: 5 }),
        bucket("2026-09-30T12:00:00.000Z", 50, { costUsd: 1 }),
        bucket("2026-10-02T00:00:00.000Z", 200, { costUsd: 4 }),
        bucket("2026-10-04T00:00:00.000Z", 999, { costUsd: 9 }),
      ],
      new Set(),
      new Date("2026-10-04T12:00:00.000Z"),
    );

    const summary = summaries[0];
    expect(summary?.cycles.map((cycle) => cycle.end)).toEqual(["2026-10-01T00:00:00.000Z"]);
    expect(summary?.baseline.tokens).toEqual({ median: 1000, min: 1000, max: 1000, n: 1 });
    expect(summary?.baseline.apiDollars).toEqual({ median: 10, min: 10, max: 10, n: 1 });
    expect(summary?.current).toEqual({
      start: "2026-10-01T00:00:00.000Z",
      end: "2026-10-08T00:00:00.000Z",
      lengthMs: WEEK_MS,
      usedPercent: 20,
      tokens: 200,
      apiCost: 4,
      elapsedFraction: 0.5,
      remainingTokens: 800,
      remainingApiCost: 8,
      projectedEndPercent: 40,
      projectionReliable: true,
    });
  });

  test("marks the projection unreliable during the first day", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-09-30T12:00:00.000Z", 50, "2026-10-01T00:00:00.000Z"),
        observation("2026-10-01T06:00:00.000Z", 4, "2026-10-08T00:00:00.000Z"),
      ],
      [bucket("2026-09-26T00:00:00.000Z", 500, { costUsd: 5 })],
      new Set(),
      new Date("2026-10-01T12:00:00.000Z"),
    );

    expect(summaries[0]?.current).toEqual(expect.objectContaining({
      usedPercent: 4,
      elapsedFraction: 0.5 / 7,
      projectedEndPercent: 56,
      projectionReliable: false,
    }));
  });

  test("marks the projection unreliable when one of the last four cycles restarted early", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-10-08T00:00:00.000Z", 30, "2026-10-14T00:00:00.000Z"),
        observation("2026-10-10T00:00:00.000Z", 40, "2026-10-14T00:00:00.000Z"),
        observation("2026-10-12T00:00:00.000Z", 15, "2026-10-17T12:00:00.000Z"),
      ],
      [bucket("2026-10-08T00:00:00.000Z", 100, { costUsd: 1 })],
      new Set(),
      new Date("2026-10-14T12:00:00.000Z"),
    );

    const current = summaries[0]?.current;
    expect(current?.projectionReliable).toBe(false);
    expect((current?.elapsedFraction ?? 0) * (current?.lengthMs ?? 0)).toBeGreaterThanOrEqual(DAY_MS);
  });
});
