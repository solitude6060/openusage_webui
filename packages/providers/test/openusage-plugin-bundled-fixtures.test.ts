import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OpenUsagePluginProvider } from "../src/index";

describe("OpenUsagePluginProvider original bundled plugin fixtures", () => {
  test("adapts the original GitHub Copilot plugin state-file auth flow", async () => {
    const pluginDataDir = mkdtempSync(join(tmpdir(), "openusage-copilot-plugin-"));
    writeFileSync(join(pluginDataDir, "auth.json"), JSON.stringify({ token: "state-token" }));
    const scriptText = readFileSync(resolve(import.meta.dir, "../../../plugins/copilot/plugin.js"), "utf8");
    const requests: Array<{ url: string; authorization?: string }> = [];
    const provider = new OpenUsagePluginProvider({
      providerId: "github-copilot",
      name: "GitHub Copilot",
      scriptText,
      pluginDataDir,
      now: () => "2026-06-17T09:00:00.000Z",
      request: (opts) => {
        requests.push({ url: opts.url, authorization: opts.headers?.Authorization });
        return {
          status: 200,
          headers: {},
          bodyText: JSON.stringify({
            copilot_plan: "pro",
            quota_reset_date: "2026-07-01T00:00:00.000Z",
            quota_snapshots: {
              premium_interactions: { percent_remaining: 63 },
              chat: { percent_remaining: 80 },
            },
          }),
        };
      },
    });

    const records = await provider.refresh();

    expect(requests).toEqual([
      {
        url: "https://api.github.com/copilot_internal/user",
        authorization: "token state-token",
      },
    ]);
    expect(records[0]).toMatchObject({
      providerId: "github-copilot",
      model: "Pro",
      raw: {
        pluginId: "copilot",
        plan: "Pro",
        lines: [
          {
            type: "progress",
            label: "Premium",
            used: 37,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-07-01T00:00:00.000Z",
          },
          {
            type: "progress",
            label: "Chat",
            used: 20,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
    });
  });

  test("bridges GitHub CLI keychain reads to GH_TOKEN on Linux WebUI", async () => {
    const scriptText = readFileSync(resolve(import.meta.dir, "../../../plugins/copilot/plugin.js"), "utf8");
    const requests: Array<{ authorization?: string }> = [];
    const provider = new OpenUsagePluginProvider({
      providerId: "github-copilot",
      name: "GitHub Copilot",
      scriptText,
      env: { GH_TOKEN: "env-gh-token" },
      now: () => "2026-06-17T09:30:00.000Z",
      request: (opts) => {
        requests.push({ authorization: opts.headers?.Authorization });
        return {
          status: 200,
          headers: {},
          bodyText: JSON.stringify({
            copilot_plan: "pro",
            quota_reset_date: "2026-07-01T00:00:00.000Z",
            quota_snapshots: {
              premium_interactions: { percent_remaining: 50 },
            },
          }),
        };
      },
    });

    const records = await provider.refresh();

    expect(requests).toEqual([{ authorization: "token env-gh-token" }]);
    expect(records[0]?.raw).toMatchObject({
      pluginId: "copilot",
      plan: "Pro",
    });
  });

  test("adapts the original Claude plugin file OAuth usage flow", async () => {
    const claudeDir = mkdtempSync(join(tmpdir(), "openusage-claude-home-"));
    writeFileSync(
      join(claudeDir, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "claude-access-token",
          refreshToken: "claude-refresh-token",
          expiresAt: Date.now() + 60 * 60 * 1000,
          subscriptionType: "pro",
          rateLimitTier: "20x",
          scopes: ["user:profile"],
        },
      }),
    );
    const scriptText = readFileSync(resolve(import.meta.dir, "../../../plugins/claude/plugin.js"), "utf8");
    const requests: Array<{ url: string; authorization?: string; beta?: string }> = [];
    const provider = new OpenUsagePluginProvider({
      providerId: "claude-code",
      name: "Claude Code",
      scriptText,
      env: { CLAUDE_CONFIG_DIR: claudeDir },
      ccusageQuery: () => ({ status: "no_runner", data: null }),
      now: () => "2026-06-17T10:00:00.000Z",
      request: (opts) => {
        requests.push({
          url: opts.url,
          authorization: opts.headers?.Authorization,
          beta: opts.headers?.["anthropic-beta"],
        });
        return {
          status: 200,
          headers: {},
          bodyText: JSON.stringify({
            five_hour: {
              utilization: 42,
              resets_at: 1781683200,
            },
            seven_day: {
              utilization: 18,
              resets_at: 1782198000,
            },
          }),
        };
      },
    });

    const records = await provider.refresh();

    expect(requests).toEqual([
      {
        url: "https://api.anthropic.com/api/oauth/usage",
        authorization: "Bearer claude-access-token",
        beta: "oauth-2025-04-20",
      },
    ]);
    expect(records[0]).toMatchObject({
      providerId: "claude-code",
      model: "Pro 20x",
      raw: {
        pluginId: "claude",
        plan: "Pro 20x",
        lines: [
          {
            type: "progress",
            label: "Session",
            used: 42,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-06-17T08:00:00.000Z",
            periodDurationMs: 18000000,
          },
          {
            type: "progress",
            label: "Weekly",
            used: 18,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-06-23T07:00:00.000Z",
            periodDurationMs: 604800000,
          },
        ],
      },
    });
  });

  test("adapts the original Codex plugin CODEX_HOME auth flow", async () => {
    const codexHome = mkdtempSync(join(tmpdir(), "openusage-codex-home-"));
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify({
        tokens: {
          access_token: "codex-access-token",
          refresh_token: "codex-refresh-token",
          account_id: "acct_123",
        },
      }),
    );
    const scriptText = readFileSync(resolve(import.meta.dir, "../../../plugins/codex/plugin.js"), "utf8");
    const requests: Array<{ url: string; authorization?: string; accountId?: string }> = [];
    const provider = new OpenUsagePluginProvider({
      providerId: "codex",
      name: "Codex",
      scriptText,
      env: { CODEX_HOME: codexHome },
      ccusageQuery: () => ({ status: "no_runner", data: null }),
      now: () => "2026-06-17T10:30:00.000Z",
      request: (opts) => {
        requests.push({
          url: opts.url,
          authorization: opts.headers?.Authorization,
          accountId: opts.headers?.["ChatGPT-Account-Id"],
        });
        return {
          status: 200,
          headers: {
            "x-codex-primary-used-percent": "33",
            "x-codex-secondary-used-percent": "12",
            "x-codex-credits-balance": "7",
          },
          bodyText: JSON.stringify({
            plan_type: "pro",
            rate_limit: {
              primary_window: {
                reset_after_seconds: 3600,
              },
              secondary_window: {
                reset_after_seconds: 86400,
              },
            },
          }),
        };
      },
    });

    const records = await provider.refresh();

    expect(requests).toEqual([
      {
        url: "https://chatgpt.com/backend-api/wham/usage",
        authorization: "Bearer codex-access-token",
        accountId: "acct_123",
      },
    ]);
    expect(records[0]).toMatchObject({
      providerId: "codex",
      model: "Pro 20x",
      raw: {
        pluginId: "codex",
        plan: "Pro 20x",
        lines: [
          {
            type: "progress",
            label: "Session",
            used: 33,
            limit: 100,
            format: { kind: "percent" },
            periodDurationMs: 18000000,
          },
          {
            type: "progress",
            label: "Weekly",
            used: 12,
            limit: 100,
            format: { kind: "percent" },
            periodDurationMs: 604800000,
          },
          { type: "text", label: "Credits", value: "$0.28 · 7 credits" },
        ],
      },
    });
  });

  test.each([
    ["amp", "Amp", "amp", "Amp not installed"],
    ["antigravity", "Antigravity", "antigravity", "Start Antigravity"],
    ["cursor", "Cursor", "cursor", "Not logged in"],
    ["devin", "Devin", "devin", "devin auth login"],
    ["factory", "Factory", "factory", "Not logged in"],
    ["grok", "Grok", "grok", "Grok not logged in"],
    ["jetbrains-ai-assistant", "JetBrains AI Assistant", "jetbrains-ai-assistant", "JetBrains AI Assistant not detected"],
    ["kimi", "Kimi", "kimi", "Not logged in"],
    ["kiro", "Kiro", "kiro", "Open Kiro"],
    ["opencode-go", "OpenCode Go", "opencode-go", "OpenCode Go not detected"],
    ["perplexity", "Perplexity", "perplexity", "Not logged in"],
    ["synthetic", "Synthetic", "synthetic", "SYNTHETIC_API_KEY"],
    ["zai", "Z.ai", "zai", "ZAI_API_KEY"],
  ] as const)(
    "runs the original %s plugin through the WebUI host shim to a stable auth/config result",
    async (providerId, name, pluginId, expectedErrorFragment) => {
      const scriptText = readFileSync(resolve(import.meta.dir, "../../../plugins", pluginId, "plugin.js"), "utf8");
      const provider = new OpenUsagePluginProvider({
        providerId,
        name,
        pluginId,
        scriptText,
        env: {},
        request: () => ({ status: 500, headers: {}, bodyText: "{}" }),
        ccusageQuery: () => ({ status: "no_runner", data: null }),
      });

      await expect(provider.refresh()).rejects.toThrow(expectedErrorFragment);
    },
  );
});
