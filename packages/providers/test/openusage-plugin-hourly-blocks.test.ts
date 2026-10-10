import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenUsagePluginProvider } from "../src/index";
import type { PluginCcusageRunner } from "../src/index";

const DAILY = JSON.stringify({
  daily: [{ date: "2026-10-09", totalTokens: 300, models: { "claude-opus-5-5": { totalTokens: 300 } } }],
});
const BLOCKS = JSON.stringify({
  blocks: [
    { startTime: "2026-10-09T03:00:00.000Z", totalTokens: 120, costUSD: 1.2, isGap: false },
    { startTime: "2026-10-09T05:00:00.000Z", totalTokens: 180, costUSD: 1.8, isGap: false },
  ],
});

type Call = { command: string; args: string[]; env: Record<string, string | undefined> };

function scriptFor(provider: "claude" | "codex"): string {
  return `
    globalThis.__openusage_plugin = {
      id: "${provider}",
      probe(ctx) {
        ctx.host.ccusage.query({ provider: "${provider}", since: "20261001", homePath: "~/account-home" });
        return { lines: [] };
      },
    };
  `;
}

function providerWith(
  providerId: "claude-code:work" | "codex",
  pluginId: "claude" | "codex",
  runner: PluginCcusageRunner,
  extra: { recordCcusageTokens?: boolean } = {},
) {
  const home = mkdtempSync(join(tmpdir(), "openusage-hourly-home-"));
  return {
    home,
    provider: new OpenUsagePluginProvider({
      providerId,
      name: providerId,
      pluginId,
      homeDir: home,
      env: {},
      ccusageRunner: runner,
      now: () => "2026-10-10T08:30:00.000Z",
      scriptText: scriptFor(pluginId),
      ...extra,
    }),
  };
}

function recordingRunner(blocks: (call: Call) => { exitCode: number; stdout: string }): { runner: PluginCcusageRunner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: PluginCcusageRunner = (command, args, env) => {
    const call = { command, args, env };
    calls.push(call);
    const result = args.includes("blocks") ? blocks(call) : { exitCode: 0, stdout: DAILY };
    return { ...result, stderr: "" };
  };
  return { runner, calls };
}

let errorSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = undefined;
});

describe("OpenUsagePluginProvider Claude hourly blocks", () => {
  test("runs blocks with the daily since and the account environment, and returns hourly records", async () => {
    const { runner, calls } = recordingRunner(() => ({ exitCode: 0, stdout: BLOCKS }));
    const { home, provider } = providerWith("claude-code:work", "claude", runner);

    const records = await provider.refresh();

    const blocksCall = calls.find((call) => call.args.includes("blocks"));
    expect(blocksCall?.args).toEqual(["ccusage", "claude", "blocks", "--json", "--session-length", "1", "--since", "20261001"]);
    expect(blocksCall?.env.CLAUDE_CONFIG_DIR).toBe(join(home, "account-home"));
    expect(records.filter((record) => record.endedAt !== undefined).map((record) => [record.model, record.totalTokens, record.startedAt])).toEqual([
      ["All Models", 120, "2026-10-09T03:00:00.000Z"],
      ["All Models", 180, "2026-10-09T05:00:00.000Z"],
    ]);
    expect(records.filter((record) => record.tool === "ccusage" && record.endedAt === undefined)).toHaveLength(1);
  });

  test("does not run blocks for Codex", async () => {
    const { runner, calls } = recordingRunner(() => ({ exitCode: 0, stdout: BLOCKS }));
    const { provider } = providerWith("codex", "codex", runner);

    const records = await provider.refresh();

    expect(calls.some((call) => call.args.includes("blocks"))).toBe(false);
    expect(records.some((record) => record.endedAt !== undefined)).toBe(false);
  });

  test("does not run blocks when ccusage token recording is off", async () => {
    const { runner, calls } = recordingRunner(() => ({ exitCode: 0, stdout: BLOCKS }));
    const { provider } = providerWith("claude-code:work", "claude", runner, { recordCcusageTokens: false });

    await provider.refresh();

    expect(calls.some((call) => call.args.includes("blocks"))).toBe(false);
  });

  test("keeps the daily records and the plugin result when blocks fail, and logs the failure", async () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const { runner } = recordingRunner(() => ({ exitCode: 1, stdout: "" }));
    const { provider } = providerWith("claude-code:work", "claude", runner);

    const records = await provider.refresh();

    expect(records[0]).toMatchObject({ tool: "OpenUsage Plugin Snapshot" });
    expect(records.filter((record) => record.tool === "ccusage")).toHaveLength(1);
    expect(records.some((record) => record.endedAt !== undefined)).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
