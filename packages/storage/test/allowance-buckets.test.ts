import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorage } from "../src/index";
import type { UsageRecord } from "../../core/src/types";

const TAIPEI_MIDNIGHT = "2026-10-08T16:00:00.000Z";
const repoRoot = join(import.meta.dir, "../../..");

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(() => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-webui-test-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

function record(overrides: Partial<UsageRecord> & Pick<UsageRecord, "id" | "providerId" | "tool" | "source">): UsageRecord {
  return {
    model: "model",
    totalTokens: 100,
    startedAt: "2026-10-09T00:00:00.000Z",
    ...overrides,
  };
}

describe("allowance token buckets", () => {
  test("maps a ccusage day to Asia/Taipei midnight and leaves a Cursor day on UTC", async () => {
    // bun test defaults to UTC. The +08 offset is only visible when TZ=Asia/Taipei.
    if (new Date(2026, 9, 9).toISOString() !== TAIPEI_MIDNIGHT) {
      if (process.env.ALLOWANCE_BUCKET_TZ_CHILD === "1") {
        throw new Error(`TZ=Asia/Taipei did not select local midnight. Got ${new Date(2026, 9, 9).toISOString()}.`);
      }
      const child = Bun.spawn([process.execPath, "test", "packages/storage/test/allowance-buckets.test.ts"], {
        cwd: repoRoot,
        env: { ...process.env, TZ: "Asia/Taipei", ALLOWANCE_BUCKET_TZ_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error(`Taipei bucket test failed (${code})\n${stdout}\n${stderr}`);
      return;
    }

    expect(new Date(2026, 9, 9).toISOString()).toBe(TAIPEI_MIDNIGHT);

    const storage = new SqliteStorage();
    await storage.init();
    await storage.upsertUsageRecords([
      record({
        id: "ccusage-day",
        providerId: "claude-code",
        tool: "ccusage",
        source: "local-log",
        totalTokens: 382279638,
      }),
      record({
        id: "cursor-day",
        providerId: "cursor",
        tool: "Cursor Usage Event",
        source: "api",
        totalTokens: 50,
      }),
      record({
        id: "grok-day",
        providerId: "grok",
        tool: "Grok Session",
        source: "local-log",
        totalTokens: 70,
      }),
    ]);

    const rows = await storage.listPositiveTokenRows("2026-10-01T00:00:00.000Z");
    storage.close();

    const byProvider = new Map(rows.map((row) => [row.providerId, row]));
    expect(byProvider.get("claude-code")).toMatchObject({
      startedAt: "2026-10-08T16:00:00.000Z",
      bucketEnd: "2026-10-09T16:00:00.000Z",
      tokens: 382279638,
    });
    expect(byProvider.get("cursor")).toMatchObject({
      startedAt: "2026-10-09T00:00:00.000Z",
      bucketEnd: "2026-10-10T00:00:00.000Z",
      tokens: 50,
    });
    expect(byProvider.get("grok")).toMatchObject({
      startedAt: "2026-10-09T00:00:00.000Z",
      bucketEnd: "2026-10-10T00:00:00.000Z",
      tokens: 70,
    });
  });
});
