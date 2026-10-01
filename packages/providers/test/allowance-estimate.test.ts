import { describe, expect, test } from "bun:test";
import {
  buildAllowanceEstimates,
  type AllowanceObservation,
  type AllowanceTokenRow,
} from "../src/allowance-estimate";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NOW = "2026-09-30T00:00:00.000Z";

function observation(overrides: Partial<AllowanceObservation> = {}): AllowanceObservation {
  return {
    providerId: "grok",
    observedAt: "2026-09-28T00:00:00.000Z",
    windowKey: "weekly",
    windowLabel: "Weekly",
    periodMs: WEEK_MS,
    resetsAt: "2026-10-04T00:00:00.000Z",
    present: true,
    usedPercent: 10,
    limitValue: null,
    limitUnit: null,
    ...overrides,
  };
}

function row(overrides: Partial<AllowanceTokenRow> = {}): AllowanceTokenRow {
  return {
    providerId: "grok",
    model: "grok-4.7-build",
    startedAt: "2026-09-29T00:00:00.000Z",
    tokens: 100,
    ...overrides,
  };
}

describe("allowance estimates", () => {
  test("divides tokens used in the selected range by the meter movement", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({
          observedAt: "2026-09-23T00:00:00.000Z",
          usedPercent: 10,
          resetsAt: "2026-09-30T00:00:00.000Z",
        }),
        observation({
          observedAt: "2026-09-29T12:00:00.000Z",
          usedPercent: 30,
          resetsAt: "2026-09-30T00:00:00.000Z",
        }),
      ],
      [row({ tokens: 200 })],
      new Set(),
      7,
      new Date(NOW),
    );

    expect(estimates).toEqual([
      expect.objectContaining({
        providerId: "grok",
        windowKey: "weekly",
        percentStart: 10,
        percentEnd: 30,
        tokens: 200,
        estimatedAllowance: 1000,
        coarse: false,
        reason: "ok",
        models: [{ model: "grok-4.7-build", tokens: 200 }],
      }),
    ]);
  });

  test("prices the allowance at the API cost recorded on the same tokens", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({
          observedAt: "2026-09-23T00:00:00.000Z",
          usedPercent: 10,
          resetsAt: "2026-09-30T00:00:00.000Z",
        }),
        observation({
          observedAt: "2026-09-29T12:00:00.000Z",
          usedPercent: 30,
          resetsAt: "2026-09-30T00:00:00.000Z",
        }),
      ],
      [row({ tokens: 200, costUsd: 2 })],
      new Set(),
      7,
      new Date(NOW),
    );

    expect(estimates).toEqual([
      expect.objectContaining({
        tokens: 200,
        estimatedAllowance: 1000,
        apiCost: 2,
        estimatedApiCost: 10,
      }),
    ]);
  });

  test("omits the API price when any token row in the span has no cost", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({
          observedAt: "2026-09-23T00:00:00.000Z",
          usedPercent: 10,
          resetsAt: "2026-09-30T00:00:00.000Z",
        }),
        observation({
          observedAt: "2026-09-29T12:00:00.000Z",
          usedPercent: 30,
          resetsAt: "2026-09-30T00:00:00.000Z",
        }),
      ],
      [
        row({ tokens: 150, costUsd: 1.5 }),
        row({ tokens: 50, model: "other" }),
      ],
      new Set(),
      7,
      new Date(NOW),
    );

    expect(estimates[0]).toEqual(expect.objectContaining({
      tokens: 200,
      estimatedAllowance: 1000,
      apiCost: null,
      estimatedApiCost: null,
    }));
  });

  test("splits a reset inside the range into two cycle estimates", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({
          observedAt: "2026-09-23T00:00:00.000Z",
          usedPercent: 10,
          resetsAt: "2026-09-27T00:00:00.000Z",
        }),
        observation({
          observedAt: "2026-09-26T12:00:00.000Z",
          usedPercent: 30,
          resetsAt: "2026-09-27T00:00:00.000Z",
        }),
        observation({
          observedAt: "2026-09-27T01:00:00.000Z",
          usedPercent: 0,
          resetsAt: "2026-10-04T00:00:00.000Z",
        }),
        observation({
          observedAt: "2026-09-29T00:00:00.000Z",
          usedPercent: 10,
          resetsAt: "2026-10-04T00:00:00.000Z",
        }),
      ],
      [
        row({ startedAt: "2026-09-22T00:00:00.000Z", tokens: 999 }),
        row({ startedAt: "2026-09-24T00:00:00.000Z", tokens: 40 }),
        row({ startedAt: "2026-09-28T00:00:00.000Z", tokens: 20, model: "grok-4.7-build" }),
      ],
      new Set(),
      7,
      new Date(NOW),
    );

    expect(estimates.map((estimate) => ({
      from: estimate.from,
      percentStart: estimate.percentStart,
      percentEnd: estimate.percentEnd,
      tokens: estimate.tokens,
      estimatedAllowance: estimate.estimatedAllowance,
    }))).toEqual([
      {
        from: "2026-09-27T01:00:00.000Z",
        percentStart: 0,
        percentEnd: 10,
        tokens: 20,
        estimatedAllowance: 200,
      },
      {
        from: "2026-09-23T00:00:00.000Z",
        percentStart: 10,
        percentEnd: 30,
        tokens: 40,
        estimatedAllowance: 200,
      },
    ]);
  });

  test("withholds conversion when daily totals cross the measured boundaries", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({
          observedAt: "2026-09-28T18:00:00.000Z",
          usedPercent: 7,
          resetsAt: "2026-10-04T17:00:00.000Z",
        }),
        observation({
          observedAt: "2026-09-29T04:00:00.000Z",
          usedPercent: 8,
          resetsAt: "2026-10-04T17:00:00.000Z",
        }),
        observation({
          observedAt: "2026-09-30T03:00:00.000Z",
          usedPercent: 12,
          resetsAt: "2026-10-04T17:00:00.000Z",
        }),
      ],
      [
        row({ startedAt: "2026-09-29T00:00:00.000Z", tokens: 68, bucketEnd: "2026-09-30T00:00:00.000Z" }),
        row({ startedAt: "2026-09-30T00:00:00.000Z", tokens: 7, bucketEnd: "2026-10-01T00:00:00.000Z" }),
      ],
      new Set(),
      1,
      new Date("2026-09-30T04:00:00.000Z"),
    );

    expect(estimates).toEqual([
      expect.objectContaining({
        from: "2026-09-29T04:00:00.000Z",
        percentStart: 8,
        percentEnd: 12,
        tokens: 0,
        estimatedAllowance: null,
        coarse: false,
        reason: "unaligned",
      }),
    ]);
  });

  test("does not split a reset day bucket between cycles", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({
          observedAt: "2026-09-26T12:00:00.000Z",
          usedPercent: 40,
          resetsAt: "2026-09-27T17:00:00.000Z",
        }),
        observation({
          observedAt: "2026-09-27T16:00:00.000Z",
          usedPercent: 46,
          resetsAt: "2026-09-27T17:00:00.000Z",
        }),
        observation({
          observedAt: "2026-09-27T18:00:00.000Z",
          usedPercent: 0,
          resetsAt: "2026-10-04T17:00:00.000Z",
        }),
        observation({
          observedAt: "2026-09-30T03:00:00.000Z",
          usedPercent: 10,
          resetsAt: "2026-10-04T17:00:00.000Z",
        }),
      ],
      [
        row({ startedAt: "2026-09-27T00:00:00.000Z", tokens: 100, bucketEnd: "2026-09-28T00:00:00.000Z" }),
        row({ startedAt: "2026-09-28T00:00:00.000Z", tokens: 50, bucketEnd: "2026-09-29T00:00:00.000Z" }),
      ],
      new Set(),
      7,
      new Date("2026-09-30T04:00:00.000Z"),
    );

    expect(estimates.map((estimate) => ({
      percentStart: estimate.percentStart,
      percentEnd: estimate.percentEnd,
      tokens: estimate.tokens,
      estimatedAllowance: estimate.estimatedAllowance,
    }))).toEqual([
      {
        percentStart: 0,
        percentEnd: 10,
        tokens: 50,
        estimatedAllowance: null,
      },
      {
        percentStart: 40,
        percentEnd: 46,
        tokens: 0,
        estimatedAllowance: null,
      },
    ]);
  });

  test("keeps a 1-day estimate and marks a small meter move as rough", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({ observedAt: "2026-09-29T00:00:00.000Z", usedPercent: 10 }),
        observation({ observedAt: "2026-09-29T18:00:00.000Z", usedPercent: 12 }),
      ],
      [
        row({ startedAt: "2026-09-28T00:00:00.000Z", tokens: 80 }),
        row({ startedAt: "2026-09-29T00:00:00.000Z", tokens: 10 }),
      ],
      new Set(),
      1,
      new Date(NOW),
    );

    expect(estimates).toEqual([
      expect.objectContaining({
        tokens: 10,
        estimatedAllowance: 500,
        coarse: true,
        reason: "ok",
      }),
    ]);
  });

  test("does not estimate when the meter stays flat, falls, or has no tokens", () => {
    const flat = buildAllowanceEstimates(
      [
        observation({ observedAt: "2026-09-28T00:00:00.000Z", usedPercent: 10 }),
        observation({ observedAt: "2026-09-29T12:00:00.000Z", usedPercent: 10 }),
      ],
      [row()],
      new Set(),
      7,
      new Date(NOW),
    );
    const fell = buildAllowanceEstimates(
      [
        observation({ observedAt: "2026-09-28T00:00:00.000Z", usedPercent: 40 }),
        observation({ observedAt: "2026-09-29T12:00:00.000Z", usedPercent: 30 }),
      ],
      [row()],
      new Set(),
      7,
      new Date(NOW),
    );
    const empty = buildAllowanceEstimates(
      [
        observation({ observedAt: "2026-09-28T00:00:00.000Z", usedPercent: 10 }),
        observation({ observedAt: "2026-09-29T12:00:00.000Z", usedPercent: 30 }),
      ],
      [],
      new Set(),
      7,
      new Date(NOW),
    );

    expect(flat[0]?.reason).toBe("no-movement");
    expect(flat[0]?.estimatedAllowance).toBeNull();
    expect(fell[0]?.reason).toBe("meter-fell");
    expect(fell[0]?.estimatedAllowance).toBeNull();
    expect(empty[0]?.reason).toBe("no-tokens");
    expect(empty[0]?.estimatedAllowance).toBeNull();
  });

  test("treats a reset clock that drifts by a few hours as one cycle", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({
          observedAt: "2026-09-28T00:00:00.000Z",
          usedPercent: 10,
          resetsAt: "2026-10-04T00:05:00.000Z",
        }),
        observation({
          observedAt: "2026-09-29T12:00:00.000Z",
          usedPercent: 30,
          resetsAt: "2026-10-04T10:01:00.000Z",
        }),
      ],
      [row({ tokens: 200 })],
      new Set(),
      7,
      new Date(NOW),
    );

    expect(estimates).toHaveLength(1);
    expect(estimates[0]).toEqual(expect.objectContaining({
      percentStart: 10,
      percentEnd: 30,
      estimatedAllowance: 1000,
      reason: "ok",
    }));
  });

  test("does not convert a shared session log or a short session meter", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({
          providerId: "codex:family",
          observedAt: "2026-09-28T00:00:00.000Z",
          usedPercent: 10,
        }),
        observation({
          providerId: "codex:family",
          observedAt: "2026-09-29T12:00:00.000Z",
          usedPercent: 30,
        }),
        observation({
          providerId: "codex:codex",
          windowKey: "session",
          windowLabel: "Session",
          periodMs: 5 * 60 * 60 * 1000,
          observedAt: "2026-09-29T12:00:00.000Z",
          usedPercent: 80,
          resetsAt: "2026-09-29T17:00:00.000Z",
        }),
        observation({
          providerId: "cursor",
          windowKey: "cursor:total-usage",
          windowLabel: "Total usage",
          periodMs: 30 * 24 * 60 * 60 * 1000,
          resetsAt: "2026-10-16T00:00:00.000Z",
          observedAt: "2026-09-28T00:00:00.000Z",
          usedPercent: 4,
          limitValue: 400,
          limitUnit: "usd",
        }),
        observation({
          providerId: "cursor",
          windowKey: "cursor:total-usage",
          windowLabel: "Total usage",
          periodMs: 30 * 24 * 60 * 60 * 1000,
          resetsAt: "2026-10-16T00:00:00.000Z",
          observedAt: "2026-09-29T12:00:00.000Z",
          usedPercent: 8,
          limitValue: 400,
          limitUnit: "usd",
        }),
      ],
      [
        row({ providerId: "codex:family", tokens: 80 }),
        row({ providerId: "codex:codex", tokens: 80 }),
        row({ providerId: "cursor", model: "composer", tokens: 40 }),
      ],
      new Set(["codex:family", "codex:codex"]),
      7,
      new Date(NOW),
    );

    expect(estimates.map((estimate) => ({
      providerId: estimate.providerId,
      windowKey: estimate.windowKey,
      reason: estimate.reason,
      estimatedAllowance: estimate.estimatedAllowance,
      statedLimit: estimate.statedLimit,
    }))).toEqual([
      {
        providerId: "codex:family",
        windowKey: "weekly",
        reason: "shared-log",
        estimatedAllowance: null,
        statedLimit: null,
      },
      {
        providerId: "cursor",
        windowKey: "cursor:total-usage",
        reason: "ok",
        estimatedAllowance: 1000,
        statedLimit: 400,
      },
    ]);
  });

  test("estimates a session whose reset is a week away even when the stamp says five hours", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({
          providerId: "codex:codex",
          windowKey: "session",
          windowLabel: "Session",
          periodMs: 5 * 60 * 60 * 1000,
          observedAt: "2026-09-28T04:48:00.000Z",
          usedPercent: 1,
          resetsAt: "2026-10-05T04:46:00.000Z",
        }),
        observation({
          providerId: "codex:codex",
          windowKey: "session",
          windowLabel: "Session",
          periodMs: 5 * 60 * 60 * 1000,
          observedAt: "2026-09-29T12:00:00.000Z",
          usedPercent: 40,
          resetsAt: "2026-10-05T04:46:00.000Z",
        }),
      ],
      [row({ providerId: "codex:codex", tokens: 390, costUsd: 3.9 })],
      new Set(["codex:family"]),
      7,
      new Date(NOW),
    );

    expect(estimates).toEqual([
      expect.objectContaining({
        providerId: "codex:codex",
        windowKey: "session",
        percentStart: 1,
        percentEnd: 40,
        tokens: 390,
        estimatedAllowance: 1000,
        apiCost: 3.9,
        estimatedApiCost: 10,
        reason: "ok",
      }),
    ]);
  });

  test("leaves a session that resets within five hours unestimated", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({
          providerId: "codex:family",
          windowKey: "session",
          windowLabel: "Session",
          periodMs: 5 * 60 * 60 * 1000,
          observedAt: "2026-09-29T10:00:00.000Z",
          usedPercent: 10,
          resetsAt: "2026-09-29T15:00:00.000Z",
        }),
        observation({
          providerId: "codex:family",
          windowKey: "session",
          windowLabel: "Session",
          periodMs: 5 * 60 * 60 * 1000,
          observedAt: "2026-09-29T12:00:00.000Z",
          usedPercent: 40,
          resetsAt: "2026-09-29T15:00:00.000Z",
        }),
      ],
      [row({ providerId: "codex:family", tokens: 100 })],
      new Set(["codex:family"]),
      7,
      new Date(NOW),
    );

    expect(estimates).toEqual([]);
  });

  test("stops the earlier cycle when a new reset starts before the old reset time", () => {
    const estimates = buildAllowanceEstimates(
      [
        observation({
          providerId: "codex:codex",
          windowKey: "session",
          windowLabel: "Session",
          periodMs: 5 * 60 * 60 * 1000,
          observedAt: "2026-09-26T18:00:00.000Z",
          usedPercent: 10,
          resetsAt: "2026-10-03T17:00:00.000Z",
        }),
        observation({
          providerId: "codex:codex",
          windowKey: "session",
          windowLabel: "Session",
          periodMs: 5 * 60 * 60 * 1000,
          observedAt: "2026-09-28T01:00:00.000Z",
          usedPercent: 50,
          resetsAt: "2026-10-03T17:00:00.000Z",
        }),
        observation({
          providerId: "codex:codex",
          windowKey: "session",
          windowLabel: "Session",
          periodMs: 5 * 60 * 60 * 1000,
          observedAt: "2026-09-28T05:00:00.000Z",
          usedPercent: 1,
          resetsAt: "2026-10-05T04:00:00.000Z",
        }),
        observation({
          providerId: "codex:codex",
          windowKey: "session",
          windowLabel: "Session",
          periodMs: 5 * 60 * 60 * 1000,
          observedAt: "2026-09-29T12:00:00.000Z",
          usedPercent: 20,
          resetsAt: "2026-10-05T04:00:00.000Z",
        }),
      ],
      [
        row({ providerId: "codex:codex", startedAt: "2026-09-27T00:00:00.000Z", tokens: 40 }),
        row({ providerId: "codex:codex", startedAt: "2026-09-29T00:00:00.000Z", tokens: 19 }),
      ],
      new Set(),
      7,
      new Date(NOW),
    );

    expect(estimates.map((estimate) => ({
      from: estimate.from,
      tokens: estimate.tokens,
      percentStart: estimate.percentStart,
      percentEnd: estimate.percentEnd,
      estimatedAllowance: estimate.estimatedAllowance,
    }))).toEqual([
      {
        from: "2026-09-28T05:00:00.000Z",
        tokens: 19,
        percentStart: 1,
        percentEnd: 20,
        estimatedAllowance: 100,
      },
      {
        from: "2026-09-26T18:00:00.000Z",
        tokens: 40,
        percentStart: 10,
        percentEnd: 50,
        estimatedAllowance: 100,
      },
    ]);
  });

  test("this period and the previous period each return one cycle", () => {
    const observations = [
      observation({
        providerId: "codex:codex",
        windowKey: "session",
        windowLabel: "Session",
        periodMs: 5 * 60 * 60 * 1000,
        observedAt: "2026-09-26T18:00:00.000Z",
        usedPercent: 10,
        resetsAt: "2026-10-03T17:00:00.000Z",
      }),
      observation({
        providerId: "codex:codex",
        windowKey: "session",
        windowLabel: "Session",
        periodMs: 5 * 60 * 60 * 1000,
        observedAt: "2026-09-28T01:00:00.000Z",
        usedPercent: 50,
        resetsAt: "2026-10-03T17:00:00.000Z",
      }),
      observation({
        providerId: "codex:codex",
        windowKey: "session",
        windowLabel: "Session",
        periodMs: 5 * 60 * 60 * 1000,
        observedAt: "2026-09-28T05:00:00.000Z",
        usedPercent: 1,
        resetsAt: "2026-10-05T04:00:00.000Z",
      }),
      observation({
        providerId: "codex:codex",
        windowKey: "session",
        windowLabel: "Session",
        periodMs: 5 * 60 * 60 * 1000,
        observedAt: "2026-09-29T12:00:00.000Z",
        usedPercent: 20,
        resetsAt: "2026-10-05T04:00:00.000Z",
      }),
    ];
    const rows = [
      row({ providerId: "codex:codex", startedAt: "2026-09-27T00:00:00.000Z", tokens: 40 }),
      row({ providerId: "codex:codex", startedAt: "2026-09-29T00:00:00.000Z", tokens: 19 }),
    ];

    const current = buildAllowanceEstimates(observations, rows, new Set(), { kind: "period" }, new Date(NOW));
    const previous = buildAllowanceEstimates(observations, rows, new Set(), { kind: "previous" }, new Date(NOW));

    expect(current.map((estimate) => estimate.tokens)).toEqual([19]);
    expect(previous.map((estimate) => estimate.tokens)).toEqual([40]);
  });

  test("this period stays empty after the cycle has ended", () => {
    const observations = [
      observation({
        observedAt: "2026-09-01T00:00:00.000Z",
        usedPercent: 10,
        resetsAt: "2026-09-08T00:00:00.000Z",
      }),
      observation({
        observedAt: "2026-09-07T00:00:00.000Z",
        usedPercent: 40,
        resetsAt: "2026-09-08T00:00:00.000Z",
      }),
    ];
    const rows = [row({ startedAt: "2026-09-05T00:00:00.000Z", tokens: 30 })];
    const now = new Date(NOW);

    expect(buildAllowanceEstimates(observations, rows, new Set(), { kind: "period" }, now)).toEqual([]);
    expect(buildAllowanceEstimates(observations, rows, new Set(), { kind: "previous" }, now)
      .map((estimate) => estimate.tokens)).toEqual([30]);
    expect(buildAllowanceEstimates(
      observations,
      rows,
      new Set(),
      { kind: "previous" },
      new Date("2026-11-15T00:00:00.000Z"),
    )).toEqual([]);
  });

  test("this month keeps the local month and 30 days can start earlier", () => {
    const now = new Date(NOW);
    const observations = [
      observation({
        windowKey: "cursor:total-usage",
        windowLabel: "Total usage",
        periodMs: 40 * 24 * 60 * 60 * 1000,
        observedAt: "2026-08-31T00:00:00.000Z",
        usedPercent: 10,
        resetsAt: "2026-10-10T00:00:00.000Z",
      }),
      observation({
        windowKey: "cursor:total-usage",
        windowLabel: "Total usage",
        periodMs: 40 * 24 * 60 * 60 * 1000,
        observedAt: "2026-09-29T00:00:00.000Z",
        usedPercent: 30,
        resetsAt: "2026-10-10T00:00:00.000Z",
      }),
    ];
    observations.push(observation({ windowKey: "cursor:total-usage", windowLabel: "Total usage", periodMs: 40 * 24 * 60 * 60 * 1000, observedAt: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), usedPercent: 10, resetsAt: "2026-10-10T00:00:00.000Z" }));
    const rows = [
      row({ startedAt: "2026-08-31T06:00:00.000Z", tokens: 50 }),
      row({ startedAt: "2026-09-15T00:00:00.000Z", tokens: 50 }),
    ];

    const month = buildAllowanceEstimates(observations, rows, new Set(), { kind: "month" }, now);
    const thirty = buildAllowanceEstimates(observations, rows, new Set(), 30, now);

    expect(month[0]).toEqual(expect.objectContaining({ tokens: 50, estimatedAllowance: 250 }));
    expect(thirty[0]).toEqual(expect.objectContaining({ tokens: 100, estimatedAllowance: 500 }));
  });
});
