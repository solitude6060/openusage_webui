import { describe, expect, test } from "bun:test";
import { OpenUsagePluginProvider } from "../src/index";

function tokenRecords(records: Awaited<ReturnType<OpenUsagePluginProvider["refresh"]>>) {
  return records
    .filter((record) => typeof record.totalTokens === "number" && record.totalTokens > 0)
    .sort((left, right) => (left.model ?? "").localeCompare(right.model ?? ""));
}

describe("OpenUsagePluginProvider token ingestion", () => {
  test("emits nested ccusage model records and an Unknown remainder for each daily total", async () => {
    const provider = new OpenUsagePluginProvider({
      providerId: "codex:family",
      name: "Codex Family",
      pluginId: "codex",
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "codex",
          probe(ctx) {
            const usage = ctx.host.ccusage.query({ provider: "codex" });
            return {
              plan: "Plus",
              lines: [ctx.line.text({ label: "Days", value: String(usage.data.daily.length) })],
            };
          },
        };
      `,
      ccusageQuery: () => ({
        status: "ok",
        data: {
          daily: [
            {
              date: "2026-08-08",
              totalTokens: 150,
              models: {
                "gpt-5.6-sol": { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
                "gpt-5.6-luna": { inputTokens: 20, outputTokens: 10 },
              },
            },
          ],
        },
      }),
      now: () => "2026-08-09T10:00:00.000Z",
    });

    const records = await provider.refresh();

    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({
      providerId: "codex:family",
      tool: "OpenUsage Plugin Snapshot",
      source: "api",
    });
    expect(tokenRecords(records)).toEqual([
      expect.objectContaining({
        providerId: "codex:family",
        tool: "ccusage",
        model: "gpt-5.6-luna",
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        startedAt: "2026-08-08T00:00:00.000Z",
        source: "local-log",
      }),
      expect.objectContaining({
        providerId: "codex:family",
        tool: "ccusage",
        model: "gpt-5.6-sol",
        inputTokens: 80,
        outputTokens: 20,
        totalTokens: 100,
        startedAt: "2026-08-08T00:00:00.000Z",
        source: "local-log",
      }),
      expect.objectContaining({
        providerId: "codex:family",
        tool: "ccusage",
        model: "Unknown",
        totalTokens: 20,
        startedAt: "2026-08-08T00:00:00.000Z",
        source: "local-log",
      }),
    ]);
  });

  test("emits modelBreakdowns token records with cache fields and an Unknown remainder", async () => {
    const provider = new OpenUsagePluginProvider({
      providerId: "claude-code:work",
      name: "Claude Work",
      pluginId: "claude",
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "claude",
          probe(ctx) {
            ctx.host.ccusage.query({ provider: "claude" });
            return { lines: [] };
          },
        };
      `,
      ccusageQuery: () => ({
        status: "ok",
        data: {
          daily: [
            {
              date: "2026-08-07",
              totalTokens: 90,
              modelBreakdowns: [
                {
                  modelName: "claude-sonnet-4",
                  inputTokens: 20,
                  outputTokens: 30,
                  cacheCreationTokens: 5,
                  cacheReadTokens: 10,
                },
                { name: "claude-opus-4", totalTokens: 15 },
              ],
            },
          ],
        },
      }),
      now: () => "2026-08-09T10:00:00.000Z",
    });

    const records = await provider.refresh();

    expect(tokenRecords(records)).toEqual([
      expect.objectContaining({
        providerId: "claude-code:work",
        model: "claude-opus-4",
        totalTokens: 15,
        startedAt: "2026-08-07T00:00:00.000Z",
      }),
      expect.objectContaining({
        providerId: "claude-code:work",
        model: "claude-sonnet-4",
        inputTokens: 20,
        outputTokens: 30,
        cacheCreationTokens: 5,
        cacheReadTokens: 10,
        totalTokens: 65,
        startedAt: "2026-08-07T00:00:00.000Z",
      }),
      expect.objectContaining({
        providerId: "claude-code:work",
        model: "Unknown",
        totalTokens: 10,
        startedAt: "2026-08-07T00:00:00.000Z",
      }),
    ]);
  });

  test("aggregates complete Cursor usage events by UTC day and model without parsing display strings", async () => {
    const eventBody = {
      totalUsageEventsCount: 3,
      usageEventsDisplay: [
        {
          timestamp: "2026-08-08T09:30:00.000Z",
          model: "composer-2",
          displayText: "1.2M tokens",
          tokenUsage: {
            inputTokens: 120,
            outputTokens: 34,
            cacheWriteTokens: 5,
            cacheReadTokens: 6,
            totalTokens: 165,
          },
        },
        {
          timestamp: "2026-08-08T09:30:00.000Z",
          model: "composer-2",
          displayText: "1.2M tokens",
          tokenUsage: {
            inputTokens: 120,
            outputTokens: 34,
            cacheWriteTokens: 5,
            cacheReadTokens: 6,
            totalTokens: 165,
          },
        },
        {
          timestamp: "2026-08-09T09:31:00.000Z",
          model: "claude-4.6-sonnet",
          displayText: "999K tokens",
          tokenUsage: { inputTokens: 9, outputTokens: 11, totalTokens: 20 },
        },
      ],
    };
    const provider = new OpenUsagePluginProvider({
      providerId: "cursor:work",
      name: "Cursor Work",
      pluginId: "cursor",
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "cursor",
          probe(ctx) {
            ctx.host.http.request({
              method: "POST",
              url: "https://cursor.com/api/dashboard/get-filtered-usage-events",
              bodyText: "{}",
            });
            return { lines: [] };
          },
        };
      `,
      request: () => ({ status: 200, headers: {}, bodyText: JSON.stringify(eventBody) }),
      now: () => "2026-08-09T10:00:00.000Z",
    });

    const records = await provider.refresh();

    expect(tokenRecords(records)).toEqual([
      expect.objectContaining({
        providerId: "cursor:work",
        tool: "Cursor Usage Event",
        model: "claude-4.6-sonnet",
        inputTokens: 9,
        outputTokens: 11,
        totalTokens: 20,
        startedAt: "2026-08-09T00:00:00.000Z",
        source: "api",
      }),
      expect.objectContaining({
        providerId: "cursor:work",
        tool: "Cursor Usage Event",
        model: "composer-2",
        inputTokens: 240,
        outputTokens: 68,
        cacheCreationTokens: 10,
        cacheReadTokens: 12,
        totalTokens: 330,
        startedAt: "2026-08-08T00:00:00.000Z",
        source: "api",
      }),
    ]);
  });

  test("does not emit Cursor token records for a partial usage-events page", async () => {
    const provider = new OpenUsagePluginProvider({
      providerId: "cursor:work",
      name: "Cursor Work",
      pluginId: "cursor",
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "cursor",
          probe(ctx) {
            ctx.host.http.request({
              method: "POST",
              url: "https://cursor.com/api/dashboard/get-filtered-usage-events",
              bodyText: "{}",
            });
            return { lines: [] };
          },
        };
      `,
      request: () => ({
        status: 200,
        headers: {},
        bodyText: JSON.stringify({
          totalUsageEventsCount: 2,
          usageEventsDisplay: [
            {
              timestamp: "2026-08-08T09:30:00.000Z",
              model: "composer-2",
              tokenUsage: { totalTokens: 165 },
            },
          ],
        }),
      }),
      now: () => "2026-08-09T10:00:00.000Z",
    });

    const records = await provider.refresh();

    expect(records).toHaveLength(1);
    expect(tokenRecords(records)).toEqual([]);
  });

  test("keeps token record ids stable across refreshes with the same structured input", async () => {
    const provider = new OpenUsagePluginProvider({
      providerId: "codex:family",
      name: "Codex Family",
      pluginId: "codex",
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "codex",
          probe(ctx) {
            ctx.host.ccusage.query({ provider: "codex" });
            return { lines: [] };
          },
        };
      `,
      ccusageQuery: () => ({
        status: "ok",
        data: {
          daily: [
            {
              date: "2026-08-08",
              totalTokens: 120,
              models: {
                "gpt-5.6-sol": { totalTokens: 100 },
                "gpt-5.6-luna": { inputTokens: 10, outputTokens: 10 },
              },
            },
          ],
        },
      }),
      now: () => "2026-08-09T10:00:00.000Z",
    });

    const first = tokenRecords(await provider.refresh());
    const second = tokenRecords(await provider.refresh());

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(second.map((record) => record.id)).toEqual(first.map((record) => record.id));
  });
});
