import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageRecord } from "../../core/src/types";
import { SqliteStorage } from "../src/index";

let storage: SqliteStorage;
let dataDir: string;
let previousDataDir: string | undefined;
beforeEach(async () => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "cost-precedence-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  storage = new SqliteStorage();
  await storage.init();
});
afterEach(() => {
  storage.close();
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

function legacy(): UsageRecord {
  return { id: "legacy", providerId: "codex", source: "cli", costUsd: 10,
    totalTokens: 100, startedAt: new Date().toISOString(), raw: { original: "day total" } };
}
function structured(day: string, costUsd: number | undefined): UsageRecord {
  return { id: "structured", providerId: "codex:codex", tool: "ccusage", source: "local-log",
    model: "gpt-6-astra", totalTokens: 100, costUsd, startedAt: day };
}

describe("summary cost source precedence", () => {
  for (const order of ["legacy-first", "structured-first"]) {
    for (const costs of [[10], [undefined], [4, undefined], [0]] as Array<Array<number | undefined>>) {
      test(`${order} with structured costs ${JSON.stringify(costs)} counts one day cost`, async () => {
        const old = legacy();
        const records = costs.map((cost, index) => ({ ...structured(old.startedAt, cost), id: `model-${index}`, model: `model-${index}` }));
        if (order === "legacy-first") await storage.upsertUsageRecords([old]);
        await storage.upsertUsageRecords(records, { replaceScopes: true });
        if (order === "structured-first") await storage.upsertUsageRecords([old]);
        const summary = await storage.getUsageSummary();
        const expected = costs.every((cost) => cost !== undefined) ? costs.reduce<number>((sum, cost) => sum + cost!, 0) : 10;
        expect(summary.today.costUsd).toBe(expected);
        expect(summary.month.costUsd).toBe(expected);
        expect(summary.byProvider.reduce((sum, row) => sum + row.costUsd, 0)).toBe(expected);
        expect((await storage.listUsageRecords()).find((row) => row.id === "legacy"))
          .toMatchObject({ costUsd: 10, raw: { original: "day total" }, source: "cli" });
      });
    }
  }
  test("does not replace independent account costs with an unscoped legacy total", async () => {
    const old = legacy();
    await storage.upsertUsageRecords([old]);
    await storage.upsertUsageRecords([
      structured(old.startedAt, 4),
      { ...structured(old.startedAt, undefined), id: "custom", model: "custom" },
      { ...structured(old.startedAt, 7), id: "family", providerId: "codex:family" },
    ], { replaceScopes: true });
    expect((await storage.getUsageSummary()).today.costUsd).toBe(21);
  });

  test("retains costs when another configured account has no stored records yet", async () => {
    const old = legacy();
    await storage.upsertProviderAccount({ id: "codex:family", providerId: "codex", label: "Family",
      homePath: join(dataDir, "family"), enabled: true, sortOrder: 0 });
    await storage.upsertUsageRecords([old]);
    await storage.upsertUsageRecords([structured(old.startedAt, 4)], { replaceScopes: true });
    expect((await storage.getUsageSummary()).today.costUsd).toBe(14);
  });

  test("retains unrelated costs and partial costs when no legacy price exists", async () => {
    const old = legacy();
    old.costUsd = undefined;
    await storage.upsertUsageRecords([old, { ...old, id: "manual", source: "manual", costUsd: 7 }]);
    await storage.upsertUsageRecords([structured(old.startedAt, 4), {
      ...structured(old.startedAt, undefined), id: "unknown", model: "custom",
    }], { replaceScopes: true });
    expect((await storage.getUsageSummary()).today.costUsd).toBe(11);
  });
});
