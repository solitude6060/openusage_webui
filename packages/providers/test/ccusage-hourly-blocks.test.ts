import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  createTokenRecord,
  normalizeCcusageDailyRecords,
  normalizeCcusageHourlyBlocks,
} from "../src/providers/structured-usage";

// bun test runs in UTC, so a ccusage local day is a UTC day here.
const NOW = "2026-10-10T08:30:00.000Z";

function block(startTime: string, totalTokens: number, extra: Record<string, unknown> = {}) {
  return {
    id: startTime,
    startTime,
    endTime: new Date(Date.parse(startTime) + 3600000).toISOString(),
    isGap: false,
    isActive: false,
    totalTokens,
    costUSD: totalTokens / 100,
    models: ["claude-opus-5-5"],
    ...extra,
  };
}

const daily = (date: string, totalTokens: number) => ({ date, totalTokens });

afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = undefined;
});
let errorSpy: ReturnType<typeof spyOn> | undefined;

describe("normalizeCcusageHourlyBlocks", () => {
  test("maps a block to one hourly record and skips gap blocks", () => {
    const records = normalizeCcusageHourlyBlocks(
      "claude-code",
      [
        block("2026-10-09T03:00:00.000Z", 120),
        { ...block("2026-10-09T04:00:00.000Z", 0), isGap: true, costUSD: 0 },
        block("2026-10-09T05:00:00.000Z", 180),
      ],
      [daily("2026-10-09", 300)],
      NOW,
    );

    expect(records).toEqual([
      expect.objectContaining({
        providerId: "claude-code",
        tool: "ccusage",
        model: "All Models",
        source: "local-log",
        totalTokens: 120,
        costUsd: 1.2,
        startedAt: "2026-10-09T03:00:00.000Z",
        endedAt: "2026-10-09T04:00:00.000Z",
      }),
      expect.objectContaining({
        totalTokens: 180,
        startedAt: "2026-10-09T05:00:00.000Z",
        endedAt: "2026-10-09T06:00:00.000Z",
      }),
    ]);
  });

  test("gives an hourly record an id that differs from a daily record at the same start", () => {
    const [hourly] = normalizeCcusageHourlyBlocks(
      "claude-code",
      [block("2026-10-09T00:00:00.000Z", 300)],
      [daily("2026-10-09", 300)],
      NOW,
    );
    const [dailyRecord] = normalizeCcusageDailyRecords("claude-code", [
      { date: "2026-10-09", totalTokens: 300, models: { "All Models": { totalTokens: 300 } } },
    ]);
    const sameModelDaily = createTokenRecord("claude-code", "2026-10-09T00:00:00.000Z", "All Models", { totalTokens: 300 }, "ccusage");

    expect(hourly!.startedAt).toBe(dailyRecord!.startedAt);
    expect(hourly!.id).not.toBe(dailyRecord!.id);
    expect(hourly!.id).not.toBe(sameModelDaily.id);
  });

  test("writes no hourly rows for a completed day whose block sum differs from the daily total, and logs it", () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const records = normalizeCcusageHourlyBlocks(
      "claude-code",
      [
        block("2026-10-08T03:00:00.000Z", 100),
        block("2026-10-08T04:00:00.000Z", 100),
        block("2026-10-09T03:00:00.000Z", 300),
      ],
      [daily("2026-10-08", 250), daily("2026-10-09", 300)],
      NOW,
    );

    expect(records.map((record) => record.startedAt)).toEqual(["2026-10-09T03:00:00.000Z"]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("2026-10-08");
  });

  test("compares blocks with the daily totalTokens, not with the sum of the model rows", () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const records = normalizeCcusageHourlyBlocks(
      "claude-code",
      [block("2026-10-09T03:00:00.000Z", 300)],
      // The model rows add up to 300, but the day reports 200 in total.
      [{ date: "2026-10-09", totalTokens: 200, models: { "claude-opus-5-5": { totalTokens: 300 } } }],
      NOW,
    );

    expect(records).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("2026-10-09");
  });

  test("treats a block day that daily does not list as a mismatch", () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const records = normalizeCcusageHourlyBlocks(
      "claude-code",
      [block("2026-10-07T03:00:00.000Z", 100)],
      [daily("2026-10-09", 300)],
      NOW,
    );
    expect(records).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("emits the current day without comparing totals", () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const records = normalizeCcusageHourlyBlocks(
      "claude-code",
      [block("2026-10-10T07:00:00.000Z", 100), block("2026-10-10T08:00:00.000Z", 50, { isActive: true })],
      [daily("2026-10-10", 400)],
      NOW,
    );
    expect(records.map((record) => record.totalTokens)).toEqual([100, 50]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("ignores a block that does not start on an hour boundary, which then fails the day check", () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const records = normalizeCcusageHourlyBlocks(
      "claude-code",
      [block("2026-10-09T03:00:00.000Z", 100), block("2026-10-09T04:15:00.000Z", 200)],
      [daily("2026-10-09", 300)],
      NOW,
    );
    expect(records).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
