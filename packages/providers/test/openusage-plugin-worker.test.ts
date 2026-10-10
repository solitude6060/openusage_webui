import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageRecord } from "../../core/src/types";
import { OpenUsagePluginProvider } from "../src/index";

const fixedNow = "2026-10-10T00:00:00.000Z";

const fixtureScript = `
globalThis.__openusage_plugin = {
  id: "fixture",
  probe(ctx) {
    return {
      plan: "Fixture",
      lines: [ctx.line.text({ label: "Source", value: "plugin" })],
    };
  },
};
`;

const errorScript = `
globalThis.__openusage_plugin = {
  id: "fixture",
  probe() {
    throw new Error("fixture plugin failed");
  },
};
`;

// Synchronous busy wait inside the plugin. The default runtime has no injected
// host functions, so this blocks whichever thread runs refresh().
const blockingScript = `
globalThis.__openusage_plugin = {
  id: "slow",
  probe() {
    const end = Date.now() + 400;
    while (Date.now() < end) {}
    return { plan: "Slow", lines: [] };
  },
};
`;

function isolatedProvider(scriptText: string, now?: () => string): OpenUsagePluginProvider {
  const home = mkdtempSync(join(tmpdir(), "openusage-plugin-worker-"));
  return new OpenUsagePluginProvider({
    providerId: "manual",
    name: "Manual",
    pluginId: "fixture",
    scriptText,
    homeDir: home,
    pluginDataDir: join(home, "plugins"),
    env: { HOME: home },
    ...(now ? { now } : {}),
  });
}

function withoutClock(records: UsageRecord[]): Array<Omit<UsageRecord, "id" | "startedAt">> {
  return records.map(({ id: _id, startedAt: _startedAt, ...record }) => record);
}

describe("OpenUsage plugin refresh off the main thread", () => {
  test("fires a main-thread timer before refresh resolves while the plugin blocks synchronously", async () => {
    const provider = isolatedProvider(blockingScript);
    let timerFiredAt: number | null = null;
    const timer = setTimeout(() => {
      timerFiredAt = performance.now();
    }, 20);

    let refreshResolvedAt: number | null = null;
    try {
      const records = await provider.refresh().then((value) => {
        refreshResolvedAt = performance.now();
        return value;
      });

      expect(timerFiredAt).not.toBeNull();
      expect(refreshResolvedAt).not.toBeNull();
      expect(timerFiredAt ?? Number.POSITIVE_INFINITY).toBeLessThan(refreshResolvedAt ?? 0);
      expect(records[0]).toMatchObject({
        providerId: "manual",
        tool: "OpenUsage Plugin Snapshot",
        model: "Slow",
        source: "api",
        raw: { pluginId: "slow", plan: "Slow", lines: [] },
      });
    } finally {
      clearTimeout(timer);
    }
  });

  test("returns the same records as the in-thread path and the same plugin error", async () => {
    const inThread = isolatedProvider(fixtureScript, () => fixedNow);
    const defaultRuntime = isolatedProvider(fixtureScript);

    expect(withoutClock(await defaultRuntime.refresh())).toEqual(withoutClock(await inThread.refresh()));

    const inThreadError = isolatedProvider(errorScript, () => fixedNow);
    const defaultRuntimeError = isolatedProvider(errorScript);
    await expect(inThreadError.refresh()).rejects.toThrow("fixture plugin failed");
    await expect(defaultRuntimeError.refresh()).rejects.toThrow("fixture plugin failed");
  });
});
