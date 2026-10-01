import { describe, expect, test } from "bun:test";
import {
  observationsFromLines,
  quotaWindowKey,
  selectQuotaObservations,
  type QuotaObservation,
} from "../src/quota-observations";

function window(overrides: Partial<QuotaObservation> = {}): QuotaObservation {
  return {
    providerId: "codex:codex",
    observedAt: "2026-09-27T00:00:00.000Z",
    windowKey: "weekly",
    windowLabel: "Weekly",
    periodMs: 7 * 24 * 60 * 60 * 1000,
    resetsAt: "2026-10-04T00:00:00.000Z",
    present: true,
    usedPercent: 10,
    limitValue: null,
    limitUnit: null,
    usedValue: null,
    ...overrides,
  };
}

describe("quota observations", () => {
  test("maps account windows and model windows to stable keys", () => {
    expect(quotaWindowKey("codex:family", "Weekly")).toBe("weekly");
    expect(quotaWindowKey("codex:codex", "Session")).toBe("session");
    expect(quotaWindowKey("antigravity:acct1", "Gemini Pro")).toBe("model:gemini-pro");
    expect(quotaWindowKey("cursor", "Total usage")).toBe("cursor:total-usage");
  });

  test("reads percent windows and keeps an absolute dollar limit beside the percent", () => {
    const rows = observationsFromLines("cursor", [
      { type: "text", label: "gpt-6", value: "49%" },
      {
        type: "progress",
        label: "Total usage",
        used: 42,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: "2026-10-16T00:00:00.000Z",
        periodDurationMs: 30 * 24 * 60 * 60 * 1000,
        limitValue: 20,
        limitUnit: "usd",
        usedValue: 8.4,
      },
      {
        type: "progress",
        label: "Credits",
        used: 5,
        limit: 25,
        format: { kind: "dollars" },
      },
    ], "2026-09-27T00:00:00.000Z");

    expect(rows).toEqual([
      expect.objectContaining({
        windowKey: "cursor:total-usage",
        usedPercent: 42,
        limitValue: 20,
        limitUnit: "usd",
        usedValue: 8.4,
      }),
      expect.objectContaining({
        windowKey: "cursor:credits",
        usedPercent: 20,
        limitValue: 25,
        limitUnit: "usd",
        usedValue: 5,
      }),
    ]);
  });

  test("records every percent change and retains six-hour samples for an unchanged meter", () => {
    const latest = [window({ observedAt: "2026-09-27T00:00:00.000Z", usedPercent: 10 })];
    expect(selectQuotaObservations(
      [window({ usedPercent: 10.4 })],
      latest,
      "2026-09-27T01:00:00.000Z",
    )).toEqual([expect.objectContaining({ usedPercent: 10.4 })]);
    expect(selectQuotaObservations(
      [window({ usedPercent: 9.5 })], latest, "2026-09-27T01:00:00.000Z",
    )).toEqual([expect.objectContaining({ usedPercent: 9.5 })]);
    expect(selectQuotaObservations(
      [window({ usedPercent: 10 })], latest, "2026-09-27T01:00:00.000Z",
    )).toEqual([]);
    expect(selectQuotaObservations(
      [window({ usedPercent: 11 })],
      latest,
      "2026-09-27T01:00:00.000Z",
    )).toEqual([expect.objectContaining({ usedPercent: 11 })]);
    expect(selectQuotaObservations(
      [window({ resetsAt: "2026-10-11T00:00:00.000Z" })],
      latest,
      "2026-09-27T01:00:00.000Z",
    )).toEqual([expect.objectContaining({ resetsAt: "2026-10-11T00:00:00.000Z" })]);
    expect(selectQuotaObservations(
      [window({ usedPercent: 10 })],
      latest,
      "2026-09-27T06:00:00.000Z",
    )).toEqual([expect.objectContaining({ observedAt: "2026-09-27T06:00:00.000Z" })]);
  });

  test("writes an absent row when a previously present window disappears", () => {
    const selected = selectQuotaObservations(
      [window({ windowKey: "session", windowLabel: "Session" })],
      [window(), window({ windowKey: "session", windowLabel: "Session" })],
      "2026-09-27T02:00:00.000Z",
    );
    expect(selected).toEqual([
      expect.objectContaining({ windowKey: "weekly", present: false, usedPercent: null }),
    ]);
  });
});
