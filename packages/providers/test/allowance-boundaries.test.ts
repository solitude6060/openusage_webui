import { describe, expect, test } from "bun:test";
import { buildAllowanceEstimates, type AllowanceObservation, type AllowanceTokenRow } from "../src/allowance-estimate";

const DAY = 86400000;
const now = new Date("2026-09-30T12:00:00Z");
function point(at: string, percent: number, extra: Partial<AllowanceObservation> = {}): AllowanceObservation {
  return { providerId: "grok", observedAt: at, usedPercent: percent, windowKey: "weekly", windowLabel: "Weekly", periodMs: 7 * DAY, resetsAt: "2026-10-04T00:00:00Z", present: true, limitValue: null, limitUnit: null, ...extra };
}
function token(at: string, extra: Partial<AllowanceTokenRow> = {}): AllowanceTokenRow {
  return { providerId: "grok", model: "grok", startedAt: at, tokens: 100, costUsd: 1, ...extra };
}
function estimate(points: AllowanceObservation[], rows: AllowanceTokenRow[]) {
  return buildAllowanceEstimates(points, rows, new Set(), 1, now)[0];
}

describe("allowance measurement boundaries", () => {
  test("uses a common observation start instead of a percent baseline before the range", () => {
    const result = estimate([
      point("2026-09-29T10:00:00Z", 10),
      point("2026-09-29T13:00:00Z", 20),
      point("2026-09-30T10:00:00Z", 30),
    ], [token("2026-09-29T11:00:00Z"), token("2026-09-29T14:00:00Z")]);
    expect(result).toMatchObject({ from: "2026-09-29T13:00:00.000Z", percentStart: 20, percentEnd: 30, tokens: 100, estimatedAllowance: 1000, apiCost: 1, estimatedApiCost: 10 });
  });

  test("withholds conversion when a daily bucket extends after the final observation", () => {
    const result = estimate([
      point("2026-09-29T12:00:00Z", 10), point("2026-09-30T12:00:00Z", 20),
    ], [token("2026-09-30T00:00:00Z", { bucketEnd: "2026-10-01T00:00:00Z", tokens: 1000 })]);
    expect(result).toMatchObject({ reason: "unaligned", estimatedAllowance: null, estimatedApiCost: null, tokens: 0 });
  });

  test("does not assign a daily bucket crossing a reset to either cycle", () => {
    const points = [
      point("2026-09-29T12:00:00Z", 10, { resetsAt: "2026-09-30T06:00:00Z" }),
      point("2026-09-30T05:00:00Z", 30, { resetsAt: "2026-09-30T06:00:00Z" }),
      point("2026-09-30T06:00:00Z", 0, { resetsAt: "2026-10-07T06:00:00Z" }),
      point("2026-09-30T12:00:00Z", 20, { resetsAt: "2026-10-07T06:00:00Z" }),
    ];
    const results = buildAllowanceEstimates(points, [token("2026-09-30T00:00:00Z", { bucketEnd: "2026-10-01T00:00:00Z" })], new Set(), 1, now);
    expect(results).toHaveLength(2);
    for (const result of results) expect(result).toMatchObject({ reason: "unaligned", tokens: 0, estimatedAllowance: null });
  });

  test("accepts a fully measured UTC daily bucket", () => {
    const result = estimate([point("2026-09-29T12:00:00Z", 10), point("2026-09-30T12:00:00Z", 20)], [token("2026-09-29T13:00:00Z", { bucketEnd: "2026-09-30T11:00:00Z" })]);
    expect(result).toMatchObject({ reason: "ok", tokens: 100, estimatedAllowance: 1000 });
  });

  test("rejects an intermediate meter fall even if it recovers above the start", () => {
    const result = estimate([
      point("2026-09-29T12:00:00Z", 10), point("2026-09-29T16:00:00Z", 40),
      point("2026-09-30T00:00:00Z", 0), point("2026-09-30T12:00:00Z", 30),
    ], [token("2026-09-29T15:00:00Z")]);
    expect(result).toMatchObject({ reason: "meter-fell", estimatedAllowance: null, estimatedApiCost: null });
  });

  test("does not inherit a long session's period in a later five-hour cycle", () => {
    const session = { providerId: "codex:codex", windowKey: "session", windowLabel: "Session", periodMs: 5 * 3600000 };
    const results = buildAllowanceEstimates([
      point("2026-09-25T10:00:00Z", 10, { ...session, resetsAt: "2026-10-02T10:00:00Z" }),
      point("2026-09-30T10:00:00Z", 10, { ...session, resetsAt: "2026-09-30T15:00:00Z" }),
      point("2026-09-30T12:00:00Z", 40, { ...session, resetsAt: "2026-09-30T15:00:00Z" }),
    ], [token("2026-09-30T11:00:00Z", { providerId: "codex:codex" })], new Set(), 1, now);
    expect(results).toEqual([]);
  });

  test("preserves a long session's tail when the same reset is less than five hours away", () => {
    const session = { providerId: "codex:codex", windowKey: "session", periodMs: 5 * 3600000, resetsAt: "2026-09-30T13:00:00Z" };
    const results = buildAllowanceEstimates([
      point("2026-09-24T13:00:00Z", 0, session),
      point("2026-09-29T12:00:00Z", 10, session), point("2026-09-30T12:00:00Z", 20, session),
    ], [token("2026-09-30T11:00:00Z", { providerId: "codex:codex" })], new Set(), 1, now);
    expect(results[0]).toMatchObject({ reason: "ok", tokens: 100, estimatedAllowance: 1000 });
  });

  test("estimates a positive half-point movement as rough", () => {
    const result = estimate([point("2026-09-29T12:00:00Z", 10), point("2026-09-30T12:00:00Z", 10.5)], [token("2026-09-30T11:00:00Z")]);
    expect(result).toMatchObject({ reason: "ok", estimatedAllowance: 20000, coarse: true });
  });

  test("preserves a recorded zero API price when estimating", () => {
    const result = estimate([point("2026-09-29T12:00:00Z", 10), point("2026-09-30T12:00:00Z", 20)], [token("2026-09-30T11:00:00Z", { costUsd: 0 })]);
    expect(result).toMatchObject({ reason: "ok", apiCost: 0, estimatedApiCost: 0 });
  });
});
