import { describe, expect, test } from "bun:test";
import { createLineApi, createUtilApi } from "../src/providers/openusage-plugin-api";

describe("OpenUsage plugin line API", () => {
  const line = createLineApi() as {
    badge: (opts: Record<string, unknown>) => Record<string, unknown>;
  };

  test("badge passes through the urgency tone", () => {
    expect(line.badge({ label: "Reset Credit Expiry", text: "Ends today", tone: "urgent" })).toEqual({
      type: "badge",
      label: "Reset Credit Expiry",
      text: "Ends today",
      tone: "urgent",
    });
  });

  test("badge omits tone when not provided", () => {
    expect(line.badge({ label: "Status", text: "ok" })).toEqual({
      type: "badge",
      label: "Status",
      text: "ok",
    });
  });
});

describe("OpenUsage plugin utility API", () => {
  const util = createUtilApi(() => ({
    status: 200,
    headers: {},
    bodyText: "{}",
  })) as {
    parseDateMs: (value: unknown) => number | null;
    toIso: (value: unknown) => string | null;
  };

  test("normalizes numeric timestamp strings as seconds", () => {
    expect(util.toIso("1781683200")).toBe("2026-06-17T08:00:00.000Z");
  });

  test("normalizes parseDateMs numeric timestamps with the same seconds heuristic", () => {
    expect(util.parseDateMs("1781683200")).toBe(1781683200000);
    expect(util.parseDateMs("1781683200.5")).toBe(1781683200500);
    expect(util.parseDateMs(1781683200)).toBe(1781683200000);
    expect(util.parseDateMs(1781683200000)).toBe(1781683200000);
    expect(util.parseDateMs(9999999999)).toBe(9999999999000);
    expect(util.parseDateMs(10000000000)).toBe(10000000000);
  });

  test("keeps parseDateMs null-safe and compatible with date inputs", () => {
    expect(util.parseDateMs(null)).toBeNull();
    expect(util.parseDateMs(undefined)).toBeNull();
    expect(util.parseDateMs("not-a-date")).toBeNull();
    expect(util.parseDateMs(new Date("2026-06-17T08:00:00.000Z"))).toBe(1781683200000);
  });

  test("normalizes original host date string variants", () => {
    expect(util.toIso("2026-06-17 08:00:00 UTC")).toBe("2026-06-17T08:00:00.000Z");
    expect(util.toIso("2026-06-17T08:00:00+0000")).toBe("2026-06-17T08:00:00.000Z");
    expect(util.toIso("2026-06-17T08:00:00.123456Z")).toBe("2026-06-17T08:00:00.123Z");
    expect(util.toIso("2026-06-17T08:00:00")).toBe("2026-06-17T08:00:00.000Z");
  });
});
