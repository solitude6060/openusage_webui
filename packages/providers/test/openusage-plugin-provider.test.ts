import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OpenUsagePluginProvider, runPluginHttpRequest } from "../src/index";

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
});
