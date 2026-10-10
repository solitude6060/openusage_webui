import { describe, expect, test } from "bun:test";
import { progressResetLabel } from "./format";

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
