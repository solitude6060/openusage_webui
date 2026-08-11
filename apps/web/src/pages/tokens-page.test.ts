import { describe, expect, test } from "bun:test";
import type { TokenUsageBreakdown } from "../../../../packages/core/src/types";
import {
  buildTokenGroups,
  canonicalModelName,
  customRangeError,
  formatCompactTokenCount,
  rangeBounds,
} from "./tokens-page";

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

describe("token grouping", () => {
  const data: TokenUsageBreakdown = {
    from: null,
    to: null,
    totalTokens: 10_000,
    records: 4,
    providers: [
      {
        providerId: "claude-code",
        totalTokens: 3_000,
        records: 2,
        models: [
          { model: "claude-opus-5", totalTokens: 1_000, records: 1 },
          { model: "claude-opus-5-thinking-high", totalTokens: 2_000, records: 1 },
        ],
      },
      {
        providerId: "cursor",
        totalTokens: 7_000,
        records: 2,
        models: [
          { model: "claude-opus-5-20250805", totalTokens: 3_000, records: 1 },
          { model: "gpt-5.6-sol-medium", totalTokens: 4_000, records: 1 },
        ],
      },
    ],
  };

  test("formats parent totals with M and B suffixes", () => {
    expect(formatCompactTokenCount(999)).toBe("999");
    expect(formatCompactTokenCount(1_234_567)).toBe("1.23M");
    expect(formatCompactTokenCount(1_234_000_000)).toBe("1.23B");
  });

  test("detects known model aliases without merging distinct named variants", () => {
    expect(canonicalModelName("Claude Opus 5 Thinking High")).toBe("claude-opus-5");
    expect(canonicalModelName("claude-opus-5-20250805")).toBe("claude-opus-5");
    expect(canonicalModelName("claude-opus-5-20250805-thinking")).toBe("claude-opus-5");
    expect(canonicalModelName("claude-4.6-sonnet-high-thinking")).toBe("claude-sonnet-4.6");
    expect(canonicalModelName("cursor-claude-4.6-opus-20250805-high-thinking"))
      .toBe("claude-opus-4.6");
    expect(canonicalModelName("cursor-grok-4.5-high-fast")).toBe("grok-4.5");
    expect(canonicalModelName("gpt-5.6-sol-medium")).toBe("gpt-5.6-sol");
    expect(canonicalModelName("kimi-k3-max")).toBe("kimi-k3");
    expect(canonicalModelName("gpt-5.4-mini")).toBe("gpt-5.4-mini");
    expect(canonicalModelName("gpt-5.3-codex-spark")).toBe("gpt-5.3-codex-spark");
    expect(canonicalModelName("claude-opus-4-8")).not.toBe(canonicalModelName("claude-opus-4"));
  });

  test("merges aliases inside each provider group", () => {
    const groups = buildTokenGroups(data, "provider");
    expect(groups.map((group) => [group.label, group.totalTokens])).toEqual([
      ["cursor", 7_000],
      ["claude-code", 3_000],
    ]);
    expect(groups[1]?.children).toEqual([
      expect.objectContaining({ label: "claude-opus-5", totalTokens: 3_000, records: 2 }),
    ]);
  });

  test("groups canonical models across providers while keeping provider rows separate", () => {
    const groups = buildTokenGroups(data, "model");
    expect(groups.map((group) => [group.label, group.totalTokens, group.records])).toEqual([
      ["claude-opus-5", 6_000, 3],
      ["gpt-5.6-sol", 4_000, 1],
    ]);
    expect(groups[0]?.children.map((row) => [row.label, row.totalTokens])).toEqual(
      expect.arrayContaining([["cursor", 3_000], ["claude-code", 3_000]]),
    );
  });

  test("preserves totals and record counts in both grouping directions", () => {
    for (const grouping of ["provider", "model"] as const) {
      const groups = buildTokenGroups(data, grouping);
      expect(groups.reduce((sum, group) => sum + group.totalTokens, 0)).toBe(data.totalTokens);
      expect(groups.reduce((sum, group) => sum + group.records, 0)).toBe(data.records);
    }
  });
});
