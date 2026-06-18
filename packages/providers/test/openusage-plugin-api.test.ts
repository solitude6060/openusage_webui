import { describe, expect, test } from "bun:test";
import { createUtilApi } from "../src/providers/openusage-plugin-api";

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
    expect(util.parseDateMs(1781683200)).toBe(1781683200000);
  });

  test("normalizes original host date string variants", () => {
    expect(util.toIso("2026-06-17 08:00:00 UTC")).toBe("2026-06-17T08:00:00.000Z");
    expect(util.toIso("2026-06-17T08:00:00+0000")).toBe("2026-06-17T08:00:00.000Z");
    expect(util.toIso("2026-06-17T08:00:00.123456Z")).toBe("2026-06-17T08:00:00.123Z");
    expect(util.toIso("2026-06-17T08:00:00")).toBe("2026-06-17T08:00:00.000Z");
  });
});
