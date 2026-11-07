import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorage } from "../src/index";
import type { UsageRecord } from "../../core/src/types";

const HOUR_MS = 60 * 60 * 1000;
const TAIPEI_OCT_9 = "2026-10-08T16:00:00.000Z";
const repoRoot = join(import.meta.dir, "../../..");

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(() => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-cost-days-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

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

function ccusage(id: string, startedAt: string, tokens: number, costUsd: number, hourly = false): UsageRecord {
  return {
    id,
    providerId: "codex:codex",
    tool: "ccusage",
    model: hourly ? "All Models" : "gpt-6-astra",
    totalTokens: tokens,
    costUsd,
    startedAt,
    ...(hourly ? { endedAt: new Date(Date.parse(startedAt) + HOUR_MS).toISOString() } : {}),
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

// Sum of allocated event-hour cost per local day, from the rows Allowance reads.
async function allocatedByLocalDay(storage: SqliteStorage): Promise<Record<string, number | null>> {
  const pad = (value: number) => String(value).padStart(2, "0");
  const totals: Record<string, number | null> = {};
  for (const row of await storage.listAllowanceTokenRows("2026-10-01T00:00:00.000Z")) {
    if (!row.providerId.startsWith("codex") || row.model !== "All Models") continue;
    const date = new Date(row.startedAt);
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const previous = day in totals ? totals[day]! : 0;
    totals[day] = previous == null || row.costUsd == null ? null : previous + row.costUsd;
  }
  return totals;
}

test("hourly ccusage rows set the day cost, and the allocated sum equals it", async () => {
  const storage = await sharedGroup();
  try {
    await storage.upsertUsageRecords([
      ccusage("h1", "2026-10-09T03:00:00.000Z", 600, 1.25, true),
      ccusage("h2", "2026-10-09T15:00:00.000Z", 400, 0.5, true),
    ]);
    await storage.upsertCodexTokenEvents([
      event("codex:codex", "2026-10-09T03:20:00.000Z", 700),
      event("codex:family", "2026-10-09T15:10:00.000Z", 300),
    ]);
    const totals = await allocatedByLocalDay(storage);
    expect(Object.keys(totals)).toEqual(["2026-10-09"]);
    expect(totals["2026-10-09"]).toBeCloseTo(1.75, 10);
  } finally {
    storage.close();
  }
});

test("under Asia/Taipei, event hours take the cost of their local day", async () => {
  if (new Date(2026, 9, 9).toISOString() !== TAIPEI_OCT_9) {
    if (process.env.CODEX_EVENT_COST_TZ_CHILD === "1") {
      throw new Error(`TZ=Asia/Taipei did not select local midnight. Got ${new Date(2026, 9, 9).toISOString()}.`);
    }
    const child = Bun.spawn(
      [process.execPath, "test", "packages/storage/test/codex-event-cost-days.test.ts", "-t", "Asia/Taipei"],
      {
        cwd: repoRoot,
        env: { ...process.env, TZ: "Asia/Taipei", CODEX_EVENT_COST_TZ_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`Taipei cost test failed (${code})\n${stdout}\n${stderr}`);
    return;
  }

  const storage = await sharedGroup();
  try {
    // ccusage labels a local day with its date at UTC midnight.
    await storage.upsertUsageRecords([
      ccusage("d9", "2026-10-09T00:00:00.000Z", 1000, 4),
      ccusage("d10", "2026-10-10T00:00:00.000Z", 1000, 10),
    ]);
    await storage.upsertCodexTokenEvents([
      // 01:00 and 23:30 local on 2026-10-09.
      event("codex:codex", "2026-10-08T17:00:00.000Z", 300),
      event("codex:family", "2026-10-09T15:30:00.000Z", 100),
      // 00:30 local on 2026-10-10.
      event("codex:family", "2026-10-09T16:30:00.000Z", 50),
    ]);
    const totals = await allocatedByLocalDay(storage);
    expect(totals["2026-10-09"]).toBeCloseTo(4, 10);
    expect(totals["2026-10-10"]).toBeCloseTo(10, 10);
    const rows = (await storage.listAllowanceTokenRows("2026-10-01T00:00:00.000Z"))
      .filter((row) => row.model === "All Models")
      .map((row) => [row.providerId, row.startedAt, row.costUsd])
      .sort();
    expect(rows).toEqual([
      ["codex:codex", "2026-10-08T17:00:00.000Z", 3],
      ["codex:family", "2026-10-09T15:00:00.000Z", 1],
      ["codex:family", "2026-10-09T16:00:00.000Z", 10],
    ]);
  } finally {
    storage.close();
  }
});
