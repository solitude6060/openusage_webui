import { describe, expect, test } from "bun:test";
import type { QuotaObservation } from "../src/quota-observations";
import { buildQuotaWindowViews, previousResetCutoff } from "../src/quota-view";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function observation(overrides: Partial<QuotaObservation> = {}): QuotaObservation {
  return {
    providerId: "claude-code",
    observedAt: "2026-09-20T00:00:00.000Z",
    windowKey: "weekly",
    windowLabel: "Weekly",
    periodMs: WEEK_MS,
    resetsAt: "2026-09-27T00:00:00.000Z",
    present: true,
    usedPercent: 40,
    limitValue: null,
    limitUnit: null,
    usedValue: null,
    ...overrides,
  };
}

describe("quota window views", () => {
  test("places the previous-window cutoff half a period before the current reset", () => {
    expect(previousResetCutoff("2026-09-27T00:00:00.000Z", WEEK_MS)).toBe("2026-09-23T12:00:00.000Z");
    expect(previousResetCutoff("not-a-date", WEEK_MS)).toBeNull();
  });

  test("estimates allowance from tokens inside a week and keeps the previous window", () => {
    const views = buildQuotaWindowViews(
      [{
        current: observation({ observedAt: "2026-09-26T00:00:00.000Z", usedPercent: 50 }),
        previous: observation({
          observedAt: "2026-09-19T00:00:00.000Z",
          usedPercent: 80,
          resetsAt: "2026-09-20T00:00:00.000Z",
        }),
      }],
      [
        { providerId: "claude-code", model: "opus", startedAt: "2026-09-25T00:00:00.000Z", tokens: 30 },
        { providerId: "claude-code", model: "opus", startedAt: "2026-09-21T00:00:00.000Z", tokens: 20 },
        { providerId: "claude-code", model: "haiku", startedAt: "2026-09-18T00:00:00.000Z", tokens: 40 },
        { providerId: "claude-code", model: "opus", startedAt: "2026-09-10T00:00:00.000Z", tokens: 10 },
      ],
      new Set(),
    );

    expect(views).toEqual([
      expect.objectContaining({
        tokensInWindow: 50,
        impliedAllowance: 100,
        models: [{ model: "opus", tokens: 50 }],
        previous: {
          usedPercent: 80,
          impliedAllowance: 50,
          resetsAt: "2026-09-20T00:00:00.000Z",
        },
      }),
    ]);
  });

  test("leaves a short session and a shared Codex log without an allowance estimate", () => {
    const views = buildQuotaWindowViews(
      [
        {
          current: observation({
            providerId: "codex:family",
            windowKey: "weekly",
            usedPercent: 40,
          }),
          previous: null,
        },
        {
          current: observation({
            providerId: "codex:family",
            windowKey: "session",
            windowLabel: "Session",
            periodMs: 5 * 60 * 60 * 1000,
            usedPercent: 90,
          }),
          previous: null,
        },
      ],
      [
        { providerId: "codex:family", model: "gpt-6", startedAt: "2026-09-25T00:00:00.000Z", tokens: 80 },
      ],
      new Set(["codex:family", "codex:codex"]),
    );

    expect(views.map((view) => ({
      windowKey: view.windowKey,
      tokensInWindow: view.tokensInWindow,
      impliedAllowance: view.impliedAllowance,
      models: view.models,
    }))).toEqual([
      { windowKey: "session", tokensInWindow: null, impliedAllowance: null, models: [] },
      { windowKey: "weekly", tokensInWindow: null, impliedAllowance: null, models: [] },
    ]);
  });

  test("does not estimate an allowance below 20 percent", () => {
    const views = buildQuotaWindowViews(
      [{
        current: observation({ usedPercent: 19 }),
        previous: null,
      }],
      [
        { providerId: "claude-code", model: "opus", startedAt: "2026-09-25T00:00:00.000Z", tokens: 19 },
      ],
      new Set(),
    );
    expect(views[0]?.tokensInWindow).toBe(19);
    expect(views[0]?.impliedAllowance).toBeNull();
  });

  test("counts tokens on the account window and not on a sibling percent line", () => {
    const period = 30 * 24 * 60 * 60 * 1000;
    const views = buildQuotaWindowViews(
      [
        {
          current: observation({
            providerId: "cursor",
            windowKey: "cursor:api-usage",
            windowLabel: "API usage",
            periodMs: period,
            usedPercent: 100,
          }),
          previous: null,
        },
        {
          current: observation({
            providerId: "cursor",
            windowKey: "cursor:total-usage",
            windowLabel: "Total usage",
            periodMs: period,
            usedPercent: 40,
          }),
          previous: null,
        },
      ],
      [
        { providerId: "cursor", model: "composer", startedAt: "2026-09-25T00:00:00.000Z", tokens: 40 },
      ],
      new Set(),
    );
    const api = views.find((view) => view.windowKey === "cursor:api-usage");
    const total = views.find((view) => view.windowKey === "cursor:total-usage");
    expect(api?.tokensInWindow).toBeNull();
    expect(api?.impliedAllowance).toBeNull();
    expect(total?.tokensInWindow).toBe(40);
    expect(total?.impliedAllowance).toBe(100);
    expect(total?.models).toEqual([{ model: "composer", tokens: 40 }]);
  });
});
