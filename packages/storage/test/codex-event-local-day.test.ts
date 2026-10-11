import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorage } from "../src/index";

const KOLKATA_OCT_10 = "2026-10-09T18:30:00.000Z";
const repoRoot = join(import.meta.dir, "../../..");

test("a Codex event just after local midnight replaces that local day", async () => {
  if (new Date(2026, 9, 10).toISOString() !== KOLKATA_OCT_10) {
    if (process.env.CODEX_EVENT_DAY_TZ_CHILD === "1") {
      throw new Error(`TZ=Asia/Kolkata did not select local midnight. Got ${new Date(2026, 9, 10).toISOString()}.`);
    }
    const child = Bun.spawn(
      [process.execPath, "test", "packages/storage/test/codex-event-local-day.test.ts"],
      {
        cwd: repoRoot,
        env: { ...process.env, TZ: "Asia/Kolkata", CODEX_EVENT_DAY_TZ_CHILD: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`Kolkata event-day test failed (${code})\n${stdout}\n${stderr}`);
    return;
  }

  const previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  const dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-day-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  try {
    const storage = new SqliteStorage();
    await storage.init();
    await storage.upsertUsageRecords([
      {
        id: "day-09",
        providerId: "codex:codex",
        tool: "ccusage",
        model: "gpt-5.6-sol",
        totalTokens: 300,
        startedAt: "2026-10-09T00:00:00.000Z",
        source: "local-log",
      },
      {
        id: "day-10",
        providerId: "codex:codex",
        tool: "ccusage",
        model: "gpt-5.6-sol",
        totalTokens: 500,
        startedAt: "2026-10-10T00:00:00.000Z",
        source: "local-log",
      },
    ]);
    await storage.upsertCodexTokenEvents([{
      providerId: "codex:codex",
      observedAt: "2026-10-09T18:45:00.000Z",
      tokens: 100,
      input: 100,
      cachedInput: 0,
      output: 0,
      planType: "prolite",
      weeklyUsedPercent: 12,
      weeklyResetsAt: null,
      totalTokens: 100,
    }]);
    expect(await storage.listAllowanceTokenRows("2026-10-01T00:00:00.000Z")).toEqual([
      {
        providerId: "codex:codex",
        model: "All Models",
        tokens: 100,
        costUsd: null,
        startedAt: "2026-10-09T18:00:00.000Z",
        bucketEnd: "2026-10-09T19:00:00.000Z",
      },
      {
        providerId: "codex:codex",
        model: "gpt-5.6-sol",
        tokens: 300,
        costUsd: null,
        startedAt: "2026-10-08T18:30:00.000Z",
        bucketEnd: "2026-10-09T18:30:00.000Z",
      },
    ]);
    storage.close();
  } finally {
    if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
    else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
