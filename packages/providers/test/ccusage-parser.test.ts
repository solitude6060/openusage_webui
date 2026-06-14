import { describe, expect, test } from "bun:test";
import {
  createRawCcusageRecord,
  normalizeCcusageRecords,
  parseCcusageRecords,
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

  test("uses stable ids when daily aggregate totals grow", () => {
    const morning = normalizeCcusageRecords(
      JSON.stringify([{ date: "20260222", source: "Codex", totalTokens: 100, costUSD: 0.5 }]),
      "daily",
    )[0];
    const afternoon = normalizeCcusageRecords(
      JSON.stringify([{ date: "20260222", source: "Codex", totalTokens: 250, costUSD: 1.25 }]),
      "daily",
    )[0];

    expect(afternoon.id).toBe(morning.id);
    expect(afternoon.totalTokens).toBe(250);
  });

  test("distinguishes valid empty JSON from parse failure", () => {
    expect(parseCcusageRecords(JSON.stringify({ daily: [] }), "daily")).toEqual({
      parsed: true,
      records: [],
    });
    expect(parseCcusageRecords("not json", "daily")).toEqual({
      parsed: false,
      records: [],
    });
  });

  test("parses compact monthly dates", () => {
    const records = normalizeCcusageRecords(
      JSON.stringify({
        monthly: [
          {
            month: "202602",
            totalTokens: 420,
            costUSD: 1.23,
          },
        ],
      }),
      "monthly",
    );

    expect(records[0]).toMatchObject({
      providerId: "ccusage",
      startedAt: "2026-02-01T00:00:00.000Z",
      totalTokens: 420,
      costUsd: 1.23,
    });
  });

  test("parses JSON output with trailing command noise", () => {
    const records = normalizeCcusageRecords(
      [
        "bunx warning: using cached package",
        JSON.stringify({
          daily: [
            {
              date: "2026-02-22",
              source: "Codex",
              totalTokens: 100,
            },
          ],
        }),
        "Done in 25ms",
      ].join("\n"),
      "daily",
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.providerId).toBe("codex");
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
    expect(createRawCcusageRecord("daily table output changed", "daily").id).toBe(fallback.id);
  });
});
