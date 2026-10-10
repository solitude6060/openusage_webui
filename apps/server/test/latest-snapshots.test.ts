import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageRecord } from "../../../packages/core/src/types";
import { SqliteStorage } from "../../../packages/storage/src/index";
import { createRequestHandler } from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function record(partial: UsageRecord): UsageRecord {
  return partial;
}

test("latest snapshots returns one qualifying row per provider behind newer rows", async () => {
  const previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  const previousAllowedHosts = process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS;
  const dataDir = mkdtempSync(join(tmpdir(), "openusage-latest-snapshots-"));
  tempDirs.push(dataDir);
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  delete process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS;
  const storage = new SqliteStorage();
  try {
    await storage.init();
    const noisy: UsageRecord[] = Array.from({ length: 101 }, (_, index) => record({
      id: `cursor-token-${index}`,
      providerId: "cursor",
      tool: "ccusage",
      totalTokens: 1,
      startedAt: new Date(Date.parse("2026-10-01T00:00:00.000Z") + index * 1000).toISOString(),
      source: "local-log",
    }));
    await storage.upsertUsageRecords([
      ...noisy,
      record({
        id: "cursor-snapshot-old",
        providerId: "cursor",
        tool: "OpenUsage Plugin Snapshot",
        startedAt: "2026-08-01T00:00:00.000Z",
        source: "api",
        raw: { lines: [{ type: "progress", label: "Total usage", used: 10, limit: 100 }] },
      }),
      record({
        id: "cursor-snapshot-new",
        providerId: "cursor",
        tool: "OpenUsage Plugin Snapshot",
        startedAt: "2026-09-01T00:00:00.000Z",
        source: "api",
        raw: { plan: "Pro", lines: [{ type: "progress", label: "Total usage", used: 42, limit: 100 }] },
      }),
      record({
        id: "claude-snapshot",
        providerId: "claude-code",
        tool: "OpenUsage Plugin Snapshot",
        startedAt: "2026-08-02T00:00:00.000Z",
        source: "api",
        raw: { lines: [{ type: "progress", label: "Session", used: 1, limit: 100 }] },
      }),
      record({
        id: "grok-quota",
        providerId: "grok",
        tool: "Grok Quota",
        startedAt: "2026-07-01T00:00:00.000Z",
        source: "api",
        raw: { quota: { used: 3, limit: 100 } },
      }),
    ]);

    const listed = await storage.listUsageRecords({ limit: 100 });
    expect(listed.some((row) => row.providerId === "claude-code")).toBe(false);

    const handle = createRequestHandler(storage, { host: "127.0.0.1", port: 6736 }, undefined, []);
    const response = await handle(new Request("http://127.0.0.1:6736/api/usage/latest-snapshots"));
    expect(response.status).toBe(200);
    const body = await response.json() as UsageRecord[];
    expect(body.map((row) => row.id).sort()).toEqual([
      "claude-snapshot",
      "cursor-snapshot-new",
      "grok-quota",
    ]);
  } finally {
    storage.close();
    if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
    else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
    if (previousAllowedHosts === undefined) delete process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS;
    else process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS = previousAllowedHosts;
  }
});
