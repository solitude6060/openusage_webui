import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorage, getConfigPath, getDatabasePath } from "../src/index";
import type { UsageRecord } from "../../core/src/types";

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(() => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-webui-test-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
});

afterEach(() => {
  if (previousDataDir === undefined) {
    delete process.env.OPENUSAGE_WEBUI_DIR;
  } else {
    process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("SqliteStorage", () => {
  test("initializes the database and config files", async () => {
    const storage = new SqliteStorage();
    await storage.init();

    expect(statSync(getDatabasePath()).isFile()).toBe(true);
    expect(statSync(getConfigPath()).isFile()).toBe(true);
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);

    storage.close();
  });

  test("stores manual usage and calculates summary", async () => {
    const storage = new SqliteStorage();
    await storage.init();
    const startedAt = new Date().toISOString();
    const record: UsageRecord = {
      id: "manual-1",
      providerId: "manual",
      tool: "MiniMax Web",
      model: "MiniMax-M3",
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: 0.01,
      startedAt,
      source: "manual",
      raw: { notes: "test" },
    };

    await storage.upsertUsageRecords([record]);
    const records = await storage.listUsageRecords({ providerId: "manual" });
    const summary = await storage.getUsageSummary();

    expect(records).toHaveLength(1);
    expect(records[0].raw).toEqual({ notes: "test" });
    expect(summary.today.totalTokens).toBe(1500);
    expect(summary.today.costUsd).toBe(0.01);
    expect(summary.byProvider[0]).toMatchObject({
      providerId: "manual",
      totalTokens: 1500,
      records: 1,
    });

    storage.close();
  });

  test("summarizes more than the record listing limit", async () => {
    const storage = new SqliteStorage();
    await storage.init();
    const startedAt = new Date().toISOString();
    const records: UsageRecord[] = Array.from({ length: 1001 }, (_, index) => ({
      id: `manual-${index}`,
      providerId: "manual",
      totalTokens: 1,
      costUsd: 0.001,
      startedAt,
      source: "manual",
    }));

    await storage.upsertUsageRecords(records);
    const summary = await storage.getUsageSummary();

    expect(summary.today.records).toBe(1001);
    expect(summary.today.totalTokens).toBe(1001);
    expect(summary.month.records).toBe(1001);
    expect(summary.byProvider).toEqual([
      {
        providerId: "manual",
        totalTokens: 1001,
        costUsd: 1.001,
        records: 1001,
      },
    ]);

    storage.close();
  });

  test("upserts provider status and settings", async () => {
    const storage = new SqliteStorage();
    await storage.init();

    await storage.upsertProviderStatus({
      providerId: "manual",
      name: "Manual",
      enabled: true,
      detected: true,
      lastRefreshAt: "2026-06-14T12:00:00.000Z",
    });
    await storage.updateProviderSettings("manual", {
      plan_type: "Pro",
      monthly_budget_usd: "20",
      remaining_quota: "80%",
      notes: "Manual tracking",
    });

    expect(await storage.listProviderStatus()).toEqual([
      {
        providerId: "manual",
        name: "Manual",
        enabled: true,
        detected: true,
        lastRefreshAt: "2026-06-14T12:00:00.000Z",
      },
    ]);
    expect(await storage.getProviderSettings("manual")).toEqual({
      monthly_budget_usd: "20",
      notes: "Manual tracking",
      plan_type: "Pro",
      remaining_quota: "80%",
    });

    storage.close();
  });

  test("stores and deletes provider accounts", async () => {
    const storage = new SqliteStorage();
    await storage.init();

    await storage.upsertProviderAccount({
      id: "codex:local",
      providerId: "codex",
      label: "Codex · Local",
      homePath: "~/.codex",
      enabled: true,
      sortOrder: 0,
    });
    await storage.upsertProviderAccount({
      id: "claude-code:work",
      providerId: "claude-code",
      label: "Claude · Work",
      homePath: "~/.claude-work",
      enabled: true,
      sortOrder: 0,
    });
    await storage.upsertProviderStatus({
      providerId: "claude-code:work",
      name: "Claude · Work",
      enabled: true,
      detected: false,
    });

    expect(await storage.listProviderAccounts("codex")).toEqual([
      {
        id: "codex:local",
        providerId: "codex",
        label: "Codex · Local",
        homePath: "~/.codex",
        enabled: true,
        sortOrder: 0,
      },
    ]);
    expect(await storage.listProviderAccounts()).toHaveLength(2);

    await storage.deleteProviderAccount("claude-code:work");
    await storage.deleteProviderStatus("claude-code:work");

    expect(await storage.listProviderAccounts()).toEqual([
      {
        id: "codex:local",
        providerId: "codex",
        label: "Codex · Local",
        homePath: "~/.codex",
        enabled: true,
        sortOrder: 0,
      },
    ]);
    expect(await storage.listProviderStatus()).toEqual([]);

    storage.close();
  });

  test("deletes usage records for a provider account id", async () => {
    const storage = new SqliteStorage();
    await storage.init();

    await storage.upsertUsageRecords([
      {
        id: "usage-1",
        providerId: "codex:local",
        startedAt: new Date().toISOString(),
        source: "test",
        totalTokens: 10,
        costUsd: 0.01,
      },
      {
        id: "usage-2",
        providerId: "codex",
        startedAt: new Date().toISOString(),
        source: "test",
        totalTokens: 5,
        costUsd: 0,
      },
    ]);

    await storage.deleteUsageRecordsForProvider("codex:local");
    const remaining = await storage.listUsageRecords({ limit: 100 });
    expect(remaining.map((row) => row.id)).toEqual(["usage-2"]);

    storage.close();
  });

  test("aggregates token usage by provider and model with time filters", async () => {
    const storage = new SqliteStorage();
    await storage.init();
    const now = Date.now();
    await storage.upsertUsageRecords([
      {
        id: "t1",
        providerId: "codex",
        model: "gpt-5.5",
        totalTokens: 1000,
        startedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        source: "plugin",
      },
      {
        id: "t2",
        providerId: "codex",
        model: "gpt-5.5",
        totalTokens: 500,
        startedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
        source: "plugin",
      },
      {
        id: "t3",
        providerId: "cursor",
        totalTokens: 200,
        startedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
        source: "plugin",
      },
      {
        id: "t4",
        providerId: "codex",
        model: "old-model",
        totalTokens: 9999,
        startedAt: new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(),
        source: "plugin",
      },
    ]);

    const all = await storage.getTokenUsageBreakdown();
    expect(all.totalTokens).toBe(1000 + 500 + 200 + 9999);
    expect(all.providers.find((row) => row.providerId === "codex")?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "old-model", totalTokens: 9999 }),
        expect.objectContaining({ model: "gpt-5.5", totalTokens: 1500 }),
      ]),
    );
    expect(all.providers.find((row) => row.providerId === "cursor")?.models).toEqual([
      { model: "Unknown", totalTokens: 200, records: 1 },
    ]);

    const recent = await storage.getTokenUsageBreakdown({
      from: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(recent.totalTokens).toBe(1700);
    expect(recent.providers.map((row) => row.providerId)).toEqual(["codex", "cursor"]);

    storage.close();
  });

  test("applies a to-only bound inclusive of the boundary", async () => {
    const storage = new SqliteStorage();
    await storage.init();
    const now = Date.now();
    const boundary = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    await storage.upsertUsageRecords([
      {
        id: "to1",
        providerId: "codex",
        model: "gpt-5.5",
        totalTokens: 100,
        startedAt: boundary,
        source: "plugin",
      },
      {
        id: "to2",
        providerId: "codex",
        model: "gpt-5.5",
        totalTokens: 500,
        startedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
        source: "plugin",
      },
    ]);

    const bounded = await storage.getTokenUsageBreakdown({ to: boundary });
    expect(bounded.totalTokens).toBe(100);
    expect(bounded.records).toBe(1);
    expect(bounded.providers[0].providerId).toBe("codex");

    storage.close();
  });

  test("excludes records with zero or missing total tokens", async () => {
    const storage = new SqliteStorage();
    await storage.init();
    const now = Date.now();
    await storage.upsertUsageRecords([
      {
        id: "z1",
        providerId: "codex",
        model: "gpt-5.5",
        totalTokens: 100,
        startedAt: new Date(now - 60 * 60 * 1000).toISOString(),
        source: "plugin",
      },
      {
        id: "z2",
        providerId: "codex",
        model: "gpt-5.5",
        totalTokens: 0,
        startedAt: new Date(now - 30 * 60 * 1000).toISOString(),
        source: "plugin",
      },
      {
        id: "z3",
        providerId: "cursor",
        startedAt: new Date(now - 15 * 60 * 1000).toISOString(),
        source: "plugin",
      },
    ]);

    const all = await storage.getTokenUsageBreakdown();
    expect(all.totalTokens).toBe(100);
    expect(all.records).toBe(1);
    expect(all.providers.map((row) => row.providerId)).toEqual(["codex"]);
    expect(all.providers[0].models).toEqual([{ model: "gpt-5.5", totalTokens: 100, records: 1 }]);

    storage.close();
  });

  test("replaces stale model rows inside a complete structured refresh scope", async () => {
    const storage = new SqliteStorage();
    await storage.init();
    const startedAt = "2026-08-08T00:00:00.000Z";

    await storage.upsertUsageRecords([
      {
        id: "codex-sol",
        providerId: "codex:family",
        tool: "ccusage",
        model: "gpt-5.6-sol",
        totalTokens: 100,
        startedAt,
        source: "local-log",
      },
      {
        id: "codex-unknown",
        providerId: "codex:family",
        tool: "ccusage",
        model: "Unknown",
        totalTokens: 20,
        startedAt,
        source: "local-log",
      },
    ], { replaceScopes: true });
    await storage.upsertUsageRecords([
      {
        id: "codex-sol",
        providerId: "codex:family",
        tool: "ccusage",
        model: "gpt-5.6-sol",
        totalTokens: 80,
        startedAt,
        source: "local-log",
      },
    ], { replaceScopes: true });

    const totals = await storage.getTokenUsageBreakdown();
    expect(totals).toMatchObject({ totalTokens: 80, records: 1 });
    expect(totals.providers[0]?.models).toEqual([
      { model: "gpt-5.6-sol", totalTokens: 80, records: 1 },
    ]);

    storage.close();
  });
});
