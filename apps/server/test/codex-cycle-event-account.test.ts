import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestHandler } from "../src/index";
import { SqliteStorage } from "../../../packages/storage/src/index";

let dataDir = "";
let homeRoot = "";
let previousDataDir: string | undefined;

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (homeRoot) rmSync(homeRoot, { recursive: true, force: true });
});

test("a symlink Codex account with event rows is not shared-log in span=cycles", async () => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-cycle-events-"));
  homeRoot = mkdtempSync(join(tmpdir(), "openusage-codex-cycle-homes-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;

  const codexHome = join(homeRoot, "codex");
  const familyHome = join(homeRoot, "family");
  mkdirSync(join(codexHome, "sessions"), { recursive: true });
  mkdirSync(familyHome, { recursive: true });
  symlinkSync(join(codexHome, "sessions"), join(familyHome, "sessions"));

  const storage = new SqliteStorage();
  await storage.init();
  await storage.upsertProviderAccount({
    id: "codex:codex",
    providerId: "codex",
    label: "Codex",
    homePath: codexHome,
    enabled: true,
    sortOrder: 0,
  });
  await storage.upsertProviderAccount({
    id: "codex:family",
    providerId: "codex",
    label: "Codex Family",
    homePath: familyHome,
    enabled: true,
    sortOrder: 1,
  });

  const reset = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const week = 7 * 24 * 60 * 60 * 1000;
  const inside = reset - 4 * 24 * 60 * 60 * 1000;
  await storage.insertQuotaObservations([
    observation("codex:codex", reset, week),
    observation("codex:family", reset, week),
  ]);
  await storage.upsertUsageRecords([
    tokens("codex:codex", inside, 200, 2),
    tokens("codex:family", inside, 40, 1),
  ]);
  await storage.upsertCodexTokenEvents([{
    providerId: "codex:family",
    observedAt: new Date(inside).toISOString(),
    tokens: 40,
    input: 40,
    cachedInput: 0,
    output: 0,
    planType: "plus",
    weeklyUsedPercent: 40,
    weeklyResetsAt: new Date(reset).toISOString(),
    totalTokens: 40,
  }]);

  const handle = createRequestHandler(storage, { host: "127.0.0.1", port: 6736 }, undefined, []);
  const response = await handle(new Request("http://127.0.0.1:6736/api/usage/allowance?span=cycles"));
  expect(response.status).toBe(200);
  const body = await response.json() as {
    span: string;
    summaries: Array<{
      providerId: string;
      cycles: Array<{ included: boolean; exclusion: string | null }>;
    }>;
  };
  expect(body.span).toBe("cycles");
  const family = body.summaries.find((item) => item.providerId === "codex:family");
  expect(family?.cycles[0]).toEqual(expect.objectContaining({
    included: true,
    exclusion: null,
  }));
  storage.close();
});

function observation(providerId: string, resetMs: number, periodMs: number) {
  return {
    providerId,
    observedAt: new Date(resetMs - 12 * 60 * 60 * 1000).toISOString(),
    windowKey: "weekly",
    windowLabel: "Weekly",
    periodMs,
    resetsAt: new Date(resetMs).toISOString(),
    present: true,
    usedPercent: 40,
    limitValue: null,
    limitUnit: null,
    usedValue: null,
  };
}

function tokens(providerId: string, startedMs: number, totalTokens: number, costUsd: number) {
  const startedAt = new Date(startedMs).toISOString();
  return {
    id: `cycle-${providerId}-${startedAt}`,
    providerId,
    tool: "Grok Session",
    model: "model",
    totalTokens,
    costUsd,
    startedAt,
    source: "plugin" as const,
  };
}
