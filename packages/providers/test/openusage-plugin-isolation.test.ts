import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { OpenUsagePluginProvider } from "../src/index";

describe("OpenUsagePluginProvider isolation behavior", () => {
  test("expands plugin ccusage home paths against configured homeDir", async () => {
    const home = mkdtempSync(join(tmpdir(), "openusage-ccusage-home-"));
    const capturedEnv: Array<Record<string, string | undefined> | undefined> = [];
    const provider = new OpenUsagePluginProvider({
      providerId: "codex",
      name: "Codex",
      pluginId: "codex",
      homeDir: home,
      ccusageRunner: (_command, _args, env) => {
        capturedEnv.push(env);
        return {
          exitCode: 0,
          stdout: '{"daily":[]}',
          stderr: "",
        };
      },
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "codex",
          probe(ctx) {
            const result = ctx.host.ccusage.query({ provider: "codex", homePath: "~/codex-home" });
            return { plan: result.status, lines: [ctx.line.text({ label: "Status", value: result.status })] };
          },
        };
      `,
    });

    await provider.refresh();

    expect(capturedEnv[0]?.CODEX_HOME).toBe(join(home, "codex-home"));
  });

  test("prefers locally saved GitHub keychain token before environment fallback", async () => {
    const pluginDataDir = mkdtempSync(join(tmpdir(), "openusage-gh-local-env-keychain-"));
    const provider = new OpenUsagePluginProvider({
      providerId: "github-copilot",
      name: "GitHub Copilot",
      pluginDataDir,
      env: { GH_TOKEN: "env-gh-token" },
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "gh-local-env",
          probe(ctx) {
            ctx.host.keychain.writeGenericPassword("gh:github.com", "local-gh-token");
            const token = ctx.host.keychain.readGenericPassword("gh:github.com");
            return { lines: [ctx.line.text({ label: "Token", value: token })] };
          },
        };
      `,
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({
      lines: [{ type: "text", label: "Token", value: "local-gh-token" }],
    });
  });

  test("falls back to environment GitHub token when local keychain entry is blank", async () => {
    const originalSpawnSync = Bun.spawnSync;
    const pluginDataDir = mkdtempSync(join(tmpdir(), "openusage-gh-blank-local-keychain-"));
    (Bun as unknown as { spawnSync: typeof Bun.spawnSync }).spawnSync = (() => {
      throw new Error("gh CLI should not be used when GH_TOKEN is available");
    }) as typeof Bun.spawnSync;
    try {
      const provider = new OpenUsagePluginProvider({
        providerId: "github-copilot",
        name: "GitHub Copilot",
        pluginDataDir,
        env: { GH_TOKEN: "env-gh-token" },
        scriptText: `
          globalThis.__openusage_plugin = {
            id: "gh-blank-local",
            probe(ctx) {
              ctx.host.keychain.writeGenericPassword("gh:github.com", "   ");
              const token = ctx.host.keychain.readGenericPassword("gh:github.com");
              return { lines: [ctx.line.text({ label: "Token", value: token })] };
            },
          };
        `,
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        lines: [{ type: "text", label: "Token", value: "env-gh-token" }],
      });
    } finally {
      (Bun as unknown as { spawnSync: typeof Bun.spawnSync }).spawnSync = originalSpawnSync;
    }
  });

  test("runs GitHub CLI token lookup with configured homeDir environment", async () => {
    const originalSpawnSync = Bun.spawnSync;
    const home = mkdtempSync(join(tmpdir(), "openusage-gh-home-"));
    const capturedEnv: Array<Record<string, string | undefined> | undefined> = [];
    (Bun as unknown as { spawnSync: typeof Bun.spawnSync }).spawnSync = ((_args, opts) => {
      capturedEnv.push(opts?.env);
      return {
        exitCode: 0,
        stdout: Buffer.from("gh-cli-token\n"),
        stderr: Buffer.from(""),
      };
    }) as typeof Bun.spawnSync;
    try {
      const provider = new OpenUsagePluginProvider({
        providerId: "github-copilot",
        name: "GitHub Copilot",
        homeDir: home,
        scriptText: `
          globalThis.__openusage_plugin = {
            id: "gh-env",
            probe(ctx) {
              const token = ctx.host.keychain.readGenericPassword("gh:github.com");
              return { lines: [ctx.line.text({ label: "Token", value: token })] };
            },
          };
        `,
      });

      await provider.refresh();
    } finally {
      (Bun as unknown as { spawnSync: typeof Bun.spawnSync }).spawnSync = originalSpawnSync;
    }

    expect(capturedEnv[0]?.HOME).toBe(home);
  });

  test("prefers locally saved GitHub keychain token before gh CLI fallback", async () => {
    const originalSpawnSync = Bun.spawnSync;
    const pluginDataDir = mkdtempSync(join(tmpdir(), "openusage-gh-local-keychain-"));
    (Bun as unknown as { spawnSync: typeof Bun.spawnSync }).spawnSync = (() => ({
      exitCode: 0,
      stdout: Buffer.from("gh-cli-token\n"),
      stderr: Buffer.from(""),
    })) as typeof Bun.spawnSync;
    try {
      const provider = new OpenUsagePluginProvider({
        providerId: "github-copilot",
        name: "GitHub Copilot",
        pluginDataDir,
        scriptText: `
          globalThis.__openusage_plugin = {
            id: "gh-local",
            probe(ctx) {
              ctx.host.keychain.writeGenericPassword("gh:github.com", "local-gh-token");
              const token = ctx.host.keychain.readGenericPassword("gh:github.com");
              return { lines: [ctx.line.text({ label: "Token", value: token })] };
            },
          };
        `,
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        lines: [{ type: "text", label: "Token", value: "local-gh-token" }],
      });
    } finally {
      (Bun as unknown as { spawnSync: typeof Bun.spawnSync }).spawnSync = originalSpawnSync;
    }
  });

  test("ignores blank configured homeDir values", async () => {
    const provider = new OpenUsagePluginProvider({
      providerId: "synthetic",
      name: "Synthetic",
      homeDir: "   ",
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "blank-home",
          probe(ctx) {
            return { lines: [ctx.line.text({ label: "AppData", value: ctx.app.appDataDir })] };
          },
        };
      `,
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({
      lines: [{ type: "text", label: "AppData", value: join(process.env.HOME?.trim() || homedir(), ".openusage-webui") }],
    });
  });
});
