import { expect, test } from "bun:test";
import { buildAllowanceCycleSummaries } from "../src/allowance-cycles";
import type { AllowanceObservation, AllowanceTokenRow } from "../src/allowance-estimate";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RESET = "2026-10-17T19:00:00.000Z";
const NOW = "2026-10-18T00:00:00.000Z";

function observation(observedAt: string, usedPercent: number): AllowanceObservation {
  return {
    providerId: "codex:codex",
    observedAt,
    windowKey: "weekly",
    windowLabel: "Weekly",
    periodMs: 7 * DAY_MS,
    resetsAt: RESET,
    present: true,
    usedPercent,
    limitValue: null,
    limitUnit: null,
  };
}

// A Codex event hour whose dollars are a share of the day's ccusage cost, not a measured price.
function allocated(startedAt: string, tokens: number, costUsd: number): AllowanceTokenRow {
  return {
    providerId: "codex:codex",
    model: "All Models",
    startedAt,
    tokens,
    costUsd,
    costAllocated: true,
    bucketEnd: new Date(Date.parse(startedAt) + HOUR_MS).toISOString(),
  } as AllowanceTokenRow;
}

test("allocated Codex dollars with a large dollars-per-percent gap mark no regime change or upgrade", () => {
  // Same meter as the upgrade test in allowance-billing.test.ts: a reset at 04:42 inside the cycle.
  const observations = [
    observation("2026-10-10T20:00:00.000Z", 0),
    observation("2026-10-12T00:00:00.000Z", 50),
    observation("2026-10-14T04:22:00.000Z", 96),
    observation("2026-10-14T04:42:00.000Z", 1),
    observation("2026-10-16T00:00:00.000Z", 50),
    observation("2026-10-17T12:00:00.000Z", 95),
  ];
  // $1 per percent before the reset and $2 after: a 100 percent gap.
  const rows = [allocated("2026-10-11T00:00:00.000Z", 9600, 96), allocated("2026-10-15T00:00:00.000Z", 9400, 188)];
  const nowMs = Date.parse(NOW);
  const summary = buildAllowanceCycleSummaries(
    observations,
    rows,
    new Set(),
    new Date(nowMs),
    { observationStartMs: nowMs - 120 * DAY_MS, tokenStartMs: nowMs - 121 * DAY_MS },
  )[0];

  expect(summary?.regimeChanged).toBe(false);
  expect(summary?.billing).toEqual(expect.objectContaining({ anchor: null, anchorSource: "calendar" }));
  // Billing months still count the allocated dollars.
  expect(summary?.billing?.months[0]).toEqual(expect.objectContaining({
    start: "2026-10-01T00:00:00.000Z",
    apiDollars: 284,
    tokens: 19000,
  }));
});
