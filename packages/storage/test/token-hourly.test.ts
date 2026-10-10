import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorage } from "../src/index";
import type { UsageRecord } from "../../core/src/types";

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(() => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-webui-test-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

const HOUR = 3600000;

function daily(overrides: Partial<UsageRecord> & Pick<UsageRecord, "id" | "providerId" | "tool" | "source">): UsageRecord {
  return { model: "model", totalTokens: 100, startedAt: "2026-10-09T00:00:00.000Z", ...overrides };
}

function hourly(
  overrides: Partial<UsageRecord> & Pick<UsageRecord, "id" | "providerId" | "tool" | "source" | "startedAt">,
): UsageRecord {
  return {
    model: "model",
    totalTokens: 10,
    endedAt: new Date(Date.parse(overrides.startedAt) + HOUR).toISOString(),
    ...overrides,
  };
}

const DAILY_BATCH: UsageRecord[] = [
  daily({ id: "d-claude", providerId: "claude-code", tool: "ccusage", source: "local-log", totalTokens: 300 }),
  daily({ id: "d-cursor", providerId: "cursor", tool: "Cursor Usage Event", source: "api", totalTokens: 60 }),
  daily({ id: "d-grok", providerId: "grok", tool: "Grok Session", source: "local-log", totalTokens: 70 }),
];

const HOURLY_BATCH: UsageRecord[] = [
  // Starts on the same instant as the daily Cursor row, so it must not enter the replaceScopes delete.
  hourly({ id: "h-cursor-0", providerId: "cursor", tool: "Cursor Usage Event", source: "api", startedAt: "2026-10-09T00:00:00.000Z", totalTokens: 25, costUsd: 0.5 }),
  hourly({ id: "h-cursor-5", providerId: "cursor", tool: "Cursor Usage Event", source: "api", startedAt: "2026-10-09T05:00:00.000Z", totalTokens: 35 }),
  hourly({ id: "h-claude-3", providerId: "claude-code", tool: "ccusage", source: "local-log", startedAt: "2026-10-09T03:00:00.000Z", model: "All Models", totalTokens: 300 }),
];

async function snapshot(storage: SqliteStorage) {
  const records = (await storage.listUsageRecords({ limit: 1000 }))
    .map(({ createdAt: _createdAt, ...rest }) => rest)
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    records,
    summary: await storage.getUsageSummary(),
    breakdown: await storage.getTokenUsageBreakdown(),
    positive: await storage.listPositiveTokenRows("2026-10-01T00:00:00.000Z"),
  };
}

describe("token_hourly storage", () => {
  test("hourly records stay out of usage_records and every other reader", async () => {
    const plain = new SqliteStorage(join(dataDir, "plain.sqlite"));
    const mixed = new SqliteStorage(join(dataDir, "mixed.sqlite"));
    await plain.init();
    await mixed.init();
    await plain.upsertUsageRecords(DAILY_BATCH, { replaceScopes: true });
    await mixed.upsertUsageRecords([...DAILY_BATCH, ...HOURLY_BATCH], { replaceScopes: true });

    expect(await snapshot(mixed)).toEqual(await snapshot(plain));

    plain.close();
    mixed.close();
    const db = new Database(join(dataDir, "mixed.sqlite"), { readonly: true });
    const rows = db
      .query("SELECT provider_id, tool, hour_start, model, total_tokens, cost_usd FROM token_hourly ORDER BY provider_id, hour_start")
      .all();
    db.close();
    expect(rows).toEqual([
      { provider_id: "claude-code", tool: "ccusage", hour_start: "2026-10-09T03:00:00.000Z", model: "All Models", total_tokens: 300, cost_usd: null },
      { provider_id: "cursor", tool: "Cursor Usage Event", hour_start: "2026-10-09T00:00:00.000Z", model: "model", total_tokens: 25, cost_usd: 0.5 },
      { provider_id: "cursor", tool: "Cursor Usage Event", hour_start: "2026-10-09T05:00:00.000Z", model: "model", total_tokens: 35, cost_usd: null },
    ]);
  });

  test("a later batch overwrites the same hour instead of adding a row", async () => {
    const storage = new SqliteStorage(join(dataDir, "hourly.sqlite"));
    await storage.init();
    await storage.upsertUsageRecords([HOURLY_BATCH[1]!]);
    await storage.upsertUsageRecords([{ ...HOURLY_BATCH[1]!, totalTokens: 50 }]);
    storage.close();

    const db = new Database(join(dataDir, "hourly.sqlite"), { readonly: true });
    const rows = db.query("SELECT total_tokens FROM token_hourly").all();
    db.close();
    expect(rows).toEqual([{ total_tokens: 50 }]);
  });
});

describe("listAllowanceTokenRows", () => {
  const FROM = "2026-10-01T00:00:00.000Z";

  async function seeded(records: UsageRecord[]) {
    const storage = new SqliteStorage();
    await storage.init();
    await storage.upsertUsageRecords(records, { replaceScopes: true });
    return storage;
  }

  test("a UTC day with hourly rows returns only those rows, a day without keeps its daily row", async () => {
    const storage = await seeded([
      daily({ id: "d-9", providerId: "cursor", tool: "Cursor Usage Event", source: "api", startedAt: "2026-10-09T00:00:00.000Z", totalTokens: 60 }),
      daily({ id: "d-8", providerId: "cursor", tool: "Cursor Usage Event", source: "api", startedAt: "2026-10-08T00:00:00.000Z", totalTokens: 40 }),
      hourly({ id: "h-a", providerId: "cursor", tool: "Cursor Usage Event", source: "api", startedAt: "2026-10-09T05:00:00.000Z", totalTokens: 25, costUsd: 0.5 }),
      hourly({ id: "h-b", providerId: "cursor", tool: "Cursor Usage Event", source: "api", startedAt: "2026-10-09T23:00:00.000Z", totalTokens: 35 }),
    ]);
    const rows = (await storage.listAllowanceTokenRows(FROM)).sort((l, r) => l.startedAt.localeCompare(r.startedAt));
    storage.close();

    expect(rows).toEqual([
      { providerId: "cursor", model: "model", tokens: 40, costUsd: null, startedAt: "2026-10-08T00:00:00.000Z", bucketEnd: "2026-10-09T00:00:00.000Z" },
      { providerId: "cursor", model: "model", tokens: 25, costUsd: 0.5, startedAt: "2026-10-09T05:00:00.000Z", bucketEnd: "2026-10-09T06:00:00.000Z" },
      { providerId: "cursor", model: "model", tokens: 35, costUsd: null, startedAt: "2026-10-09T23:00:00.000Z", bucketEnd: "2026-10-10T00:00:00.000Z" },
    ]);
  });

  test("hourly rows of one provider or tool do not replace another provider's daily row", async () => {
    const storage = await seeded([
      daily({ id: "d-cursor", providerId: "cursor", tool: "Cursor Usage Event", source: "api", totalTokens: 60 }),
      daily({ id: "d-grok", providerId: "grok", tool: "Grok Session", source: "local-log", totalTokens: 70 }),
      hourly({ id: "h-grok", providerId: "grok", tool: "Grok Session", source: "local-log", startedAt: "2026-10-09T05:00:00.000Z", totalTokens: 70 }),
    ]);
    const rows = await storage.listAllowanceTokenRows(FROM);
    storage.close();

    expect(rows.map((row) => [row.providerId, row.tokens, row.bucketEnd]).sort()).toEqual([
      ["cursor", 60, "2026-10-10T00:00:00.000Z"],
      ["grok", 70, "2026-10-09T06:00:00.000Z"],
    ]);
  });

  test("a ccusage local day pairs with its UTC hours under Asia/Taipei", async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "Asia/Taipei";
    try {
      expect(new Date(2026, 9, 9).toISOString()).toBe("2026-10-08T16:00:00.000Z");
      const storage = await seeded([
        daily({ id: "d-09", providerId: "claude-code", tool: "ccusage", source: "local-log", startedAt: "2026-10-09T00:00:00.000Z", totalTokens: 300 }),
        daily({ id: "d-10", providerId: "claude-code", tool: "ccusage", source: "local-log", startedAt: "2026-10-10T00:00:00.000Z", totalTokens: 90 }),
        // Local 2026-10-09 runs from 16:00Z on the 8th to 15:00Z on the 9th.
        hourly({ id: "h-first", providerId: "claude-code", tool: "ccusage", source: "local-log", startedAt: "2026-10-08T16:00:00.000Z", model: "All Models", totalTokens: 100 }),
        hourly({ id: "h-last", providerId: "claude-code", tool: "ccusage", source: "local-log", startedAt: "2026-10-09T15:00:00.000Z", model: "All Models", totalTokens: 200 }),
      ]);
      const rows = (await storage.listAllowanceTokenRows(FROM)).sort((l, r) => l.startedAt.localeCompare(r.startedAt));
      storage.close();

      expect(rows).toEqual([
        { providerId: "claude-code", model: "All Models", tokens: 100, costUsd: null, startedAt: "2026-10-08T16:00:00.000Z", bucketEnd: "2026-10-08T17:00:00.000Z" },
        { providerId: "claude-code", model: "All Models", tokens: 200, costUsd: null, startedAt: "2026-10-09T15:00:00.000Z", bucketEnd: "2026-10-09T16:00:00.000Z" },
        { providerId: "claude-code", model: "model", tokens: 90, costUsd: null, startedAt: "2026-10-09T16:00:00.000Z", bucketEnd: "2026-10-10T16:00:00.000Z" },
      ]);
    } finally {
      process.env.TZ = previousTz ?? "UTC";
    }
  });

  test("ignores zero-token hourly rows and hours older than the cutoff", async () => {
    const storage = await seeded([
      hourly({ id: "h-zero", providerId: "grok", tool: "Grok Session", source: "local-log", startedAt: "2026-10-09T05:00:00.000Z", totalTokens: 0 }),
      hourly({ id: "h-old", providerId: "grok", tool: "Grok Session", source: "local-log", startedAt: "2026-09-20T05:00:00.000Z", totalTokens: 5 }),
    ]);
    const rows = await storage.listAllowanceTokenRows(FROM);
    storage.close();
    expect(rows).toEqual([]);
  });
});
