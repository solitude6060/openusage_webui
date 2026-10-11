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

const FROM = "2026-10-01T00:00:00.000Z";

const prolite = {
  providerId: "codex:codex",
  observedAt: "2026-10-09T12:30:00.000Z",
  tokens: 100,
  input: 80,
  cachedInput: 60,
  output: 20,
  planType: "prolite",
  weeklyUsedPercent: 12,
  weeklyResetsAt: "2026-10-16T00:00:00.000Z",
  totalTokens: 100,
};

const plus = {
  ...prolite,
  providerId: "codex:family",
  observedAt: "2026-10-09T12:10:00.000Z",
  tokens: 40,
  input: 30,
  cachedInput: 10,
  output: 10,
  planType: "plus",
  weeklyUsedPercent: 4,
  totalTokens: 40,
};

type EventStorage = SqliteStorage & {
  upsertCodexTokenEvents?: (events: unknown[]) => Promise<void>;
};

async function open(): Promise<EventStorage> {
  const storage = new SqliteStorage() as EventStorage;
  await storage.init();
  return storage;
}

describe("codex_token_events", () => {
  test("stores events for Allowance only and ignores the same cumulative total", async () => {
    const storage = await open();
    const daily: UsageRecord = {
      id: "daily-codex",
      providerId: "codex:codex",
      tool: "ccusage",
      model: "gpt-5.6-sol",
      totalTokens: 999,
      startedAt: "2026-10-09T00:00:00.000Z",
      source: "local-log",
    };
    const pi: UsageRecord = {
      id: "pi-codex",
      providerId: "codex:codex",
      tool: "Pi Session",
      model: "gpt-5.6-sol",
      totalTokens: 7,
      startedAt: "2026-10-09T00:00:00.000Z",
      source: "local-log",
    };
    await storage.upsertUsageRecords([daily, pi]);
    await storage.upsertCodexTokenEvents?.([
      prolite,
      plus,
      { ...plus, observedAt: "2026-10-09T12:40:00.000Z", tokens: 25, totalTokens: 65 },
    ]);
    await storage.upsertCodexTokenEvents?.([prolite, plus]);

    const records = await storage.listUsageRecords({ limit: 20 });
    expect(records.map((record) => record.id).sort()).toEqual(["daily-codex", "pi-codex"]);

    const rows = (await storage.listAllowanceTokenRows(FROM)).filter((row) => row.providerId.startsWith("codex"));
    expect(rows.filter((row) => row.model === "All Models").sort((left, right) => left.providerId.localeCompare(right.providerId))).toEqual([
      {
        providerId: "codex:codex",
        model: "All Models",
        tokens: 100,
        costUsd: null,
        startedAt: "2026-10-09T12:00:00.000Z",
        bucketEnd: "2026-10-09T13:00:00.000Z",
      },
      {
        providerId: "codex:family",
        model: "All Models",
        tokens: 65,
        costUsd: null,
        startedAt: "2026-10-09T12:00:00.000Z",
        bucketEnd: "2026-10-09T13:00:00.000Z",
      },
    ]);
    expect(rows.some((row) => row.tokens === 999)).toBe(false);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "codex:codex", model: "gpt-5.6-sol", tokens: 7 }),
    ]));

    await storage.deleteUsageRecordsForProvider("codex:family");
    const remaining = await storage.listAllowanceTokenRows(FROM);
    expect(remaining.some((row) => row.providerId === "codex:family")).toBe(false);
    expect(remaining.some((row) => row.providerId === "codex:codex" && row.model === "All Models")).toBe(true);
    storage.close();
  });

  test("keeps the ccusage day when that account has no event in it", async () => {
    const storage = await open();
    await storage.upsertUsageRecords([
      {
        id: "daily-old",
        providerId: "codex:codex",
        tool: "ccusage",
        model: "gpt-5.6-sol",
        totalTokens: 50,
        startedAt: "2026-10-08T00:00:00.000Z",
        source: "local-log",
      },
    ]);
    await storage.upsertCodexTokenEvents?.([prolite]);
    const rows = await storage.listAllowanceTokenRows(FROM);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "codex:codex", model: "gpt-5.6-sol", tokens: 50 }),
      expect.objectContaining({ providerId: "codex:codex", model: "All Models", tokens: 100 }),
    ]));
    storage.close();
  });
});

describe("codex_token_events schema", () => {
  test("unique key is provider, time, and cumulative total", async () => {
    const storage = await open();
    storage.close();
    const db = new Database(join(dataDir, "openusage.sqlite"), { readonly: true });
    const table = db.query(`
      SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'codex_token_events'
    `).get() as { sql: string } | null;
    db.close();
    expect(table?.sql ?? "").toContain("UNIQUE");
    expect(table?.sql ?? "").toContain("total_tokens");
    expect(table?.sql ?? "").toContain("weekly_used_percent");
  });
});
