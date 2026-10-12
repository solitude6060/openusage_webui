import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAllowanceEstimates } from "../src/quota-history";
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

function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test("Codex event rows replace the shared daily log for both accounts", async () => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-allowance-"));
  homeRoot = mkdtempSync(join(tmpdir(), "openusage-codex-allowance-homes-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;

  const codexHome = join(homeRoot, "codex");
  const familyHome = join(homeRoot, "family");
  mkdirSync(join(codexHome, "sessions"), { recursive: true });
  mkdirSync(familyHome, { recursive: true });
  symlinkSync(join(codexHome, "sessions"), join(familyHome, "sessions"));

  const dayStart = new Date(2026, 9, 9, 0, 0, 0, 0);
  const dayEnd = new Date(2026, 9, 10, 0, 0, 0, 0);
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const resetsAt = new Date(dayStart.getTime() + weekMs).toISOString();
  const now = new Date(dayEnd.getTime() + 60 * 60 * 1000);

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
  await storage.insertQuotaObservations([
    observation("codex:codex", "session", "Session", dayStart, 10, resetsAt, weekMs),
    observation("codex:codex", "session", "Session", dayEnd, 20, resetsAt, weekMs),
    observation("codex:family", "weekly", "Weekly", dayStart, 10, resetsAt, weekMs),
    observation("codex:family", "weekly", "Weekly", dayEnd, 20, resetsAt, weekMs),
  ]);
  await storage.upsertUsageRecords([{
    id: "mixed-daily",
    providerId: "codex:codex",
    tool: "ccusage",
    model: "gpt-5.6-sol",
    totalTokens: 999_999,
    startedAt: `${localDate(dayStart)}T12:00:00.000Z`,
    source: "local-log",
  }]);
  await storage.upsertCodexTokenEvents?.([
    event("codex:codex", new Date(2026, 9, 9, 12, 30, 0, 0), 100, 100),
    event("codex:family", new Date(2026, 9, 9, 12, 40, 0, 0), 40, 40),
  ]);

  const result = await loadAllowanceEstimates(storage, 7, now);
  expect(result.estimates.map((estimate) => ({
    providerId: estimate.providerId,
    reason: estimate.reason,
    tokens: estimate.tokens,
    models: estimate.models,
  }))).toEqual([
    {
      providerId: "codex:codex",
      reason: "ok",
      tokens: 100,
      models: [{ model: "All Models", tokens: 100 }],
    },
    {
      providerId: "codex:family",
      reason: "ok",
      tokens: 40,
      models: [{ model: "All Models", tokens: 40 }],
    },
  ]);
  expect((await storage.listUsageRecords({ providerId: "codex:codex" })).map((row) => row.id)).toEqual(["mixed-daily"]);
  storage.close();
});

function observation(
  providerId: string,
  windowKey: string,
  windowLabel: string,
  at: Date,
  usedPercent: number,
  resetsAt: string,
  periodMs: number,
) {
  return {
    providerId,
    observedAt: at.toISOString(),
    windowKey,
    windowLabel,
    periodMs,
    resetsAt,
    present: true,
    usedPercent,
    limitValue: null,
    limitUnit: null,
    usedValue: null,
  };
}

function event(providerId: string, at: Date, tokens: number, totalTokens: number) {
  return {
    providerId,
    observedAt: at.toISOString(),
    tokens,
    input: tokens,
    cachedInput: 0,
    output: 0,
    planType: providerId === "codex:family" ? "plus" : "prolite",
    weeklyUsedPercent: providerId === "codex:family" ? 4 : 12,
    weeklyResetsAt: null,
    totalTokens,
  };
}
