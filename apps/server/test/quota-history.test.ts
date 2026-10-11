import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestHandler } from "../src/index";
import { backfillQuotaObservations, loadAllowanceEstimates, loadQuotaDashboard, recordQuotaFromRefresh } from "../src/quota-history";
import { SqliteStorage } from "../../../packages/storage/src/index";

let dataDir = "";
let previousDataDir: string | undefined;
let previousAllowedHosts: string | undefined;

beforeEach(() => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  previousAllowedHosts = process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-quota-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  delete process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  if (previousAllowedHosts === undefined) delete process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS;
  else process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS = previousAllowedHosts;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("backfill keeps percent changes and the quota API returns the latest window", async () => {
  const storage = new SqliteStorage();
  await storage.init();
  await storage.upsertUsageRecords([
    snapshot("claude-code", "2026-09-20T00:00:00.000Z", 10),
    snapshot("claude-code", "2026-09-20T01:00:00.000Z", 10.2),
    snapshot("claude-code", "2026-09-20T02:00:00.000Z", 12),
  ]);

  expect(await backfillQuotaObservations(storage)).toBe(3);
  expect(await backfillQuotaObservations(storage)).toBe(0);

  const handle = createRequestHandler(storage, { host: "127.0.0.1", port: 6736 }, undefined, []);
  const response = await handle(new Request("http://127.0.0.1:6736/api/usage/quotas"));
  expect(response.status).toBe(200);
  const body = await response.json() as {
    windows: Array<{ windowKey: string; usedPercent: number }>;
    failures: unknown[];
  };
  expect(body.windows).toEqual([
    expect.objectContaining({ windowKey: "weekly", usedPercent: 12 }),
  ]);
  expect(body.failures).toEqual([]);
  storage.close();
});

test("refresh preserves a fractional fall followed by recovery for allowance", async () => {
  const storage = new SqliteStorage();
  await storage.init();
  for (const [at, percent] of [
    ["2026-09-23T00:00:00.000Z", 10],
    ["2026-09-23T01:00:00.000Z", 9.5],
    ["2026-09-23T02:00:00.000Z", 20],
  ] as const) await recordQuotaFromRefresh(storage, "grok", [snapshot("grok", at, percent)]);
  await storage.upsertUsageRecords([{ id: "event", providerId: "grok", tool: "Event", source: "local-log", startedAt: "2026-09-23T01:30:00.000Z", totalTokens: 100, costUsd: 1 }]);
  const result = await loadAllowanceEstimates(storage, 7, new Date("2026-09-24T00:00:00.000Z"));
  expect(result.estimates[0]).toMatchObject({ reason: "meter-fell", estimatedAllowance: null, estimatedApiCost: null });
  storage.close();
});

test("versioned backfill restores fractional changes after an earlier completed replay", async () => {
  const storage = new SqliteStorage();
  await storage.init();
  await storage.setAppMeta("quota_backfill_v1", "done");
  await storage.upsertUsageRecords([
    snapshot("grok", "2026-09-23T00:00:00.000Z", 10),
    snapshot("grok", "2026-09-23T01:00:00.000Z", 10.5),
    { id: "event", providerId: "grok", tool: "Event", source: "local-log", startedAt: "2026-09-23T00:30:00.000Z", totalTokens: 100, costUsd: 0 },
  ]);
  expect(await backfillQuotaObservations(storage)).toBe(2);
  expect(await backfillQuotaObservations(storage)).toBe(0);
  expect(await storage.listQuotaObservationsSince("2026-09-23T00:00:00.000Z")).toHaveLength(2);
  const result = await loadAllowanceEstimates(storage, 7, new Date("2026-09-24T00:00:00.000Z"));
  expect(result.estimates[0]).toMatchObject({ reason: "ok", coarse: true, estimatedAllowance: 20000, estimatedApiCost: 0 });
  storage.close();
});

test("backfill preserves a fractional fall and keeps existing observations", async () => {
  const storage = new SqliteStorage();
  await storage.init();
  const first = snapshot("grok", "2026-09-23T00:00:00.000Z", 10);
  await recordQuotaFromRefresh(storage, "grok", [first]);
  await storage.setAppMeta("quota_backfill_v1", "done");
  await storage.upsertUsageRecords([
    first,
    snapshot("grok", "2026-09-23T01:00:00.000Z", 9.5),
    snapshot("grok", "2026-09-23T02:00:00.000Z", 20),
    { id: "event", providerId: "grok", source: "local-log", startedAt: "2026-09-23T01:30:00.000Z", totalTokens: 100 },
  ]);
  await backfillQuotaObservations(storage);
  expect(await storage.listQuotaObservationsSince("2026-09-23T00:00:00.000Z")).toHaveLength(3);
  const result = await loadAllowanceEstimates(storage, 7, new Date("2026-09-24T00:00:00.000Z"));
  expect(result.estimates[0]).toMatchObject({ reason: "meter-fell", estimatedAllowance: null });
  storage.close();
});

test("allowance endpoint estimates a pool from tokens and meter movement", async () => {
  const storage = new SqliteStorage();
  await storage.init();
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const resetsAt = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();
  await storage.insertQuotaObservations([
    {
      providerId: "grok",
      observedAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
      windowKey: "weekly",
      windowLabel: "Weekly",
      periodMs: week,
      resetsAt,
      present: true,
      usedPercent: 10,
      limitValue: null,
      limitUnit: null,
      usedValue: null,
    },
    {
      providerId: "grok",
      observedAt: new Date(now - 60 * 1000).toISOString(),
      windowKey: "weekly",
      windowLabel: "Weekly",
      periodMs: week,
      resetsAt,
      present: true,
      usedPercent: 30,
      limitValue: null,
      limitUnit: null,
      usedValue: null,
    },
  ]);
  await storage.upsertUsageRecords([{
    id: "allowance-token",
    providerId: "grok",
    model: "grok-4.7-build",
    totalTokens: 200,
    costUsd: 2,
    startedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    source: "plugin",
  }]);

  const handle = createRequestHandler(storage, { host: "127.0.0.1", port: 6736 }, undefined, []);
  const rejected = await handle(new Request("http://127.0.0.1:6736/api/usage/allowance?days=2"));
  expect(rejected.status).toBe(400);

  const response = await handle(new Request("http://127.0.0.1:6736/api/usage/allowance?days=7"));
  expect(response.status).toBe(200);
  const body = await response.json() as {
    span: string;
    days: number;
    estimates: Array<{ estimatedAllowance: number; tokens: number; reason: string }>;
  };
  expect(body.days).toBe(7);
  expect(body.span).toBe("7d");
  expect(body.estimates).toEqual([
    expect.objectContaining({
      tokens: 200,
      estimatedAllowance: 1000,
      apiCost: 2,
      estimatedApiCost: 10,
      reason: "ok",
    }),
  ]);

  const month = await handle(new Request("http://127.0.0.1:6736/api/usage/allowance?span=month"));
  const period = await handle(new Request("http://127.0.0.1:6736/api/usage/allowance?span=period"));
  const previous = await handle(new Request("http://127.0.0.1:6736/api/usage/allowance?span=previous"));
  const days30 = await handle(new Request("http://127.0.0.1:6736/api/usage/allowance?days=30"));
  const rejectedSpan = await handle(new Request("http://127.0.0.1:6736/api/usage/allowance?span=year"));
  expect(month.status).toBe(200);
  expect(period.status).toBe(200);
  expect(previous.status).toBe(200);
  expect(days30.status).toBe(200);
  expect(rejectedSpan.status).toBe(400);
  expect(((await month.json()) as { span: string }).span).toBe("month");
  expect(((await period.json()) as { span: string }).span).toBe("period");
  expect(((await days30.json()) as { days: number }).days).toBe(30);
  storage.close();
});

test("allowance reports unaligned daily totals instead of borrowing boundary usage", async () => {
  const storage = new SqliteStorage();
  await storage.init();
  const week = 7 * 24 * 60 * 60 * 1000;
  const resetsAt = "2026-10-04T17:00:00.000Z";
  await storage.insertQuotaObservations([
    observation("2026-09-28T18:00:00.000Z", 7, week, resetsAt),
    observation("2026-09-29T04:00:00.000Z", 8, week, resetsAt),
    observation("2026-09-30T03:00:00.000Z", 12, week, resetsAt),
  ]);
  await storage.upsertUsageRecords([
    tokenRow("2026-09-29T00:00:00.000Z", 68),
    tokenRow("2026-09-30T00:00:00.000Z", 7),
  ]);

  const body = await loadAllowanceEstimates(storage, 1, new Date("2026-09-30T04:00:00.000Z"));
  expect(body.estimates).toEqual([
    expect.objectContaining({
      from: "2026-09-29T04:00:00.000Z",
      percentStart: 8,
      percentEnd: 12,
      tokens: 0,
      estimatedAllowance: null,
      reason: "unaligned",
    }),
  ]);
  storage.close();
});

test("allowance aligns mid-hour readings to the hour boundaries that sit between equal readings", async () => {
  const storage = new SqliteStorage();
  await storage.init();
  const week = 7 * 24 * 60 * 60 * 1000;
  const resetsAt = "2026-10-14T00:00:00.000Z";
  await storage.insertQuotaObservations([
    observation("2026-10-09T10:50:00.000Z", 10, week, resetsAt),
    observation("2026-10-09T11:30:00.000Z", 10, week, resetsAt),
    observation("2026-10-09T12:30:00.000Z", 15, week, resetsAt),
    observation("2026-10-09T13:40:00.000Z", 20, week, resetsAt),
    observation("2026-10-09T14:20:00.000Z", 20, week, resetsAt),
  ]);
  const hourRow = (hour: number, totalTokens: number) => {
    const startedAt = `2026-10-09T${String(hour).padStart(2, "0")}:00:00.000Z`;
    return {
      ...tokenRow(startedAt, totalTokens),
      id: `allowance-hour-${hour}`,
      endedAt: new Date(Date.parse(startedAt) + 3600000).toISOString(),
    };
  };
  await storage.upsertUsageRecords([
    // The same day as one daily row: its only boundaries are midnights, so daily rows cannot align.
    tokenRow("2026-10-09T00:00:00.000Z", 710),
    hourRow(10, 50),
    hourRow(11, 100),
    hourRow(12, 200),
    hourRow(13, 300),
    hourRow(14, 60),
  ]);

  const body = await loadAllowanceEstimates(storage, 7, new Date("2026-10-10T12:00:00.000Z"));
  expect(body.estimates).toEqual([
    expect.objectContaining({
      from: "2026-10-09T11:00:00.000Z",
      to: "2026-10-09T14:00:00.000Z",
      percentStart: 10,
      percentEnd: 20,
      tokens: 600,
      estimatedAllowance: 6000,
      reason: "ok",
    }),
  ]);
  storage.close();
});

test("keeps a Codex 7-day Session history on the Weekly quota window", async () => {
  const storage = new SqliteStorage();
  await storage.init();
  const week = 7 * 24 * 60 * 60 * 1000;
  await storage.insertQuotaObservations([
    {
      providerId: "codex:codex",
      observedAt: "2026-09-26T00:00:00.000Z",
      windowKey: "session",
      windowLabel: "Session",
      periodMs: week,
      resetsAt: "2026-09-27T00:00:00.000Z",
      present: true,
      usedPercent: 80,
      limitValue: null,
      limitUnit: null,
      usedValue: null,
    },
    {
      providerId: "codex:codex",
      observedAt: "2026-10-03T00:00:00.000Z",
      windowKey: "weekly",
      windowLabel: "Weekly",
      periodMs: week,
      resetsAt: "2026-10-04T00:00:00.000Z",
      present: true,
      usedPercent: 40,
      limitValue: null,
      limitUnit: null,
      usedValue: null,
    },
    {
      providerId: "codex:family",
      observedAt: "2026-10-03T00:00:00.000Z",
      windowKey: "session",
      windowLabel: "Session",
      periodMs: 5 * 60 * 60 * 1000,
      resetsAt: "2026-10-03T05:00:00.000Z",
      present: true,
      usedPercent: 12,
      limitValue: null,
      limitUnit: null,
      usedValue: null,
    },
  ]);

  const dashboard = await loadQuotaDashboard(storage);
  expect(dashboard.windows.filter((window) => window.providerId === "codex:codex")).toEqual([
    expect.objectContaining({
      windowKey: "weekly",
      windowLabel: "Weekly",
      usedPercent: 40,
      previous: expect.objectContaining({ usedPercent: 80 }),
    }),
  ]);
  expect(dashboard.windows.filter((window) => window.providerId === "codex:family").map((window) => window.windowKey))
    .toEqual(["session"]);

  const stored = await storage.listQuotaObservationsSince("2026-01-01T00:00:00.000Z");
  expect(stored.find((row) => row.providerId === "codex:codex" && row.usedPercent === 80)?.windowKey).toBe("session");

  await recordQuotaFromRefresh(storage, "codex:codex", [snapshot("codex:codex", "2026-10-03T06:00:00.000Z", 42)]);
  const afterRefresh = await storage.listQuotaObservationsSince("2026-01-01T00:00:00.000Z");
  expect(afterRefresh.some((row) => row.providerId === "codex:codex" && row.windowKey === "session" && row.present)).toBe(true);
  expect(afterRefresh.some((row) => row.providerId === "codex:codex" && row.windowKey === "session" && !row.present)).toBe(false);
  expect(afterRefresh.some((row) => row.providerId === "codex:codex" && row.windowKey === "weekly" && row.usedPercent === 42)).toBe(true);
  storage.close();
});

test("keeps Weekly visible when a 5-hour Session follows a 7-day Session on the same account", async () => {
  const storage = new SqliteStorage();
  await storage.init();
  const week = 7 * 24 * 60 * 60 * 1000;
  const fiveHours = 5 * 60 * 60 * 1000;
  await storage.insertQuotaObservations([
    {
      providerId: "codex:codex",
      observedAt: "2026-10-03T00:00:00.000Z",
      windowKey: "session",
      windowLabel: "Session",
      periodMs: week,
      resetsAt: "2026-10-04T00:00:00.000Z",
      present: true,
      usedPercent: 40,
      limitValue: null,
      limitUnit: null,
      usedValue: null,
    },
  ]);

  await recordQuotaFromRefresh(storage, "codex:codex", [{
    id: "snap-mixed-windows",
    providerId: "codex:codex",
    tool: "OpenUsage Plugin Snapshot",
    startedAt: "2026-10-03T01:00:00.000Z",
    source: "api" as const,
    raw: {
      lines: [
        {
          type: "progress",
          label: "Session",
          used: 12,
          limit: 100,
          format: { kind: "percent" },
          resetsAt: "2026-10-03T06:00:00.000Z",
          periodDurationMs: fiveHours,
        },
        {
          type: "progress",
          label: "Weekly",
          used: 40,
          limit: 100,
          format: { kind: "percent" },
          resetsAt: "2026-10-04T00:00:00.000Z",
          periodDurationMs: week,
        },
      ],
    },
  }]);

  const dashboard = await loadQuotaDashboard(storage);
  const windows = dashboard.windows.filter((window) => window.providerId === "codex:codex");
  expect(windows.map((window) => [window.windowKey, window.usedPercent]).sort()).toEqual([
    ["session", 12],
    ["weekly", 40],
  ]);

  const stored = await storage.listQuotaObservationsSince("2026-01-01T00:00:00.000Z");
  expect(stored.find((row) => row.usedPercent === 40 && row.observedAt === "2026-10-03T00:00:00.000Z")?.windowKey)
    .toBe("session");
  storage.close();
});

function observation(observedAt: string, usedPercent: number, periodMs: number, resetsAt: string) {
  return {
    providerId: "grok",
    observedAt,
    windowKey: "weekly",
    windowLabel: "Weekly",
    periodMs,
    resetsAt,
    present: true,
    usedPercent,
    limitValue: null,
    limitUnit: null,
    usedValue: null,
  };
}

function tokenRow(startedAt: string, totalTokens: number) {
  return {
    id: `allowance-${startedAt}`,
    providerId: "grok",
    tool: "Grok Session",
    model: "grok-4.7-build",
    totalTokens,
    startedAt,
    source: "plugin" as const,
  };
}

function snapshot(providerId: string, startedAt: string, used: number) {
  return {
    id: `snap-${startedAt}-${used}`,
    providerId,
    tool: "OpenUsage Plugin Snapshot",
    startedAt,
    source: "api" as const,
    raw: {
      lines: [{
        type: "progress",
        label: "Weekly",
        used,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: "2026-09-27T00:00:00.000Z",
        periodDurationMs: 604800000,
      }],
    },
  };
}
