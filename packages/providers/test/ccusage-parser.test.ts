import { describe, expect, test } from "bun:test";
import {
  createRawCcusageRecord,
  normalizeCcusageRecords,
} from "../src/providers/ccusage-parser";

describe("ccusage parser", () => {
  test("normalizes noisy daily object output with Claude-style fields", () => {
    const records = normalizeCcusageRecords(
      `Saved lockfile
{
  "daily": [
    {
      "date": "2026-02-21",
      "tool": "Claude Code",
      "model": "claude-sonnet-4-20250514",
      "inputTokens": 100,
      "outputTokens": 50,
      "cacheCreationTokens": 20,
      "cacheReadTokens": 30,
      "totalTokens": 200,
      "totalCost": 0.25
    }
  ],
  "totals": { "totalTokens": 200 }
}`,
      "daily",
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      providerId: "claude-code",
      tool: "Claude Code",
      model: "claude-sonnet-4-20250514",
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 20,
      cacheReadTokens: 30,
      totalTokens: 200,
      costUsd: 0.25,
      startedAt: "2026-02-21T00:00:00.000Z",
      source: "cli",
    });
    expect(records[0].raw).toEqual(
      expect.objectContaining({
        command: "daily",
        row: expect.objectContaining({ totalCost: 0.25 }),
      }),
    );
  });

  test("normalizes array output with Codex-style costUSD fields", () => {
    const first = normalizeCcusageRecords(
      JSON.stringify([
        {
          date: "20260222",
          source: "Codex",
          model: "gpt-5.5",
          inputTokens: 30,
          cachedInputTokens: 20,
          outputTokens: 50,
          totalTokens: 100,
          costUSD: 0.5,
        },
      ]),
      "daily",
    )[0];
    const second = normalizeCcusageRecords(
      JSON.stringify([
        {
          date: "20260222",
          source: "Codex",
          model: "gpt-5.5",
          inputTokens: 30,
          cachedInputTokens: 20,
          outputTokens: 50,
          totalTokens: 100,
          costUSD: 0.5,
        },
      ]),
      "daily",
    )[0];

    expect(first).toMatchObject({
      providerId: "codex",
      tool: "Codex",
      model: "gpt-5.5",
      inputTokens: 30,
      cacheReadTokens: 20,
      outputTokens: 50,
      totalTokens: 100,
      costUsd: 0.5,
      startedAt: "2026-02-22T00:00:00.000Z",
    });
    expect(second.id).toBe(first.id);
  });

  test("maps known tool names and leaves unknown aggregates as ccusage", () => {
    const records = normalizeCcusageRecords(
      JSON.stringify({
        daily: [
          { date: "2026-02-23", tool: "GitHub Copilot CLI", totalTokens: 10 },
          { date: "2026-02-23", tool: "Gemini CLI", totalTokens: 20 },
          { date: "2026-02-23", tool: "All Agents", totalTokens: 30 },
        ],
      }),
      "daily",
    );

    expect(records.map((record) => record.providerId)).toEqual([
      "github-copilot",
      "gemini-cli",
      "ccusage",
    ]);
  });

  test("returns no structured records for non-json output and can create raw fallback", () => {
    expect(normalizeCcusageRecords("daily table output", "daily")).toEqual([]);

    const fallback = createRawCcusageRecord("daily table output", "daily");
    expect(fallback).toMatchObject({
      providerId: "ccusage",
      source: "cli",
      tool: "ccusage daily",
      totalTokens: 0,
    });
    expect(fallback.raw).toEqual({
      command: "daily",
      stdout: "daily table output",
    });
  });
});
