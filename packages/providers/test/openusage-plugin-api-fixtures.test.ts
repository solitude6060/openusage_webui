import { describe, expect, test } from "bun:test";
import { verify } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OpenUsagePluginProvider } from "../src/index";
import {
  createOpenSshEd25519Key,
  readPluginScript,
  requestByUrl,
  withIsolatedHome,
  writeJson,
} from "./openusage-plugin-fixture-helpers";

// Stand-in for a running Antigravity language server: the plugin's default discovery
// matches it by argv (process name, marker, csrf and extension-port flags). `read`
// is a bash builtin, so the process keeps this argv until stdin closes.
async function withFakeAntigravityLanguageServer<T>(run: () => Promise<T>): Promise<T> {
  const proc = Bun.spawn(
    [
      "bash", "-c", "read -r _",
      "language_server", "antigravity",
      "--csrf_token", "fake-csrf",
      "--extension_server_port", "54321",
    ],
    { stdin: "pipe", stdout: "ignore", stderr: "ignore" },
  );
  try {
    return await run();
  } finally {
    proc.kill();
    await proc.exited;
  }
}

describe("OpenUsagePluginProvider original API plugin fixtures", () => {
  test("adapts the original Antigravity plugin through Cloud Code quota", async () => {
    await withFakeAntigravityLanguageServer(() => withIsolatedHome(async (home) => {
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
        env: {},
        scriptText: readPluginScript("antigravity"),
        lsDiscover: () => null,
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
    }));
  });

  test("adapts the Ollama plugin through the real Ed25519 host primitive", async () => {
    await withIsolatedHome(async (home) => {
      const key = createOpenSshEd25519Key();
      mkdirSync(join(home, ".ollama"), { recursive: true });
      writeFileSync(join(home, ".ollama/id_ed25519"), key.pem, { mode: 0o600 });
      const seen: Array<{ method: string; url: string; authorization: string }> = [];
      const provider = new OpenUsagePluginProvider({
        providerId: "ollama",
        name: "Ollama",
        pluginId: "ollama",
        homeDir: home,
        env: {},
        now: () => "2023-11-14T22:13:20.000Z",
        scriptText: readPluginScript("ollama"),
        request: (opts) => {
          seen.push({ method: opts.method ?? "GET", url: opts.url, authorization: opts.headers?.Authorization ?? "" });
          const body = opts.url.startsWith("https://ollama.com/api/balance")
            ? {
                included: {
                  balance_usd: 72.5,
                  allowance_usd: 100,
                  period: { from: "2026-09-15T09:30:00Z", until: "2026-10-15T09:30:00Z" },
                },
                purchased: { balance_usd: 25 },
              }
            : { Plan: "pro" };
          return { status: 200, headers: {}, bodyText: JSON.stringify(body) };
        },
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "ollama",
        plan: "Pro",
        lines: [
          { type: "progress", label: "Monthly", used: 27.5, limit: 100 },
          { type: "text", label: "Purchased Credits", value: "$25.00" },
        ],
      });
      expect(seen.map(({ method, url }) => `${method} ${url}`)).toEqual([
        "GET https://ollama.com/api/balance?ts=1700000000",
        "POST https://ollama.com/api/me?ts=1700000000",
      ]);
      for (const call of seen) {
        const separator = call.authorization.indexOf(":");
        expect(call.authorization.slice(0, separator)).toBe(key.publicKeyBlobBase64);
        const challenge = `${call.method},${new URL(call.url).pathname}${new URL(call.url).search}`;
        const signature = Buffer.from(call.authorization.slice(separator + 1), "base64");
        expect(verify(null, Buffer.from(challenge), key.publicKey, signature)).toBe(true);
      }
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

  test("adapts the OpenRouter plugin through env key, credits and key APIs", async () => {
    const provider = new OpenUsagePluginProvider({
      providerId: "openrouter",
      name: "OpenRouter",
      pluginId: "openrouter",
      scriptText: readPluginScript("openrouter"),
      env: { OPENROUTER_API_KEY: "sk-or-v1-fixture0000000000" },
      request: requestByUrl({
        "https://openrouter.ai/api/v1/credits": { data: { total_credits: 100, total_usage: 40 } },
        "https://openrouter.ai/api/v1/key": () => ({
          status: 403,
          headers: {},
          bodyText: JSON.stringify({ error: { message: "forbidden", label: "key-name" } }),
        }),
      }),
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({ pluginId: "openrouter" });
    expect((records[0]?.raw as any).lines).toEqual([
      { type: "progress", label: "Credits", used: 40, limit: 100, format: { kind: "dollars" } },
      { type: "text", label: "Balance", value: "$60.00" },
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
