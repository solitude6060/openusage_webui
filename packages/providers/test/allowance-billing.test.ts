import { describe, expect, test } from "bun:test";
import { buildAllowanceCycleSummaries } from "../src/allowance-cycles";
import type { AllowanceObservation, AllowanceTokenRow } from "../src/allowance-estimate";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function observation(
  observedAt: string,
  usedPercent: number,
  resetsAt: string,
  windowKey = "weekly",
  periodMs = WEEK_MS,
): AllowanceObservation {
  return {
    providerId: "claude",
    observedAt,
    windowKey,
    windowLabel: "Weekly",
    periodMs,
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

// The live loader's 120 day history window, so no cycle is marked truncated.
function build(
  observations: AllowanceObservation[],
  rows: AllowanceTokenRow[],
  now: string,
  billingAnchor?: string,
) {
  const nowMs = Date.parse(now);
  const anchors = new Map(billingAnchor === undefined ? [] : [["claude", billingAnchor]]);
  return buildAllowanceCycleSummaries(
    observations,
    rows,
    new Set(),
    new Date(nowMs),
    { observationStartMs: nowMs - 120 * DAY_MS, tokenStartMs: nowMs - 121 * DAY_MS },
    anchors,
  )[0];
}

// An open weekly cycle that makes the summary usable; the billing months come from the rows.
function openCycle(now: string, resetsAt: string, usedPercent = 20): AllowanceObservation[] {
  return [observation(new Date(Date.parse(now) - DAY_MS).toISOString(), usedPercent, resetsAt)];
}

describe("billing months anchor", () => {
  test("clamps a Jan 31 anchor to the last day of a short month and keeps the time of day", () => {
    const summary = build(
      openCycle("2026-04-10T00:00:00.000Z", "2026-04-12T00:00:00.000Z"),
      [
        hour("2026-01-05T00:00:00.000Z", 10, 1),
        hour("2026-02-28T09:00:00.000Z", 15, 1),
        hour("2026-02-28T10:30:00.000Z", 20, 2),
        hour("2026-03-31T10:30:00.000Z", 30, 3),
      ],
      "2026-04-10T00:00:00.000Z",
      "2026-01-31T10:30:00.000Z",
    );

    expect(summary?.billing).toEqual(expect.objectContaining({
      anchor: "2026-01-31T10:30:00.000Z",
      anchorSource: "setting",
    }));
    expect(summary?.billing?.months.map((month) => [month.start, month.end, month.tokens])).toEqual([
      ["2026-03-31T10:30:00.000Z", "2026-04-30T10:30:00.000Z", 30],
      ["2026-02-28T10:30:00.000Z", "2026-03-31T10:30:00.000Z", 20],
      ["2026-01-31T10:30:00.000Z", "2026-02-28T10:30:00.000Z", 15],
      ["2025-12-31T10:30:00.000Z", "2026-01-31T10:30:00.000Z", 10],
    ]);
  });

  test("falls back to UTC calendar months when the anchor is missing or invalid", () => {
    const rows = [hour("2026-10-05T03:00:00.000Z", 10, 1)];
    for (const anchor of [undefined, "", "not a date"]) {
      const billing = build(openCycle("2026-10-19T00:00:00.000Z", "2026-10-22T00:00:00.000Z"), rows, "2026-10-19T00:00:00.000Z", anchor)?.billing;

      expect(billing).toEqual(expect.objectContaining({ anchor: null, anchorSource: "calendar" }));
      expect(billing?.months).toHaveLength(1);
      expect(billing?.months[0]).toEqual(expect.objectContaining({
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-11-01T00:00:00.000Z",
        current: true,
      }));
    }
  });
});

describe("billing months token totals", () => {
  test("counts an hour that starts at the month start and leaves out one that starts at the month end", () => {
    const summary = build(
      openCycle("2026-10-20T00:00:00.000Z", "2026-10-25T00:00:00.000Z"),
      [
        hour("2026-09-15T11:00:00.000Z", 1, 0.1),
        hour("2026-09-15T12:00:00.000Z", 100, 1),
        hour("2026-10-15T11:00:00.000Z", 200, 2),
        hour("2026-10-15T12:00:00.000Z", 7, 7),
      ],
      "2026-10-20T00:00:00.000Z",
      "2026-09-15T12:00:00.000Z",
    );

    const months = summary?.billing?.months ?? [];
    expect(months.map((month) => [month.start, month.tokens, month.apiDollars])).toEqual([
      ["2026-10-15T12:00:00.000Z", 7, 7],
      ["2026-09-15T12:00:00.000Z", 300, 3],
      ["2026-08-15T12:00:00.000Z", 1, 0.1],
    ]);
  });

  test("reports unknown dollars when any hour in the month has no cost", () => {
    const summary = build(
      openCycle("2026-10-19T00:00:00.000Z", "2026-10-22T00:00:00.000Z"),
      [hour("2026-09-10T00:00:00.000Z", 5, 1), hour("2026-10-05T00:00:00.000Z", 10, 1), hour("2026-10-06T00:00:00.000Z", 10, null)],
      "2026-10-19T00:00:00.000Z",
    );

    expect(summary?.billing?.months.map((month) => [month.tokens, month.apiDollars])).toEqual([[20, null], [5, 1]]);
  });

  test("reports where token data starts when it begins after the month start", () => {
    const summary = build(
      openCycle("2026-10-19T00:00:00.000Z", "2026-10-22T00:00:00.000Z"),
      [hour("2026-10-05T03:00:00.000Z", 10, 1)],
      "2026-10-19T00:00:00.000Z",
    );

    expect(summary?.billing?.months[0]?.tokensFrom).toBe("2026-10-05T03:00:00.000Z");
  });

  test("leaves tokensFrom empty when the first token hour is at or before the month start", () => {
    const summary = build(
      openCycle("2026-10-19T00:00:00.000Z", "2026-10-22T00:00:00.000Z"),
      [hour("2026-10-01T00:00:00.000Z", 10, 1)],
      "2026-10-19T00:00:00.000Z",
    );

    expect(summary?.billing?.months[0]?.tokensFrom).toBeNull();
  });
});

describe("billing months token coverage", () => {
  test("leaves tokensFrom empty for a month that ends before token data starts", () => {
    const summary = build(
      [
        observation("2026-09-20T00:00:00.000Z", 10, "2026-09-25T00:00:00.000Z"),
        ...openCycle("2026-10-19T00:00:00.000Z", "2026-10-22T00:00:00.000Z"),
      ],
      [hour("2026-10-05T03:00:00.000Z", 10, 1)],
      "2026-10-19T00:00:00.000Z",
    );

    const september = summary?.billing?.months.find((month) => month.start === "2026-09-01T00:00:00.000Z");
    expect(september).toEqual(expect.objectContaining({ tokens: 0, apiDollars: null, tokensFrom: null }));
  });
});

describe("billing months weekly parts", () => {
  const RESET = "2026-10-17T19:00:00.000Z";

  // The 2026-10-14 shape from the segment tests: 0 -> 96, a fall to 1 under the same reset, then 95.
  // Dollars per percent are 1 before the reset and 2 after it, so the baseline sees a regime change.
  function regimeChange(): { observations: AllowanceObservation[]; rows: AllowanceTokenRow[] } {
    return {
      observations: [
        observation("2026-10-10T20:00:00.000Z", 0, RESET),
        observation("2026-10-12T00:00:00.000Z", 50, RESET),
        observation("2026-10-14T04:22:00.000Z", 96, RESET),
        observation("2026-10-14T04:42:00.000Z", 1, RESET),
        observation("2026-10-16T00:00:00.000Z", 50, RESET),
        observation("2026-10-17T12:00:00.000Z", 95, RESET),
      ],
      rows: [
        hour("2026-10-11T00:00:00.000Z", 9600, 96),
        hour("2026-10-14T04:00:00.000Z", 50, 5),
        hour("2026-10-15T00:00:00.000Z", 9400, 188),
      ],
    };
  }

  test("reports two parts for a month that contains a regime change and never sums across it", () => {
    const { observations, rows } = regimeChange();
    const summary = build(observations, rows, "2026-10-18T00:00:00.000Z");
    const month = summary?.billing?.months[0];

    expect(summary?.regimeChanged).toBe(true);
    expect(month).toEqual(expect.objectContaining({ start: "2026-10-01T00:00:00.000Z", tokens: 19050, apiDollars: 289 }));
    expect(month?.weeklyParts).toHaveLength(2);
    expect(month?.weeklyParts[0]).toEqual(expect.objectContaining({
      from: "2026-10-10T19:00:00.000Z",
      to: "2026-10-14T04:42:00.000Z",
      consumedPercent: 96,
    }));
    expect(month?.weeklyParts[0]?.availablePercent).toBeCloseTo((3 + 9.7 / 24) / 7 * 100, 6);
    expect(month?.weeklyParts[1]).toEqual(expect.objectContaining({
      from: "2026-10-14T04:42:00.000Z",
      to: RESET,
      consumedPercent: 94,
    }));
    expect(month?.weeklyParts[1]?.availablePercent).toBeCloseTo((3 + 14.3 / 24) / 7 * 100, 6);
  });

  test("keeps one part for a month without a regime change", () => {
    const summary = build(
      [observation("2026-10-17T00:00:00.000Z", 50, RESET)],
      [hour("2026-10-12T00:00:00.000Z", 1000, 10)],
      "2026-10-18T00:00:00.000Z",
    );

    expect(summary?.regimeChanged).toBe(false);
    expect(summary?.billing?.months[0]?.weeklyParts).toEqual([
      expect.objectContaining({ from: "2026-10-10T19:00:00.000Z", to: RESET, consumedPercent: 50, availablePercent: 100 }),
    ]);
  });

  test("clips a cycle that crosses a month edge to the readings inside each month without interpolating", () => {
    // Cycle 09-27 to 10-04. The 29 -> 70 climb between the 09-29 and 10-02 readings belongs to neither month.
    const summary = build(
      [
        observation("2026-09-29T00:00:00.000Z", 40, "2026-10-04T00:00:00.000Z"),
        observation("2026-10-02T00:00:00.000Z", 70, "2026-10-04T00:00:00.000Z"),
        observation("2026-10-03T12:00:00.000Z", 80, "2026-10-04T00:00:00.000Z"),
      ],
      [hour("2026-09-28T00:00:00.000Z", 1000, 10), hour("2026-10-02T00:00:00.000Z", 1000, 10)],
      "2026-10-10T00:00:00.000Z",
    );
    const [october, september] = summary?.billing?.months ?? [];

    expect(september?.weeklyParts).toEqual([
      expect.objectContaining({ from: "2026-09-27T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z", consumedPercent: 40 }),
    ]);
    expect(september?.weeklyParts[0]?.availablePercent).toBeCloseTo(4 / 7 * 100, 6);
    expect(october?.weeklyParts).toEqual([
      expect.objectContaining({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z", consumedPercent: 10 }),
    ]);
    expect(october?.weeklyParts[0]?.availablePercent).toBeCloseTo(3 / 7 * 100, 6);
  });
});

describe("billing months current month projection", () => {
  test("projects the month's API dollars from the dollars so far and marks it reliable after a day", () => {
    const summary = build(
      openCycle("2026-10-11T00:00:00.000Z", "2026-10-14T00:00:00.000Z"),
      [hour("2026-09-20T00:00:00.000Z", 10, 9), hour("2026-10-01T00:00:00.000Z", 40, 40), hour("2026-10-09T00:00:00.000Z", 60, 60)],
      "2026-10-11T00:00:00.000Z",
    );
    const [october, september] = summary?.billing?.months ?? [];

    expect(october).toEqual(expect.objectContaining({ current: true, apiDollars: 100, projectionReliable: true }));
    expect(october?.projectedApiDollars).toBeCloseTo(100 / 10 * 31, 9);
    expect(september).toEqual(expect.objectContaining({ current: false, projectedApiDollars: null, projectionReliable: null }));
  });

  test("marks the projection unreliable when less than a day of the month has passed", () => {
    const summary = build(
      openCycle("2026-10-01T12:00:00.000Z", "2026-10-05T00:00:00.000Z"),
      [hour("2026-10-01T00:00:00.000Z", 40, 5)],
      "2026-10-01T12:00:00.000Z",
    );
    const october = summary?.billing?.months[0];

    expect(october?.projectionReliable).toBe(false);
    expect(october?.projectedApiDollars).toBeCloseTo(5 / 0.5 * 31, 9);
  });

  test("marks the projection unreliable when token data starts after the month start", () => {
    const summary = build(
      openCycle("2026-10-11T00:00:00.000Z", "2026-10-14T00:00:00.000Z"),
      [hour("2026-10-08T00:00:00.000Z", 40, 40)],
      "2026-10-11T00:00:00.000Z",
    );

    expect(summary?.billing?.months[0]).toEqual(expect.objectContaining({ tokensFrom: "2026-10-08T00:00:00.000Z", projectionReliable: false }));
  });

  test("leaves the projection empty when the month has no known API dollars", () => {
    const summary = build(
      openCycle("2026-10-11T00:00:00.000Z", "2026-10-14T00:00:00.000Z"),
      [hour("2026-10-01T00:00:00.000Z", 40, null)],
      "2026-10-11T00:00:00.000Z",
    );

    expect(summary?.billing?.months[0]).toEqual(expect.objectContaining({ apiDollars: null, projectedApiDollars: null }));
  });
});

describe("billing months for other windows", () => {
  test("is null for a window that is not weekly", () => {
    const summary = build(
      [observation("2026-10-10T00:00:00.000Z", 20, "2026-10-30T00:00:00.000Z", "cursor:total-usage", 30 * DAY_MS)],
      [hour("2026-10-05T00:00:00.000Z", 10, 1)],
      "2026-10-19T00:00:00.000Z",
    );

    expect(summary?.windowKey).toBe("cursor:total-usage");
    expect(summary?.billing).toBeNull();
  });
});
