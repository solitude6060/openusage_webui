import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  test("preserves undefined environment masking in worker ccusage calls", async () => {
    const home = mkdtempSync(join(tmpdir(), "openusage-worker-env-"));
    const bin = join(home, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "bunx"), `#!/bin/sh
if [ "\${OPENUSAGE_WORKER_MASK+x}" = x ]; then value=99; else value=17; fi
printf '{"daily":[{"date":"2026-10-10","inputTokens":%s}]}' "$value"
`, { mode: 0o755 });
    const options = {
      providerId: "manual" as const,
      name: "Manual",
      homeDir: home,
      pluginDataDir: join(home, "plugins"),
      env: { HOME: home, PATH: bin, OPENUSAGE_WORKER_MASK: undefined },
      recordCcusageTokens: false,
      scriptText: `globalThis.__openusage_plugin = {
        probe(ctx) {
          const result = ctx.host.ccusage.query({ provider: "claude" });
          return { plan: result.status, lines: [ctx.line.text({ label: "Daily", value: JSON.stringify(result.data.daily) })] };
        },
      };`,
    };
    // Bun workers inherit startup environment rather than later process.env edits.
    const probePath = join(home, "probe.ts");
    const providerUrl = new URL("../src/providers/openusage-plugin.ts", import.meta.url).href;
    writeFileSync(probePath, `
import { OpenUsagePluginProvider } from ${JSON.stringify(providerUrl)};
if (process.env.OPENUSAGE_WORKER_MASK !== "ambient-value") throw new Error("Missing ambient fixture value");
const options = ${JSON.stringify(options)};
options.env.OPENUSAGE_WORKER_MASK = undefined;
const inThread = await new OpenUsagePluginProvider({ ...options, now: () => ${JSON.stringify(fixedNow)} }).refresh();
const worker = await new OpenUsagePluginProvider(options).refresh();
process.stdout.write(JSON.stringify({ inThread, worker }));
`);
    const proc = Bun.spawnSync([process.execPath, probePath], {
      env: { ...process.env, OPENUSAGE_WORKER_MASK: "ambient-value" },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const { inThread, worker } = JSON.parse(Buffer.from(proc.stdout).toString("utf8")) as {
      inThread: UsageRecord[]; worker: UsageRecord[];
    };
    expect(inThread[0]?.raw).toMatchObject({
      lines: [{ type: "text", label: "Daily", value: '[{"date":"2026-10-10","inputTokens":17}]' }],
    });
    expect(withoutClock(worker)).toEqual(withoutClock(inThread));
  });

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

  test("keeps an injected language-server discovery on the in-thread path", async () => {
    const calls: string[] = [];
    const provider = new OpenUsagePluginProvider({
      providerId: "manual",
      name: "Manual",
      scriptText: `globalThis.__openusage_plugin = {
        probe(ctx) {
          const found = ctx.host.ls.discover({ processName: "openusage-nonexistent-ls" });
          return { lines: [ctx.line.text({ label: "Csrf", value: String(found && found.csrf) })] };
        },
      };`,
      lsDiscover: (opts) => {
        calls.push(opts.processName ?? "");
        return { csrf: "injected-csrf", extensionPort: 1234, ports: [1234] };
      },
    });

    const records = await provider.refresh();

    expect(calls).toEqual(["openusage-nonexistent-ls"]);
    expect(records[0]?.raw).toMatchObject({
      lines: [{ type: "text", label: "Csrf", value: "injected-csrf" }],
    });
  });
});
