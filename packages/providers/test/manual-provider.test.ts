import { describe, expect, test } from "bun:test";
import { createManualUsageRecord, ManualProvider, MiniMaxManualProvider } from "../src/index";

describe("Manual providers", () => {
  test("creates a normalized manual usage record", () => {
    const record = createManualUsageRecord({
      providerId: "minimax",
      tool: "MiniMax Web",
      model: "MiniMax-M3",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.01,
      startedAt: "2026-06-14T12:00:00.000Z",
      notes: "manual entry",
    });

    expect(record).toMatchObject({
      providerId: "minimax",
      tool: "MiniMax Web",
      model: "MiniMax-M3",
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.01,
      source: "manual",
      raw: { notes: "manual entry" },
    });
    expect(record.id).toHaveLength(64);
  });

  test("manual refresh providers are no-op sources", async () => {
    await expect(new ManualProvider().refresh()).resolves.toEqual([]);
    await expect(new MiniMaxManualProvider().refresh()).resolves.toEqual([]);
  });
});
