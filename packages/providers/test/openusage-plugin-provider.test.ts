import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
          let deletedToken = "not-thrown";
          try {
            ctx.host.keychain.readGenericPassword("cursor-access-token");
          } catch (error) {
            deletedToken = String(error.message || error);
          }
          let missingCurrentUserToken = "not-thrown";
          try {
            ctx.host.keychain.readGenericPasswordForCurrentUser("missing-current-user-token");
          } catch (error) {
            missingCurrentUserToken = String(error.message || error);
          }
          return {
            plan: "Keychain",
            lines: [
              ctx.line.text({ label: "Cursor", value: cursorToken }),
              ctx.line.text({ label: "Claude", value: claudeToken }),
              ctx.line.text({ label: "Deleted", value: String(deletedToken) }),
              ctx.line.text({ label: "Current User Missing", value: String(missingCurrentUserToken) }),
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
        { type: "text", label: "Deleted", value: "Keychain item not found: cursor-access-token" },
        { type: "text", label: "Current User Missing", value: "Keychain item not found: missing-current-user-token" },
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
});
