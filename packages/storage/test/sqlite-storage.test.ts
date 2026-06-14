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

  test("upserts provider status and settings", async () => {
    const storage = new SqliteStorage();
    await storage.init();

    await storage.upsertProviderStatus({
      providerId: "minimax",
      name: "MiniMax",
      enabled: true,
      detected: true,
      lastRefreshAt: "2026-06-14T12:00:00.000Z",
    });
    await storage.updateProviderSettings("minimax", {
      plan_type: "Pro",
      monthly_budget_usd: "20",
      remaining_quota: "80%",
      notes: "Manual tracking",
    });

    expect(await storage.listProviderStatus()).toEqual([
      {
        providerId: "minimax",
        name: "MiniMax",
        enabled: true,
        detected: true,
        lastRefreshAt: "2026-06-14T12:00:00.000Z",
      },
    ]);
    expect(await storage.getProviderSettings("minimax")).toEqual({
      monthly_budget_usd: "20",
      notes: "Manual tracking",
      plan_type: "Pro",
      remaining_quota: "80%",
    });

    storage.close();
  });
});
