import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  discoverLanguageServerFromCommandLines,
  OpenUsagePluginProvider,
  runPluginHttpRequest,
} from "../src/index";

const pluginScript = `
(function () {
  function probe(ctx) {
    const resp = ctx.util.request({
      method: "GET",
      url: "https://example.test/usage",
      headers: { Authorization: "Bearer secret-token" },
      timeoutMs: 10000,
    });
    const data = ctx.util.tryParseJson(resp.bodyText);
    return {
      plan: data.plan,
      lines: [
        ctx.line.progress({
          label: "Session",
          used: data.used,
          limit: data.limit,
          format: { kind: "percent" },
          resetsAt: data.resetsAt,
          periodDurationMs: 18000000,
        }),
        ctx.line.text({ label: "Credits", value: data.credits }),
      ],
    };
  }

  globalThis.__openusage_plugin = { id: "copilot", probe };
})();
`;

describe("OpenUsagePluginProvider", () => {
  test("discovers Antigravity language server ports from process command lines", () => {
    expect(
      discoverLanguageServerFromCommandLines(
        [
          ["/usr/bin/other", "--extension_server_port", "1111"],
          [
            "/opt/antigravity/language_server",
            "--csrf_token",
            "csrf-value",
            "--extension_server_port=6738",
            "--workspace",
            "/tmp/antigravity-project",
          ],
        ],
        {
          processName: "language_server",
          markers: ["antigravity", "antigravity-ide"],
          csrfFlag: "--csrf_token",
          portFlag: "--extension_server_port",
        },
      ),
    ).toEqual({
      csrf: "csrf-value",
      extensionPort: 6738,
      ports: [6738],
    });
  });

  test("runs an original OpenUsage plugin and stores its lines as a usage snapshot", async () => {
    const requests: Array<{ url: string; headers?: Record<string, string> }> = [];
    const provider = new OpenUsagePluginProvider({
      providerId: "github-copilot",
      name: "GitHub Copilot",
      scriptText: pluginScript,
      now: () => "2026-06-17T08:00:00.000Z",
      request: (opts) => {
        requests.push({ url: opts.url, headers: opts.headers });
        return {
          status: 200,
          headers: {},
          bodyText: JSON.stringify({
            plan: "Pro",
            used: 37,
            limit: 100,
            credits: "$4.80",
            resetsAt: "2026-06-17T13:00:00.000Z",
          }),
        };
      },
    });

    await expect(provider.detect()).resolves.toBe(true);
    const records = await provider.refresh();

    expect(requests).toEqual([
      {
        url: "https://example.test/usage",
        headers: { Authorization: "Bearer secret-token" },
      },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      providerId: "github-copilot",
      tool: "OpenUsage Plugin Snapshot",
      model: "Pro",
      source: "api",
      startedAt: "2026-06-17T08:00:00.000Z",
      raw: {
        pluginId: "copilot",
        plan: "Pro",
        lines: [
          {
            type: "progress",
            label: "Session",
            used: 37,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: "2026-06-17T13:00:00.000Z",
            periodDurationMs: 18000000,
          },
          { type: "text", label: "Credits", value: "$4.80" },
        ],
      },
    });
    expect(records[0]?.id).toHaveLength(64);
  });

  test("runs plugin HTTP requests through curl config without putting secrets in argv", () => {
    const calls: Array<{ args: string[]; stdin: string }> = [];
    const response = runPluginHttpRequest(
      {
        method: "POST",
        url: "https://example.test/usage",
        headers: {
          Authorization: "Bearer secret-token",
          Accept: "application/json",
        },
        bodyText: JSON.stringify({ query: "usage" }),
        timeoutMs: 5000,
      },
      (args, stdin) => {
        calls.push({ args, stdin });
        return {
          exitCode: 0,
          stdout: "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Test: yes\r\n\r\n{\"ok\":true}",
          stderr: "",
        };
      },
    );

    expect(response).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-test": "yes",
      },
      bodyText: "{\"ok\":true}",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["curl", "--config", "-"]);
    expect(calls[0]?.args.join(" ")).not.toContain("secret-token");
    expect(calls[0]?.stdin).toContain('header = "Authorization: Bearer secret-token"');
    expect(calls[0]?.stdin).toContain('data-raw = "{\\"query\\":\\"usage\\"}"');
  });

  test("preserves plugin HTTP response bodies that contain blank lines", () => {
    const response = runPluginHttpRequest(
      {
        method: "GET",
        url: "https://example.test/text",
      },
      () => ({
        exitCode: 0,
        stdout: "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nfirst\n\nsecond\n",
        stderr: "",
      }),
    );

    expect(response).toEqual({
      status: 200,
      headers: {
        "content-type": "text/plain",
      },
      bodyText: "first\n\nsecond\n",
    });
  });

  test("awaits async original plugin probes", async () => {
    const provider = new OpenUsagePluginProvider({
      providerId: "synthetic",
      name: "Synthetic",
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "async",
          async probe(ctx) {
            return {
              plan: "Async",
              lines: [ctx.line.text({ label: "Mode", value: "Awaited" })],
            };
          },
        };
      `,
      now: () => "2026-06-17T13:00:00.000Z",
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({
      plan: "Async",
      lines: [{ type: "text", label: "Mode", value: "Awaited" }],
    });
  });

  test("passes host ccusage query results into original plugins", async () => {
    const provider = new OpenUsagePluginProvider({
      providerId: "codex",
      name: "Codex",
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "codex",
          probe(ctx) {
            const result = ctx.host.ccusage.query({ provider: "codex", since: "20260601" });
            return {
              plan: result.status,
              lines: [ctx.line.text({ label: "Days", value: String(result.data.daily.length) })],
            };
          },
        };
      `,
      ccusageQuery: (opts) => ({
        status: "ok",
        data: {
          daily: [{ date: opts.since, totalTokens: 42, costUSD: 0.01 }],
        },
      }),
      now: () => "2026-06-17T13:30:00.000Z",
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({
      plan: "ok",
      lines: [{ type: "text", label: "Days", value: "1" }],
    });
  });

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

  test("provides original plugin host shims for http, sqlite, nowIso, and AES-GCM crypto", async () => {
    const pluginDataDir = mkdtempSync(join(tmpdir(), "openusage-host-shim-plugin-"));
    const sqlitePath = join(pluginDataDir, "state.sqlite");
    const db = new Database(sqlitePath, { create: true });
    db.exec("CREATE TABLE tokens (name TEXT, value TEXT); INSERT INTO tokens VALUES ('alpha', 'one');");
    db.close();

    const plugin = `
      (function () {
        function probe(ctx) {
          const encrypted = ctx.host.crypto.encryptAes256Gcm("secret", "${Buffer.alloc(32, 7).toString("base64")}");
          const decrypted = ctx.host.crypto.decryptAes256Gcm(encrypted, "${Buffer.alloc(32, 7).toString("base64")}");
          const rows = ctx.util.tryParseJson(ctx.host.sqlite.query("${sqlitePath}", "SELECT value FROM tokens WHERE name = 'alpha'"));
          const resp = ctx.host.http.request({ method: "GET", url: "https://example.test/host-shim" });
          const ls = ctx.host.ls.discover({ ports: [1, 2], path: "/status" });
          return {
            plan: "Shim",
            lines: [
              ctx.line.text({ label: "Now", value: ctx.nowIso }),
              ctx.line.text({ label: "SQLite", value: rows[0].value }),
              ctx.line.text({ label: "HTTP", value: String(resp.status) }),
              ctx.line.text({ label: "Crypto", value: decrypted }),
              ctx.line.text({ label: "LS", value: String(ls) }),
            ],
          };
        }
        globalThis.__openusage_plugin = { id: "shim", probe };
      })();
    `;

    const provider = new OpenUsagePluginProvider({
      providerId: "synthetic",
      name: "Synthetic",
      scriptText: plugin,
      pluginDataDir,
      now: () => "2026-06-17T11:00:00.000Z",
      request: () => ({ status: 204, headers: {}, bodyText: "" }),
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({
      lines: [
        { type: "text", label: "Now", value: "2026-06-17T11:00:00.000Z" },
        { type: "text", label: "SQLite", value: "one" },
        { type: "text", label: "HTTP", value: "204" },
        { type: "text", label: "Crypto", value: "secret" },
        { type: "text", label: "LS", value: "null" },
      ],
    });
  });

  test("supports original plugin sqlite exec writes", async () => {
    const pluginDataDir = mkdtempSync(join(tmpdir(), "openusage-sqlite-exec-plugin-"));
    const sqlitePath = join(pluginDataDir, "state.sqlite");
    const db = new Database(sqlitePath, { create: true });
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);");
    db.close();

    const plugin = `
      (function () {
        function probe(ctx) {
          ctx.host.sqlite.exec(
            "${sqlitePath}",
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('token', 'saved')"
          );
          const rows = ctx.util.tryParseJson(
            ctx.host.sqlite.query("${sqlitePath}", "SELECT value FROM settings WHERE key = 'token'")
          );
          return {
            plan: "SQLite Exec",
            lines: [ctx.line.text({ label: "Token", value: rows[0].value })],
          };
        }
        globalThis.__openusage_plugin = { id: "sqlite-exec", probe };
      })();
    `;

    const provider = new OpenUsagePluginProvider({
      providerId: "cursor",
      name: "Cursor",
      scriptText: plugin,
      pluginDataDir,
      now: () => "2026-06-17T12:00:00.000Z",
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({
      plan: "SQLite Exec",
      lines: [{ type: "text", label: "Token", value: "saved" }],
    });
  });

  test("persists original plugin keychain writes in the local WebUI plugin directory", async () => {
    const pluginDataDir = mkdtempSync(join(tmpdir(), "openusage-keychain-plugin-"));
    const plugin = `
      (function () {
        function probe(ctx) {
          ctx.host.keychain.writeGenericPassword("cursor-access-token", "local-token");
          ctx.host.keychain.writeGenericPasswordForCurrentUser("Claude Code-credentials", "claude-token");
          const cursorToken = ctx.host.keychain.readGenericPassword("cursor-access-token");
          const claudeToken = ctx.host.keychain.readGenericPasswordForCurrentUser("Claude Code-credentials");
          ctx.host.keychain.deleteGenericPassword("cursor-access-token");
          const deletedToken = ctx.host.keychain.readGenericPassword("cursor-access-token");
          return {
            plan: "Keychain",
            lines: [
              ctx.line.text({ label: "Cursor", value: cursorToken }),
              ctx.line.text({ label: "Claude", value: claudeToken }),
              ctx.line.text({ label: "Deleted", value: String(deletedToken) }),
            ],
          };
        }
        globalThis.__openusage_plugin = { id: "keychain", probe };
      })();
    `;

    const provider = new OpenUsagePluginProvider({
      providerId: "cursor",
      name: "Cursor",
      scriptText: plugin,
      pluginDataDir,
      now: () => "2026-06-17T12:30:00.000Z",
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({
      plan: "Keychain",
      lines: [
        { type: "text", label: "Cursor", value: "local-token" },
        { type: "text", label: "Claude", value: "claude-token" },
        { type: "text", label: "Deleted", value: "null" },
      ],
    });
    expect(statSync(join(pluginDataDir, "keychain.json")).mode & 0o777).toBe(0o600);
  });

  test("tightens permissions when a local keychain shim file already exists", async () => {
    const pluginDataDir = mkdtempSync(join(tmpdir(), "openusage-keychain-mode-plugin-"));
    const keychainPath = join(pluginDataDir, "keychain.json");
    writeFileSync(keychainPath, JSON.stringify({}));
    chmodSync(keychainPath, 0o644);
    const provider = new OpenUsagePluginProvider({
      providerId: "cursor",
      name: "Cursor",
      pluginDataDir,
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "keychain-mode",
          probe(ctx) {
            ctx.host.keychain.writeGenericPassword("service", "secret");
            return { lines: [ctx.line.text({ label: "Mode", value: "Saved" })] };
          },
        };
      `,
    });

    await provider.refresh();

    expect(statSync(keychainPath).mode & 0o777).toBe(0o600);
  });

  test("rejects non-string original plugin keychain writes", async () => {
    const provider = new OpenUsagePluginProvider({
      providerId: "cursor",
      name: "Cursor",
      pluginDataDir: mkdtempSync(join(tmpdir(), "openusage-keychain-type-plugin-")),
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "keychain-type",
          probe(ctx) {
            ctx.host.keychain.writeGenericPassword("service", { token: "bad" });
            return { lines: [ctx.line.text({ label: "Mode", value: "Saved" })] };
          },
        };
      `,
    });

    await expect(provider.refresh()).rejects.toThrow("Keychain password must be a string.");
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
    ["amp", "Amp", "amp", "Amp not installed. Install Amp Code to get started."],
    ["antigravity", "Antigravity", "antigravity", "Start Antigravity or run `agy` and try again."],
    ["cursor", "Cursor", "cursor", "Not logged in. Sign in via Cursor app or run `agent login`."],
    ["devin", "Devin", "devin", "Run devin auth login or sign in to Devin and try again."],
    ["factory", "Factory", "factory", "Not logged in. Run `droid` to authenticate."],
    ["grok", "Grok", "grok", "Grok not logged in. Run `grok login`."],
    [
      "jetbrains-ai-assistant",
      "JetBrains AI Assistant",
      "jetbrains-ai-assistant",
      "JetBrains AI Assistant not detected. Open a JetBrains IDE with AI Assistant enabled.",
    ],
    ["kimi", "Kimi", "kimi", "Not logged in. Run `kimi login` to authenticate."],
    ["kiro", "Kiro", "kiro", "Open Kiro and sign in, then try again."],
    ["opencode-go", "OpenCode Go", "opencode-go", "OpenCode Go not detected. Log in with OpenCode Go or use it locally first."],
    ["perplexity", "Perplexity", "perplexity", "Not logged in. Sign in via Perplexity app."],
    ["synthetic", "Synthetic", "synthetic", "Synthetic API key not found. Set SYNTHETIC_API_KEY or add key to ~/.pi/agent/auth.json"],
    ["zai", "Z.ai", "zai", "No ZAI_API_KEY found. Set up environment variable first."],
  ] as const)(
    "runs the original %s plugin through the WebUI host shim to a stable auth/config result",
    async (providerId, name, pluginId, expectedError) => {
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

      await expect(provider.refresh()).rejects.toThrow(expectedError);
    },
  );
});
