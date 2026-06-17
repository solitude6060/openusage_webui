import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { OpenUsagePluginProvider } from "../src/index";
import { readPluginScript, requestByUrl, withIsolatedHome, writeJson } from "./openusage-plugin-fixture-helpers";

describe("OpenUsagePluginProvider original API plugin fixtures", () => {
  test("adapts the original Antigravity plugin through Cloud Code quota", async () => {
    await withIsolatedHome(async (home) => {
      const pluginDataDir = join(home, ".openusage-webui/plugins/antigravity");
      writeJson(join(pluginDataDir, "keychain.json"), {
        "gemini\u0000antigravity": "agy-keychain-token",
      });
      const provider = new OpenUsagePluginProvider({
        providerId: "antigravity",
        name: "Antigravity",
        pluginId: "antigravity",
        homeDir: home,
        pluginDataDir,
        scriptText: readPluginScript("antigravity"),
        request: requestByUrl({
          "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist": {
            paidTier: { name: "Google AI Pro" },
            cloudaicompanionProject: "projects/openusage-agy",
          },
          "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota": {
            buckets: [
              {
                modelId: "gemini-3-pro",
                quotaInfo: { remainingFraction: 0.8, resetTime: "2026-02-08T12:00:00Z" },
              },
              {
                modelId: "gemini-3-flash",
                quotaInfo: { remainingFraction: 0.6, resetTime: "2026-02-08T12:00:00Z" },
              },
              {
                modelId: "claude-sonnet-4.5",
                quotaInfo: { remainingFraction: 0.4, resetTime: "2026-02-08T12:00:00Z" },
              },
            ],
          },
        }),
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "antigravity",
        plan: "Google AI Pro",
      });
      expect((records[0]?.raw as any).lines.map((line: any) => line.label)).toEqual([
        "Gemini Pro",
        "Gemini Flash",
        "Claude",
      ]);
    });
  });

  test("adapts the original Synthetic plugin through env key and quotas API", async () => {
    const provider = new OpenUsagePluginProvider({
      providerId: "synthetic",
      name: "Synthetic",
      pluginId: "synthetic",
      scriptText: readPluginScript("synthetic"),
      env: { SYNTHETIC_API_KEY: "syn_testkey" },
      request: requestByUrl({
        "https://api.synthetic.new/v2/quotas": {
          rollingFiveHourLimit: { remaining: 450, max: 600, limited: false },
          weeklyTokenLimit: { percentRemaining: 75 },
          search: { hourly: { requests: 15, limit: 250, renewsAt: "2026-03-30T16:18:54.145Z" } },
        },
      }),
    });

    const records = await provider.refresh();

    expect((records[0]?.raw as any).lines.map((line: any) => line.label)).toEqual([
      "5h Rate Limit",
      "Mana Bar",
      "Search",
    ]);
  });

  test("adapts the original Z.ai plugin through env key and quota APIs", async () => {
    const provider = new OpenUsagePluginProvider({
      providerId: "zai",
      name: "Z.ai",
      pluginId: "zai",
      scriptText: readPluginScript("zai"),
      env: { ZAI_API_KEY: "test-key" },
      request: requestByUrl({
        "https://api.z.ai/api/biz/subscription/list": {
          data: [{ productName: "GLM Coding Max", nextRenewTime: "2026-03-12" }],
        },
        "https://api.z.ai/api/monitor/usage/quota/limit": {
          data: {
            limits: [
              { type: "TOKENS_LIMIT", unit: 3, percentage: 10, nextResetTime: 1738368000000 },
              { type: "TOKENS_LIMIT", unit: 6, percentage: 10, nextResetTime: 1738972800000 },
              { type: "TIME_LIMIT", usage: 4000, currentValue: 1095 },
            ],
          },
        },
      }),
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({
      pluginId: "zai",
      plan: "GLM Coding Max",
    });
    expect((records[0]?.raw as any).lines.map((line: any) => line.label)).toEqual([
      "Session",
      "Weekly",
      "Web Searches",
    ]);
  });
});
