import { expect, test } from "bun:test";
import { buildAllowanceCycleSummaries } from "../src/allowance-cycles";
import type { AllowanceObservation, AllowanceTokenRow } from "../src/allowance-estimate";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function observation(observedAt: string, resetsAt: string): AllowanceObservation {
  return {
    providerId: "codex:family",
    observedAt,
    windowKey: "weekly",
    windowLabel: "Weekly",
    periodMs: 7 * DAY_MS,
    resetsAt,
    present: true,
    usedPercent: 0,
    limitValue: null,
    limitUnit: null,
  };
}

test("an account whose meter reads 0% everywhere is kept when its current billing month has tokens", () => {
  const observations = [
    observation("2026-10-07T01:00:00.000Z", "2026-10-14T00:00:00.000Z"),
    observation("2026-10-13T00:00:00.000Z", "2026-10-14T00:00:00.000Z"),
    observation("2026-10-14T01:00:00.000Z", "2026-10-21T00:00:00.000Z"),
    observation("2026-10-19T00:00:00.000Z", "2026-10-21T00:00:00.000Z"),
  ];
  // Usage earlier this month, inside a completed cycle; the open cycle has none.
  const rows: AllowanceTokenRow[] = [{
    providerId: "codex:family",
    model: "All Models",
    startedAt: "2026-10-08T10:00:00.000Z",
    bucketEnd: "2026-10-08T11:00:00.000Z",
    tokens: 500,
    costUsd: 2,
  }];
  const nowMs = Date.parse("2026-10-20T00:00:00.000Z");
  const summaries = buildAllowanceCycleSummaries(
    observations,
    rows,
    new Set(),
    new Date(nowMs),
    { observationStartMs: nowMs - 120 * DAY_MS, tokenStartMs: nowMs - 121 * DAY_MS },
  );

  const summary = summaries.find((item) => item.providerId === "codex:family");
  expect(summary?.current?.tokens ?? 0).toBe(0);
  expect(summary?.billing?.months.find((month) => month.current)).toEqual(expect.objectContaining({
    start: "2026-10-01T00:00:00.000Z",
    tokens: 500,
    apiDollars: 2,
  }));
});
