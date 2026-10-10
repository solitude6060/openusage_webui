import { describe, expect, test } from "bun:test";
import { buildAllowanceEstimates, type AllowanceObservation, type AllowanceTokenRow } from "../src/allowance-estimate";

const DAY = 86400000;
const now = new Date("2026-10-02T20:00:00.000Z");
const resetsAt = "2026-10-06T00:00:00.000Z";

function point(at: string, percent: number): AllowanceObservation {
  return {
    providerId: "grok",
    observedAt: at,
    usedPercent: percent,
    windowKey: "weekly",
    windowLabel: "Weekly",
    periodMs: 7 * DAY,
    resetsAt,
    present: true,
    limitValue: null,
    limitUnit: null,
  };
}

function bucket(start: string, tokens: number, costUsd: number): AllowanceTokenRow {
  return {
    providerId: "grok",
    model: "grok",
    startedAt: start,
    bucketEnd: new Date(Date.parse(start) + DAY).toISOString(),
    tokens,
    costUsd,
  };
}

const buckets = [
  bucket("2026-09-29T00:00:00.000Z", 1000, 9),
  bucket("2026-09-30T00:00:00.000Z", 100, 1),
  bucket("2026-10-01T00:00:00.000Z", 200, 2),
  bucket("2026-10-02T00:00:00.000Z", 4000, 8),
];

function estimate(points: AllowanceObservation[]) {
  return buildAllowanceEstimates(points, buckets, new Set(), 7, now)[0];
}

describe("allowance boundary alignment", () => {
  test("aligns to day boundaries when equal readings sit on both sides", () => {
    const result = estimate([
      point("2026-09-29T12:00:00.000Z", 10),
      point("2026-09-30T06:00:00.000Z", 10),
      point("2026-10-01T12:00:00.000Z", 25),
      point("2026-10-01T21:00:00.000Z", 40),
      point("2026-10-02T08:00:00.000Z", 40),
      point("2026-10-02T15:00:00.000Z", 55),
    ]);

    expect(result).toMatchObject({
      reason: "ok",
      from: "2026-09-30T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
      percentStart: 10,
      percentEnd: 40,
      tokens: 300,
      apiCost: 3,
      estimatedAllowance: 1000,
      estimatedApiCost: 10,
      coarse: false,
    });
  });

  test("stays unaligned when readings differ on both sides of every boundary", () => {
    const result = estimate([
      point("2026-09-29T12:00:00.000Z", 10),
      point("2026-09-30T06:00:00.000Z", 14),
      point("2026-10-01T12:00:00.000Z", 25),
      point("2026-10-01T21:00:00.000Z", 33),
      point("2026-10-02T08:00:00.000Z", 41),
      point("2026-10-02T15:00:00.000Z", 55),
    ]);

    expect(result).toMatchObject({
      reason: "unaligned",
      from: "2026-09-29T12:00:00.000Z",
      to: "2026-10-02T15:00:00.000Z",
      percentStart: 10,
      percentEnd: 55,
      estimatedAllowance: null,
      estimatedApiCost: null,
    });
  });

  test("still reports a meter fall that happens outside the aligned span", () => {
    const result = estimate([
      point("2026-09-29T08:00:00.000Z", 20),
      point("2026-09-29T10:00:00.000Z", 5),
      point("2026-09-29T12:00:00.000Z", 10),
      point("2026-09-30T06:00:00.000Z", 10),
      point("2026-10-01T21:00:00.000Z", 40),
      point("2026-10-02T08:00:00.000Z", 40),
      point("2026-10-02T15:00:00.000Z", 55),
    ]);

    expect(result).toMatchObject({
      reason: "meter-fell",
      estimatedAllowance: null,
      estimatedApiCost: null,
    });
  });
});
