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
    expect(record.id).toHaveLength(36);
  });

  test("creates unique ids for repeated manual entries", () => {
    const first = createManualUsageRecord({
      providerId: "manual",
      tool: "Codex CLI",
      model: "gpt-5.5",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.01,
      startedAt: "2026-06-14T12:00:00.000Z",
      notes: "first entry",
    });
    const second = createManualUsageRecord({
      providerId: "manual",
      tool: "Codex CLI",
      model: "gpt-5.5",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.01,
      startedAt: "2026-06-14T12:00:00.000Z",
      notes: "second entry",
    });

    expect(second.id).not.toBe(first.id);
  });

  test("manual refresh providers are no-op sources", async () => {
    await expect(new ManualProvider().refresh()).resolves.toEqual([]);
    await expect(new MiniMaxManualProvider().refresh()).resolves.toEqual([]);
  });
});
