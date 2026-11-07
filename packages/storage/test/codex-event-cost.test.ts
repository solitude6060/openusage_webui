import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorage } from "../src/index";
import type { UsageRecord } from "../../core/src/types";

// bun test runs in UTC, so a local day equals the UTC day here.
const FROM = "2026-10-01T00:00:00.000Z";

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(() => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-cost-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

// Two accounts whose homes share one real sessions directory.
async function sharedGroup(): Promise<SqliteStorage> {
  const storage = new SqliteStorage();
  await storage.init();
  const codexHome = join(dataDir, "codex");
  const familyHome = join(dataDir, "family");
  mkdirSync(join(codexHome, "sessions"), { recursive: true });
  mkdirSync(familyHome, { recursive: true });
  symlinkSync(join(codexHome, "sessions"), join(familyHome, "sessions"));
  await storage.upsertProviderAccount({
    id: "codex:codex", providerId: "codex", label: "Codex", homePath: codexHome, enabled: true, sortOrder: 0,
  });
  await storage.upsertProviderAccount({
    id: "codex:family", providerId: "codex", label: "Family", homePath: familyHome, enabled: true, sortOrder: 1,
  });
  return storage;
}

function daily(id: string, day: string, model: string, tokens: number, costUsd?: number, providerId = "codex:codex"): UsageRecord {
  return {
    id,
    providerId,
    tool: "ccusage",
    model,
    totalTokens: tokens,
    costUsd,
    startedAt: `${day}T00:00:00.000Z`,
    source: "local-log",
  };
}

function event(providerId: string, observedAt: string, tokens: number) {
  return {
    providerId,
    observedAt,
    tokens,
    input: tokens,
    cachedInput: 0,
    output: 0,
    planType: "plus",
    weeklyUsedPercent: 10,
    weeklyResetsAt: null,
    totalTokens: tokens,
  };
}

async function codexRows(storage: SqliteStorage) {
  return (await storage.listAllowanceTokenRows(FROM))
    .filter((row) => row.providerId.startsWith("codex"))
    .map(({ providerId, model, tokens, costUsd, startedAt }) => ({ providerId, model, tokens, costUsd, startedAt }))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.providerId.localeCompare(right.providerId));
}

test("two accounts sharing a log split one priced day by their share of event tokens", async () => {
  const storage = await sharedGroup();
  try {
    await storage.upsertUsageRecords([
      daily("d1", "2026-10-09", "gpt-6-astra", 900, 3),
      daily("d2", "2026-10-09", "gpt-6.1-sol", 100, 1),
    ]);
    await storage.upsertCodexTokenEvents([
      event("codex:codex", "2026-10-09T12:30:00.000Z", 300),
      event("codex:family", "2026-10-09T13:10:00.000Z", 100),
    ]);
    expect(await codexRows(storage)).toEqual([
      { providerId: "codex:codex", model: "All Models", tokens: 300, costUsd: 3, startedAt: "2026-10-09T12:00:00.000Z" },
      { providerId: "codex:family", model: "All Models", tokens: 100, costUsd: 1, startedAt: "2026-10-09T13:00:00.000Z" },
    ]);
  } finally {
    storage.close();
  }
});

test("identical ccusage rows held by two members of the group are counted once", async () => {
  const storage = await sharedGroup();
  try {
    await storage.upsertUsageRecords([
      daily("c1", "2026-10-11", "gpt-6-astra", 500, 2, "codex:codex"),
      daily("f1", "2026-10-11", "gpt-6-astra", 500, 2, "codex:family"),
    ]);
    await storage.upsertCodexTokenEvents([
      event("codex:codex", "2026-10-11T09:00:00.000Z", 100),
      event("codex:family", "2026-10-11T10:00:00.000Z", 100),
    ]);
    const rows = await codexRows(storage);
    expect(rows.map((row) => row.costUsd)).toEqual([1, 1]);
  } finally {
    storage.close();
  }
});

test("a day with an unpriced ccusage row leaves its event rows unpriced", async () => {
  const storage = await sharedGroup();
  try {
    await storage.upsertUsageRecords([
      daily("p1", "2026-10-10", "gpt-6-astra", 900, 3),
      daily("p2", "2026-10-10", "unknown-model", 100),
    ]);
    await storage.upsertCodexTokenEvents([
      event("codex:codex", "2026-10-10T12:30:00.000Z", 300),
      event("codex:family", "2026-10-10T13:10:00.000Z", 100),
    ]);
    expect((await codexRows(storage)).map((row) => row.costUsd)).toEqual([null, null]);
  } finally {
    storage.close();
  }
});

test("a day without event rows keeps its ccusage rows and prices", async () => {
  const storage = await sharedGroup();
  try {
    await storage.upsertUsageRecords([
      daily("q1", "2026-10-08", "gpt-6-astra", 900, 3),
      daily("q2", "2026-10-09", "gpt-6-astra", 400, 2),
    ]);
    await storage.upsertCodexTokenEvents([event("codex:family", "2026-10-09T13:10:00.000Z", 100)]);
    expect(await codexRows(storage)).toEqual([
      { providerId: "codex:codex", model: "gpt-6-astra", tokens: 900, costUsd: 3, startedAt: "2026-10-08T00:00:00.000Z" },
      { providerId: "codex:family", model: "All Models", tokens: 100, costUsd: 2, startedAt: "2026-10-09T13:00:00.000Z" },
    ]);
  } finally {
    storage.close();
  }
});
