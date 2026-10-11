import { describe, expect, test } from "bun:test";
import { buildAllowanceCycleSummaries } from "../src/allowance-cycles";
import type { AllowanceObservation, AllowanceTokenRow } from "../src/allowance-estimate";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function observation(
  windowKey: string,
  windowLabel: string,
  observedAt: string,
  usedPercent: number,
  resetsAt: string,
  periodMs: number,
): AllowanceObservation {
  return {
    providerId: "codex:example",
    observedAt,
    windowKey,
    windowLabel,
    periodMs,
    resetsAt,
    present: true,
    usedPercent,
    limitValue: null,
    limitUnit: null,
  };
}

function bucket(startedAt: string, tokens: number): AllowanceTokenRow {
  return {
    providerId: "codex:example",
    model: "model",
    startedAt,
    tokens,
    costUsd: 1,
    bucketEnd: new Date(Date.parse(startedAt) + DAY_MS).toISOString(),
  };
}

describe("allowance cycle Codex window alias", () => {
  test("joins a legacy 7-day Session with newer Weekly readings into one continuous series", () => {
    const summaries = buildAllowanceCycleSummaries(
      [
        observation("session", "Session", "2026-10-07T18:00:00.000Z", 40, "2026-10-08T00:00:00.000Z", WEEK_MS),
        observation("weekly", "Weekly", "2026-10-14T18:00:00.000Z", 55, "2026-10-15T00:00:00.000Z", WEEK_MS),
        observation("session", "Session", "2026-10-14T12:00:00.000Z", 80, "2026-10-14T17:00:00.000Z", 5 * HOUR_MS),
      ],
      [
        bucket("2026-10-04T00:00:00.000Z", 100),
        bucket("2026-10-11T00:00:00.000Z", 80),
      ],
      new Set(),
      new Date("2026-10-16T00:00:00.000Z"),
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual(expect.objectContaining({
      providerId: "codex:example",
      windowKey: "weekly",
      windowLabel: "Weekly",
    }));
    expect(summaries[0]?.cycles.map((cycle) => ({
      start: cycle.start,
      end: cycle.end,
      included: cycle.included,
    }))).toEqual([
      {
        start: "2026-10-08T00:00:00.000Z",
        end: "2026-10-15T00:00:00.000Z",
        included: true,
      },
      {
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-10-08T00:00:00.000Z",
        included: true,
      },
    ]);
  });
});
