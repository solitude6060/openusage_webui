import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UsageRecord } from "../../core/src/types";
import { scanGrokSessionUsage } from "../src/providers/grok-session-usage";
import { CursorUsageCollector } from "../src/providers/structured-usage";
import { withIsolatedHome } from "./openusage-plugin-fixture-helpers";

const isHourly = (record: UsageRecord) => record.endedAt !== undefined;

// Per UTC day and model: the hourly totals and costs against the daily record.
function dailyVersusHourly(records: UsageRecord[]) {
  const key = (record: UsageRecord) => `${record.startedAt.slice(0, 10)}|${record.model}`;
  const sum = (rows: UsageRecord[]) => {
    const totals = new Map<string, { tokens: number; cost: number }>();
    for (const row of rows) {
      const current = totals.get(key(row)) ?? { tokens: 0, cost: 0 };
      current.tokens += row.totalTokens ?? 0;
      current.cost += row.costUsd ?? 0;
      totals.set(key(row), current);
    }
    return Object.fromEntries([...totals.entries()].sort(([left], [right]) => left.localeCompare(right)));
  };
  return {
    daily: sum(records.filter((record) => !isHourly(record))),
    hourly: sum(records.filter(isHourly)),
  };
}

function expectOneHourEach(records: UsageRecord[]) {
  const hourly = records.filter(isHourly);
  expect(hourly.length).toBeGreaterThan(0);
  for (const record of hourly) {
    expect(Date.parse(record.startedAt) % 3600000).toBe(0);
    expect(Date.parse(record.endedAt!) - Date.parse(record.startedAt)).toBe(3600000);
  }
  expect(new Set(records.map((record) => record.id)).size).toBe(records.length);
}

describe("Cursor hourly token records", () => {
  test("hourly totals add up to each daily record", () => {
    const collector = new CursorUsageCollector();
    const event = (timestamp: string, model: string, totalTokens: number, chargedCents: number) => ({
      timestamp,
      model,
      chargedCents,
      tokenUsage: { inputTokens: totalTokens, outputTokens: 0, totalTokens },
    });
    const events = [
      event("2026-10-09T05:10:00.000Z", "composer-2", 100, 100),
      event("2026-10-09T05:50:00.000Z", "composer-2", 50, 50),
      event("2026-10-09T23:30:00.000Z", "composer-2", 30, 25),
      event("2026-10-09T05:20:00.000Z", "claude-4.6-sonnet", 20, 10),
      event("2026-10-10T00:15:00.000Z", "composer-2", 7, 5),
    ];
    collector.capture(200, JSON.stringify({ totalUsageEventsCount: events.length, usageEventsDisplay: events }));

    const records = collector.records("cursor");

    expect(records.filter(isHourly).map((record) => [record.startedAt, record.model, record.totalTokens]).sort()).toEqual([
      ["2026-10-09T05:00:00.000Z", "claude-4.6-sonnet", 20],
      ["2026-10-09T05:00:00.000Z", "composer-2", 150],
      ["2026-10-09T23:00:00.000Z", "composer-2", 30],
      ["2026-10-10T00:00:00.000Z", "composer-2", 7],
    ]);
    expectOneHourEach(records);
    const { daily, hourly } = dailyVersusHourly(records);
    expect(Object.keys(daily)).toHaveLength(3);
    expect(hourly).toEqual(daily);
  });
});

describe("Grok hourly token records", () => {
  function turn(timestamp: string, model: string, input: number, eventId: string): string {
    return JSON.stringify({
      method: "session/update",
      params: {
        sessionId: "session-1",
        _meta: { eventId, agentTimestampMs: Date.parse(timestamp) },
        update: {
          sessionUpdate: "turn_completed",
          usage: { inputTokens: input, outputTokens: 0, modelUsage: { [model]: { inputTokens: input, outputTokens: 0 } } },
        },
      },
    });
  }

  test("hourly totals add up to each daily record and a copied event counts once", async () => {
    await withIsolatedHome(async (home) => {
      const first = join(home, ".grok/sessions/work/a/updates.jsonl");
      const copy = join(home, ".grok/sessions/work/b/updates.jsonl");
      mkdirSync(join(first, ".."), { recursive: true });
      mkdirSync(join(copy, ".."), { recursive: true });
      const lines = [
        turn("2026-10-09T10:05:00.000Z", "grok-4.7", 100, "t1"),
        turn("2026-10-09T10:50:00.000Z", "grok-4.7", 50, "t2"),
        turn("2026-10-09T23:59:00.000Z", "grok-4.7", 30, "t3"),
        turn("2026-10-10T00:10:00.000Z", "grok-4.7", 7, "t4"),
      ];
      writeFileSync(first, lines.join("\n") + "\n");
      writeFileSync(copy, lines[0] + "\n");

      const records = scanGrokSessionUsage({ providerId: "grok", homeDir: home });

      expect(records.filter(isHourly).map((record) => [record.startedAt, record.totalTokens]).sort()).toEqual([
        ["2026-10-09T10:00:00.000Z", 150],
        ["2026-10-09T23:00:00.000Z", 30],
        ["2026-10-10T00:00:00.000Z", 7],
      ]);
      expectOneHourEach(records);
      const { daily, hourly } = dailyVersusHourly(records);
      expect(daily).toEqual({
        "2026-10-09|grok-4.7": { tokens: 180, cost: 0 },
        "2026-10-10|grok-4.7": { tokens: 7, cost: 0 },
      });
      expect(hourly).toEqual(daily);
    });
  });
});
