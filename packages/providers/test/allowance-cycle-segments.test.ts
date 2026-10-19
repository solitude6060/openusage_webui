import { describe, expect, test } from "bun:test";
import { buildAllowanceCycleSummaries } from "../src/allowance-cycles";
import type { AllowanceObservation, AllowanceTokenRow } from "../src/allowance-estimate";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const RESET = "2026-10-17T19:00:00.000Z";
const NOW = new Date("2026-10-18T00:00:00.000Z");

function observation(observedAt: string, usedPercent: number, resetsAt: string): AllowanceObservation {
  return {
    providerId: "claude",
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

function hour(startedAt: string, tokens: number, costUsd: number | null): AllowanceTokenRow {
  return {
    providerId: "claude",
    model: "model",
    startedAt,
    tokens,
    costUsd,
    bucketEnd: new Date(Date.parse(startedAt) + HOUR_MS).toISOString(),
  };
}

// The 2026-10-14 shape: 0 -> 96 percent, then 1 percent twenty minutes later under the same resets_at, then 95.
function midCycleReset(): AllowanceObservation[] {
  return [
    observation("2026-10-10T20:00:00.000Z", 0, RESET),
    observation("2026-10-12T00:00:00.000Z", 50, RESET),
    observation("2026-10-14T04:22:00.000Z", 96, RESET),
    observation("2026-10-14T04:42:00.000Z", 1, RESET),
    observation("2026-10-16T00:00:00.000Z", 50, RESET),
    observation("2026-10-17T12:00:00.000Z", 95, RESET),
  ];
}

// 100 tokens per percent on both sides; dollars per percent are 1 before the reset and afterAmount / 94 after it.
function midCycleRows(afterAmount: number): AllowanceTokenRow[] {
  return [
    hour("2026-10-11T00:00:00.000Z", 9600, 96),
    hour("2026-10-14T04:00:00.000Z", 50, 5),
    hour("2026-10-15T00:00:00.000Z", 9400, afterAmount),
  ];
}

// An older ordinary cycle: 90 percent, 5000 tokens per 100 percent, 100 dollars per 100 percent.
const OLDER_RESET = "2026-10-10T19:00:00.000Z";
function olderCycle(): { observations: AllowanceObservation[]; rows: AllowanceTokenRow[] } {
  return {
    observations: [
      observation("2026-10-05T00:00:00.000Z", 50, OLDER_RESET),
      observation("2026-10-10T12:00:00.000Z", 90, OLDER_RESET),
    ],
    rows: [hour("2026-10-06T00:00:00.000Z", 4500, 90)],
  };
}

describe("allowance cycle segments", () => {
  test("splits a mid-cycle reset into segments that are measured alone and adds their climbs", () => {
    const summary = buildAllowanceCycleSummaries(midCycleReset(), midCycleRows(188), new Set(), NOW)[0];
    const cycle = summary?.cycles[0];

    expect(cycle).toEqual(expect.objectContaining({
      included: true,
      exclusion: null,
      endPercent: 96,
      consumedPercent: 190,
      tokensLow: 19000,
      tokensHigh: 19050,
      apiCostLow: 284,
      apiCostHigh: 289,
      tokensPerPercent: 100,
    }));
    expect(cycle?.allowanceLow).toBeCloseTo(10_000, 6);
    expect(cycle?.apiDollarsLow).toBeCloseTo(284 / 1.9, 6);
    expect(cycle?.dollarsPerPercent).toBeCloseTo(284 / 190, 9);
    expect(cycle?.segments).toEqual([
      {
        start: "2026-10-10T19:00:00.000Z",
        end: "2026-10-14T04:42:00.000Z",
        startPercent: 0,
        endPercent: 96,
        tokens: 9600,
        apiCost: 96,
        tokensPerPercent: 100,
        dollarsPerPercent: 1,
      },
      {
        start: "2026-10-14T04:42:00.000Z",
        end: RESET,
        startPercent: 1,
        endPercent: 95,
        tokens: 9400,
        apiCost: 188,
        tokensPerPercent: 100,
        dollarsPerPercent: 2,
      },
    ]);
  });

  test("a cycle without a reset is one segment that starts at zero", () => {
    const summary = buildAllowanceCycleSummaries(
      [observation("2026-10-17T00:00:00.000Z", 50, RESET)],
      [hour("2026-10-12T00:00:00.000Z", 1000, 10)],
      new Set(),
      NOW,
    )[0];

    expect(summary?.cycles[0]).toEqual(expect.objectContaining({ consumedPercent: 50, tokensPerPercent: 20, dollarsPerPercent: 0.2 }));
    expect(summary?.cycles[0]?.segments).toEqual([
      expect.objectContaining({ startPercent: 0, endPercent: 50, tokens: 1000, apiCost: 10 }),
    ]);
    expect(summary?.regimeChanged).toBe(false);
  });

  test("reports unknown dollars per percent when a fully inside row has no cost", () => {
    const summary = buildAllowanceCycleSummaries(
      [observation("2026-10-17T00:00:00.000Z", 50, RESET)],
      [hour("2026-10-12T00:00:00.000Z", 1000, null)],
      new Set(),
      NOW,
    )[0];

    expect(summary?.cycles[0]).toEqual(expect.objectContaining({ tokensPerPercent: 20, dollarsPerPercent: null }));
    expect(summary?.cycles[0]?.segments[0]).toEqual(expect.objectContaining({ dollarsPerPercent: null }));
    expect(summary?.baseline.dollarsPerPercent).toBeNull();
  });

  test("leaves out a later segment that has only one reading", () => {
    const summary = buildAllowanceCycleSummaries(
      [
        observation("2026-10-12T00:00:00.000Z", 50, RESET),
        observation("2026-10-14T00:00:00.000Z", 90, RESET),
        observation("2026-10-16T20:00:00.000Z", 20, RESET),
      ],
      [
        hour("2026-10-12T00:00:00.000Z", 9000, 90),
        hour("2026-10-16T22:00:00.000Z", 1000, 10),
      ],
      new Set(),
      NOW,
    )[0];

    expect(summary?.cycles[0]).toEqual(expect.objectContaining({
      included: true,
      consumedPercent: 90,
      tokensLow: 9000,
    }));
    expect(summary?.cycles[0]?.segments).toHaveLength(1);
  });
});

describe("allowance cycle segments whose numerator is unmeasured", () => {
  test("excludes a cycle whose 10-point segment has no tokens and divides by the measured segment only", () => {
    // Live shape: 0 -> 10 with no usage records, reset to 0, then 0 -> 29 with 2900 tokens and $267.5.
    const summary = buildAllowanceCycleSummaries(
      [
        observation("2026-10-11T12:00:00.000Z", 10, RESET),
        observation("2026-10-12T00:00:00.000Z", 0, RESET),
        observation("2026-10-17T12:00:00.000Z", 29, RESET),
        observation("2026-10-17T20:00:00.000Z", 1, "2026-10-24T19:00:00.000Z"),
      ],
      [hour("2026-10-14T00:00:00.000Z", 2900, 267.5)],
      new Set(),
      NOW,
    );
    const cycle = summary[0]?.cycles[0];

    expect(cycle).toEqual(expect.objectContaining({
      consumedPercent: 39,
      included: false,
      exclusion: "segment-unmeasured",
      tokensPerPercent: 100,
    }));
    expect(cycle?.dollarsPerPercent).toBeCloseTo(267.5 / 29, 9);
    expect(cycle?.allowanceLow).toBeCloseTo(10_000, 6);
    expect(cycle?.apiDollarsLow).toBeCloseTo(267.5 / 0.29, 6);
    expect(cycle?.segments.map((segment) => segment.tokens)).toEqual([0, 2900]);
  });

  test("ignores a segment with no tokens that climbs less than 5 points", () => {
    const summary = buildAllowanceCycleSummaries(
      [
        observation("2026-10-12T00:00:00.000Z", 50, RESET),
        observation("2026-10-14T00:00:00.000Z", 90, RESET),
        observation("2026-10-15T00:00:00.000Z", 0, RESET),
        observation("2026-10-17T12:00:00.000Z", 3, RESET),
      ],
      [hour("2026-10-12T00:00:00.000Z", 9000, 90)],
      new Set(),
      NOW,
    )[0];

    expect(summary?.cycles[0]).toEqual(expect.objectContaining({
      included: true,
      exclusion: null,
      consumedPercent: 93,
      tokensPerPercent: 100,
      dollarsPerPercent: 1,
    }));
    expect(summary?.cycles[0]?.allowanceLow).toBeCloseTo(10_000, 6);
    expect(summary?.baseline.tokens?.median).toBeCloseTo(10_000, 6);
    expect(summary?.baseline.dollarsPerPercent?.median).toBeCloseTo(1, 9);
  });

  test("divides dollars by the segments whose cost is known and tokens by the segments that have tokens", () => {
    const summary = buildAllowanceCycleSummaries(
      [
        observation("2026-10-12T00:00:00.000Z", 50, RESET),
        observation("2026-10-13T00:00:00.000Z", 0, RESET),
        observation("2026-10-17T12:00:00.000Z", 50, RESET),
      ],
      [
        hour("2026-10-11T00:00:00.000Z", 5000, null),
        hour("2026-10-15T00:00:00.000Z", 5000, 100),
      ],
      new Set(),
      NOW,
    )[0];

    expect(summary?.cycles[0]).toEqual(expect.objectContaining({
      included: true,
      consumedPercent: 100,
      tokensPerPercent: 100,
      dollarsPerPercent: 2,
    }));
    expect(summary?.cycles[0]?.apiDollarsLow).toBeCloseTo(200, 6);
  });
});

describe("allowance cycle falls that are not an in-place reset", () => {
  const nextCycle = observation("2026-10-09T00:00:00.000Z", 12, "2026-10-15T00:00:00.000Z");
  const rows = [hour("2026-10-03T00:00:00.000Z", 100, 1)];

  test("keeps meter-fell for a fall of less than 5 points", () => {
    const summary = buildAllowanceCycleSummaries(
      [
        observation("2026-10-05T00:00:00.000Z", 40, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-07T12:00:00.000Z", 37, "2026-10-08T00:00:00.000Z"),
        nextCycle,
      ],
      rows,
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    )[0];

    expect(summary?.cycles[0]).toEqual(expect.objectContaining({ included: false, exclusion: "meter-fell", endPercent: 40 }));
  });

  test("keeps meter-fell when the stated reset moves by more than one hour with the fall", () => {
    const summary = buildAllowanceCycleSummaries(
      [
        observation("2026-10-05T00:00:00.000Z", 40, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-07T12:00:00.000Z", 25, "2026-10-08T02:00:00.000Z"),
        nextCycle,
      ],
      rows,
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    )[0];

    expect(summary?.cycles[0]).toEqual(expect.objectContaining({ included: false, exclusion: "meter-fell" }));
  });

  test("splits a fall of exactly 5 points when the stated reset moves by exactly one hour", () => {
    const summary = buildAllowanceCycleSummaries(
      [
        observation("2026-10-04T00:00:00.000Z", 20, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-05T00:00:00.000Z", 40, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-06T00:00:00.000Z", 35, "2026-10-08T01:00:00.000Z"),
        observation("2026-10-07T12:00:00.000Z", 60, "2026-10-08T01:00:00.000Z"),
        nextCycle,
      ],
      [...rows, hour("2026-10-07T00:00:00.000Z", 100, 1)],
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    )[0];

    expect(summary?.cycles[0]).toEqual(expect.objectContaining({ exclusion: null, consumedPercent: 65 }));
  });
});

describe("allowance baseline regime", () => {
  test("pools only the segment after a reset when dollars per percent differ by more than 30 percent", () => {
    const older = olderCycle();
    const summary = buildAllowanceCycleSummaries(
      [...older.observations, ...midCycleReset()],
      [...older.rows, ...midCycleRows(188)],
      new Set(),
      NOW,
    )[0];

    expect(summary?.cycles.map((cycle) => cycle.included)).toEqual([true, true]);
    expect(summary?.regimeChanged).toBe(true);
    expect(summary?.baseline.tokens?.n).toBe(1);
    expect(summary?.baseline.tokens?.median).toBeCloseTo(10_000, 6);
    expect(summary?.baseline.apiDollars?.median).toBeCloseTo(200, 6);
    expect(summary?.baseline.dollarsPerPercent?.n).toBe(1);
    expect(summary?.baseline.dollarsPerPercent?.median).toBeCloseTo(2, 9);
  });

  test("pools every included cycle when dollars per percent differ by at most 30 percent", () => {
    const older = olderCycle();
    const summary = buildAllowanceCycleSummaries(
      [...older.observations, ...midCycleReset()],
      [...older.rows, ...midCycleRows(94 * 1.25)],
      new Set(),
      NOW,
    )[0];

    expect(summary?.regimeChanged).toBe(false);
    expect(summary?.baseline.tokens?.n).toBe(2);
    expect(summary?.baseline.tokens?.median).toBeCloseTo(7500, 6);
    expect(summary?.baseline.dollarsPerPercent?.n).toBe(2);
  });

  test("does not call a reset a regime change when a side climbs less than 10 points", () => {
    const summary = buildAllowanceCycleSummaries(
      [
        observation("2026-10-10T20:00:00.000Z", 0, RESET),
        observation("2026-10-14T04:22:00.000Z", 96, RESET),
        observation("2026-10-14T04:42:00.000Z", 1, RESET),
        observation("2026-10-17T12:00:00.000Z", 5, RESET),
      ],
      [
        hour("2026-10-11T00:00:00.000Z", 9600, 96),
        hour("2026-10-15T00:00:00.000Z", 400, 40),
      ],
      new Set(),
      NOW,
    )[0];

    expect(summary?.cycles[0]).toEqual(expect.objectContaining({ included: true, consumedPercent: 100 }));
    expect(summary?.regimeChanged).toBe(false);
    expect(summary?.baseline.tokens?.n).toBe(1);
  });

  test("does not call a reset a regime change when a side has unknown dollars", () => {
    const summary = buildAllowanceCycleSummaries(midCycleReset(), midCycleRows(188).map((row, index) => (
      index === 2 ? { ...row, costUsd: null } : row
    )), new Set(), NOW)[0];

    expect(summary?.regimeChanged).toBe(false);
  });
});

describe("allowance cycle segment review fixes", () => {
  test("counts an hour that lies wholly between a reset's readings in the earlier segment once", () => {
    const observations = midCycleReset().map((point) =>
      point.observedAt === "2026-10-14T04:42:00.000Z" ? { ...point, observedAt: "2026-10-14T08:00:00.000Z" } : point);
    const rows = [...midCycleRows(188), hour("2026-10-14T06:00:00.000Z", 500, 10)];
    const cycle = buildAllowanceCycleSummaries(observations, rows, new Set(), NOW)[0]?.cycles[0];

    expect(cycle?.segments[0]?.end).toBe("2026-10-14T08:00:00.000Z");
    expect(cycle?.segments[0]?.tokens).toBe(10_150);
    expect(cycle?.tokensHigh).toBe(19_550);
  });

  test("keeps the regime change when the cycle that shows it is excluded", () => {
    const { observations: older, rows: olderRows } = olderCycle();
    // A one-point fall after the reset excludes the regime cycle as meter-fell.
    const observations = [
      ...older,
      ...midCycleReset(),
      observation("2026-10-16T12:00:00.000Z", 49, RESET),
    ];
    const summary = buildAllowanceCycleSummaries(observations, [...olderRows, ...midCycleRows(188)], new Set(), NOW)[0];

    expect(summary?.cycles[0]?.exclusion).toBe("meter-fell");
    expect(summary?.regimeChanged).toBe(true);
    expect(summary?.baseline.dollarsPerPercent).toBeNull();
  });
});

