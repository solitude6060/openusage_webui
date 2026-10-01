import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildProvidersFromStorage } from "../src/provider-accounts";
import { SqliteStorage } from "../../../packages/storage/src/index";
import { OpenUsagePluginProvider } from "../../../packages/providers/src/index";

let dataDir = "";
let homeRoot = "";
let previousDataDir: string | undefined;

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (homeRoot) rmSync(homeRoot, { recursive: true, force: true });
});

test("rebuild drops duplicate Codex session token rows and stops recording them", async () => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-webui-shared-codex-"));
  homeRoot = mkdtempSync(join(tmpdir(), "openusage-codex-homes-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;

  const codexHome = join(homeRoot, "codex");
  const familyHome = join(homeRoot, "codex-family");
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
    label: "Codex-Family",
    homePath: familyHome,
    enabled: true,
    sortOrder: 1,
  });
  const startedAt = "2026-09-26T00:00:00.000Z";
  await storage.upsertUsageRecords([
    {
      id: "owner-sol",
      providerId: "codex:codex",
      tool: "ccusage",
      model: "gpt-5.6-sol",
      totalTokens: 100,
      startedAt,
      source: "local-log",
    },
    {
      id: "duplicate-sol",
      providerId: "codex:family",
      tool: "ccusage",
      model: "gpt-5.6-sol",
      totalTokens: 100,
      startedAt,
      source: "local-log",
    },
    {
      id: "family-snapshot",
      providerId: "codex:family",
      tool: "OpenUsage Plugin Snapshot",
      startedAt: "2026-09-26T01:00:00.000Z",
      source: "api",
    },
  ]);

  const providersRef = { current: [] };
  await rebuildProvidersFromStorage(storage, providersRef);

  const remaining = await storage.listUsageRecords({ limit: 20 });
  expect(remaining.map((record) => record.id).sort()).toEqual(["family-snapshot", "owner-sol"]);

  const codex = providersRef.current.find((provider) => provider.id === "codex:codex");
  const family = providersRef.current.find((provider) => provider.id === "codex:family");
  expect(codex).toBeInstanceOf(OpenUsagePluginProvider);
  expect(family).toBeInstanceOf(OpenUsagePluginProvider);
  expect((codex as OpenUsagePluginProvider).recordCcusageTokens).toBe(true);
  expect((family as OpenUsagePluginProvider).recordCcusageTokens).toBe(false);

  storage.close();
});
