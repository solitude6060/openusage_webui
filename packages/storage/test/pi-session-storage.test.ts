import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageRecord } from "../../core/src/types";
import { SqliteStorage } from "../src/index";

let storage: SqliteStorage;
let dataDir: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "pi-storage-"));
  storage = new SqliteStorage(join(dataDir, "usage.sqlite"));
  await storage.init();
});
afterEach(() => {
  storage.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function record(tool: string, costUsd: number | undefined = 2): UsageRecord {
  return { id: tool, providerId: "codex", tool, model: "gpt-6.1-sol", source: "local-log",
    startedAt: "2026-10-10T00:00:00.000Z", totalTokens: 100, costUsd };
}

describe("Pi storage consumers", () => {
  test("Pi and ccusage survive alternating scope replacements on the same provider and day", async () => {
    await storage.upsertUsageRecords([record("ccusage")], { replaceScopes: true });
    await storage.upsertUsageRecords([record("Pi Session")], { replaceScopes: true });
    await storage.upsertUsageRecords([{ ...record("ccusage"), totalTokens: 200 }], { replaceScopes: true });
    await storage.upsertUsageRecords([{ ...record("Pi Session"), totalTokens: 300 }], { replaceScopes: true });
    const rows = await storage.listUsageRecords();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.tool === "ccusage")?.totalTokens).toBe(200);
    expect(rows.find((row) => row.tool === "Pi Session")?.totalTokens).toBe(300);
  });

  test.each([true, false])("Pi cost joins the summary independently of legacy native pricing (native known: %s)", async (known) => {
    await storage.upsertUsageRecords([
      { ...record("legacy", 10), source: "cli", tool: undefined },
      { ...record("ccusage"), costUsd: known ? 4 : undefined }, record("Pi Session", 2),
    ]);
    expect((await storage.getUsageSummary()).byProvider[0]?.costUsd).toBe(known ? 6 : 12);
  });

  test("Pi costs alone never suppress native legacy CLI costs", async () => {
    await storage.upsertUsageRecords([{ ...record("legacy", 10), source: "cli", tool: undefined }, record("Pi Session", 2)]);
    expect((await storage.getUsageSummary()).byProvider[0]?.costUsd).toBe(12);
  });

  test("Allowance treats Pi as a complete local calendar day", async () => {
    await storage.upsertUsageRecords([record("Pi Session")]);
    const rows = await storage.listPositiveTokenRows("2026-10-01T00:00:00.000Z");
    expect(rows).toEqual([expect.objectContaining({ startedAt: new Date(2026, 9, 10).toISOString(),
      bucketEnd: new Date(2026, 9, 11).toISOString(), tokens: 100, costUsd: 2 })]);
  });
});
