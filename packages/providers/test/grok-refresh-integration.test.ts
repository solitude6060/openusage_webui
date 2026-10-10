import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { OpenUsagePluginProvider } from "../src/index";
import { withIsolatedHome } from "./openusage-plugin-fixture-helpers";

test("one Grok transcript scan supplies spend, daily tokens and hourly tokens", async () => {
  await withIsolatedHome(async (home) => {
    const file = join(home, ".grok/sessions/work/updates.jsonl");
    const now = new Date(2026, 9, 11, 12);
    const timestamp = new Date(2026, 9, 11, 10, 15).toISOString();
    fs.mkdirSync(join(file, ".."), { recursive: true });
    const turn = JSON.stringify({
      timestamp,
      params: {
        _meta: { eventId: "shared-turn" },
        update: {
          sessionUpdate: "turn_completed",
          usage: { modelUsage: { "grok-4.7": {
            inputTokens: 100, outputTokens: 20, costUsdTicks: 10_000_000_000,
          } } },
        },
      },
    });
    fs.writeFileSync(file, `${turn}\n${turn}\n`);
    const provider = new OpenUsagePluginProvider({
      providerId: "grok", name: "Grok Build", pluginId: "grok",
      homeDir: home, env: { HOME: home }, now: () => now.toISOString(),
      scriptText: 'globalThis.__openusage_plugin = { probe: () => ({ lines: [] }) };',
    });
    const read = spyOn(fs, "readFileSync");
    try {
      const records = await provider.refresh();
      expect(read.mock.calls.filter(([path]) => path === file)).toHaveLength(1);
      expect((records[0].raw as any).lines).toContainEqual({
        type: "text", label: "Today", value: "$1.00 · 120 tokens",
      });
      const daily = records.filter((record) => record.tool === "Grok Session" && !record.endedAt);
      const hourly = records.filter((record) => record.tool === "Grok Session" && record.endedAt);
      expect(daily).toHaveLength(1);
      expect(hourly).toHaveLength(1);
      expect(hourly[0]).toMatchObject({ totalTokens: 120, costUsd: 1 });
      expect(daily[0]).toMatchObject({ totalTokens: 120, costUsd: 1 });
    } finally {
      read.mockRestore();
    }
  });
});
