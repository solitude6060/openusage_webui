import { describe, expect, test } from "bun:test";
import { buildAllowanceCycleSummaries } from "../src/allowance-cycles";
import type { AllowanceObservation, AllowanceTokenRow } from "../src/allowance-estimate";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function bucket(startedAt: string, tokens: number): AllowanceTokenRow {
  return {
    providerId: "grok",
    model: "model",
    startedAt,
    tokens,
    costUsd: 1,
    bucketEnd: new Date(Date.parse(startedAt) + DAY_MS).toISOString(),
  };
}

describe("allowance cycle summary omission", () => {
  test("omits a summary with no open cycle and no included cycle", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-10-02T00:00:00.000Z", 40, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-05T00:00:00.000Z", 25, "2026-10-08T00:00:00.000Z"),
      ],
      [bucket("2026-10-03T00:00:00.000Z", 100)],
      new Set(),
      new Date("2026-10-09T00:00:00.000Z"),
    );

    expect(summaries).toEqual([]);
  });

  test("omits a summary when every reading is zero", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-10-07T12:00:00.000Z", 0, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-09T00:00:00.000Z", 0, "2026-10-15T00:00:00.000Z"),
      ],
      [bucket("2026-10-03T00:00:00.000Z", 100)],
      new Set(),
      new Date("2026-10-10T00:00:00.000Z"),
    );

    expect(summaries).toEqual([]);
  });

  test("keeps a summary that has an open cycle when completed cycles are excluded", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("2026-10-02T00:00:00.000Z", 40, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-05T00:00:00.000Z", 25, "2026-10-08T00:00:00.000Z"),
        observation("2026-10-09T00:00:00.000Z", 15, "2026-10-15T00:00:00.000Z"),
      ],
      [bucket("2026-10-03T00:00:00.000Z", 100)],
      new Set(),
      new Date("2026-10-10T00:00:00.000Z"),
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.current?.usedPercent).toBe(15);
    expect(summaries[0]?.cycles[0]?.exclusion).toBe("meter-fell");
  });
});
