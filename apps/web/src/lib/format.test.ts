import { describe, expect, test } from "bun:test";
import {
  clampUsageLimit,
  emptySessionMessage,
  formatDate,
  formatNumber,
  formatOptionalMoney,
  formatOptionalNumber,
  progressResetLabel,
} from "./format";

const NOW = Date.parse("2026-10-10T08:00:00.000Z");

describe("progressResetLabel", () => {
  test("says the window starts on next use when an idle period has no reset time", () => {
    expect(
      progressResetLabel({
        used: 0,
        periodDurationMs: 18_000_000,
        nowMs: NOW,
      }),
    ).toBe("Window Starts On Next Use");
  });

  test("says a reset is due when the reset time is already past", () => {
    expect(
      progressResetLabel({
        used: 10,
        resetsAt: "2026-10-10T07:00:00.000Z",
        periodDurationMs: 18_000_000,
        nowMs: NOW,
      }),
    ).toBe("Reset Due · Refresh For New Value");
  });

  test("keeps a future reset countdown", () => {
    expect(
      progressResetLabel({
        used: 10,
        resetsAt: "2026-10-10T10:30:00.000Z",
        nowMs: NOW,
      }),
    ).toBe("Resets in 2h 30m");
  });

  test("does not invent a window message when usage has started without a reset time", () => {
    expect(
      progressResetLabel({
        used: 4,
        periodDurationMs: 18_000_000,
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  test("does not invent a window message for idle usage without a period", () => {
    expect(progressResetLabel({ used: 0, nowMs: NOW })).toBeNull();
  });
});

describe("session record formatting", () => {
  test("returns Invalid Date for unparseable timestamps", () => {
    expect(formatDate("not-a-date")).toBe("Invalid Date");
  });

  test("renders unknown token counts and cost as a dash", () => {
    expect(formatOptionalNumber(undefined)).toBe("-");
    expect(formatOptionalNumber(null)).toBe("-");
    expect(formatOptionalNumber(0)).toBe(formatNumber(0));
    expect(formatOptionalMoney(undefined)).toBe("-");
    expect(formatOptionalMoney(null)).toBe("-");
    expect(formatOptionalMoney(0)).not.toBe("-");
  });

  test("clamps the record limit and defaults a blank value to 100", () => {
    expect(clampUsageLimit("")).toBe(100);
    expect(clampUsageLimit("   ")).toBe(100);
    expect(clampUsageLimit("0")).toBe(1);
    expect(clampUsageLimit("25")).toBe(25);
    expect(clampUsageLimit("5000")).toBe(1000);
    expect(clampUsageLimit("nope")).toBe(100);
  });

  test("uses a filter-specific empty message only when filters are active", () => {
    expect(emptySessionMessage(false)).toBe("No Usage Records Yet");
    expect(emptySessionMessage(true)).toBe("No Records Match These Filters");
  });
});
