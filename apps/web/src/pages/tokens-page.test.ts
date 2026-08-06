import { describe, expect, test } from "bun:test";
import { customRangeError, rangeBounds } from "./tokens-page";

const NOW = new Date("2026-08-06T12:34:56.789Z");

describe("rangeBounds", () => {
  test("all returns no bounds", () => {
    expect(rangeBounds("all", "", "", NOW)).toEqual({});
  });

  test("today uses the UTC day boundary so daily records line up", () => {
    const { from, to } = rangeBounds("today", "", "", NOW);
    expect(from).toBe("2026-08-06T00:00:00.000Z");
    expect(to).toBe(NOW.toISOString());
  });

  test("month starts at the first of the UTC month", () => {
    const { from } = rangeBounds("month", "", "", NOW);
    expect(from).toBe("2026-08-01T00:00:00.000Z");
  });

  test("7d and 30d are relative windows ending at now", () => {
    expect(rangeBounds("7d", "", "", NOW).from).toBe("2026-07-30T12:34:56.789Z");
    expect(rangeBounds("30d", "", "", NOW).from).toBe("2026-07-07T12:34:56.789Z");
    expect(rangeBounds("7d", "", "", NOW).to).toBe(NOW.toISOString());
  });

  test("custom converts the local datetime input to ISO and covers the full final minute", () => {
    const fromLocal = new Date("2026-08-01T09:30");
    const toLocal = new Date("2026-08-05T23:59");
    toLocal.setSeconds(59, 999);
    const { from, to } = rangeBounds("custom", "2026-08-01T09:30", "2026-08-05T23:59", NOW);
    expect(from).toBe(fromLocal.toISOString());
    expect(to).toBe(toLocal.toISOString());
    expect(to?.endsWith(":59.999Z")).toBe(true);
  });

  test("custom drops unparseable or empty date strings", () => {
    expect(rangeBounds("custom", "not-a-date", "2026-08-05T10:00", NOW).from).toBeUndefined();
    expect(rangeBounds("custom", "", "", NOW)).toEqual({ from: undefined, to: undefined });
  });
});

describe("customRangeError", () => {
  test("returns null for valid or incomplete ranges", () => {
    expect(customRangeError("2026-08-01T09:00", "2026-08-05T10:00")).toBeNull();
    expect(customRangeError("", "")).toBeNull();
    expect(customRangeError("not-a-date", "2026-08-05T10:00")).toBeNull();
  });

  test("flags inverted ranges with a friendly message", () => {
    expect(customRangeError("2026-08-05T10:00", "2026-08-01T09:00")).toBe("From Must Be Before To");
  });
});
