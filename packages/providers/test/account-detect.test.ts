import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyProviderHomeEnv, detectProviderAccounts } from "../src/account-detect";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("detectProviderAccounts", () => {
  test("detects codex and claude homes with credentials", () => {
    const home = mkdtempSync(join(tmpdir(), "openusage-account-detect-"));
    tempDirs.push(home);
    const codex = join(home, ".codex");
    const claude = join(home, ".claude");
    const family = join(home, ".codex-family");
    mkdirSync(codex, { recursive: true });
    mkdirSync(claude, { recursive: true });
    mkdirSync(family, { recursive: true });
    writeFileSync(join(codex, "auth.json"), "{}");
    writeFileSync(join(claude, ".credentials.json"), "{}");
    writeFileSync(join(family, "auth.json"), "{}");

    expect(
      detectProviderAccounts("codex", {
        homeDir: home,
        env: { CODEX_HOME: family },
      }).map((item) => item.homePath).sort(),
    ).toEqual([codex, family].sort());

    expect(
      detectProviderAccounts("claude-code", {
        homeDir: home,
        env: {},
      }).map((item) => item.homePath),
    ).toEqual([claude]);
  });

  test("detects cursor config dirs and antigravity cli/ide homes", () => {
    const home = mkdtempSync(join(tmpdir(), "openusage-account-detect-cursor-"));
    tempDirs.push(home);

    const cursorConfig = join(home, ".config", "Cursor");
    mkdirSync(join(cursorConfig, "User", "globalStorage"), { recursive: true });
    writeFileSync(join(cursorConfig, "User", "globalStorage", "state.vscdb"), "db");

    const agyAcct = join(home, ".agy-homes", "acct1");
    mkdirSync(join(agyAcct, ".gemini", "antigravity-cli"), { recursive: true });
    writeFileSync(
      join(agyAcct, ".gemini", "antigravity-cli", "antigravity-oauth-token"),
      JSON.stringify({ token: { access_token: "tok" } }),
    );

    const agyIde = join(home, ".config", "Antigravity");
    mkdirSync(join(agyIde, "User", "globalStorage"), { recursive: true });
    writeFileSync(join(agyIde, "User", "globalStorage", "state.vscdb"), "db");

    expect(
      detectProviderAccounts("cursor", { homeDir: home, env: {} }).map((item) => item.homePath),
    ).toEqual([cursorConfig]);

    expect(
      detectProviderAccounts("antigravity", { homeDir: home, env: {} })
        .map((item) => item.homePath)
        .sort(),
    ).toEqual([agyAcct, agyIde].sort());
  });
});

describe("applyProviderHomeEnv", () => {
  test("injects cursor config dir and antigravity cli vs ide env", () => {
    const cursorEnv: NodeJS.ProcessEnv = {};
    applyProviderHomeEnv(cursorEnv, "cursor", "/tmp/cursor-work");
    expect(cursorEnv.OPENUSAGE_CURSOR_CONFIG_DIR).toBe("/tmp/cursor-work");

    const cliEnv: NodeJS.ProcessEnv = {};
    applyProviderHomeEnv(cliEnv, "antigravity", "/tmp/.agy-homes/acct1");
    expect(cliEnv.OPENUSAGE_ANTIGRAVITY_CLI_HOME).toBe("/tmp/.agy-homes/acct1");
    expect(cliEnv.OPENUSAGE_ANTIGRAVITY_CONFIG_DIR).toBeUndefined();

    const ideEnv: NodeJS.ProcessEnv = {};
    applyProviderHomeEnv(ideEnv, "antigravity", "/tmp/.config/Antigravity");
    expect(ideEnv.OPENUSAGE_ANTIGRAVITY_CONFIG_DIR).toBe("/tmp/.config/Antigravity");
    expect(ideEnv.OPENUSAGE_ANTIGRAVITY_CLI_HOME).toBeUndefined();
  });

  test("clears sibling pin env so ambient vars cannot bleed across accounts", () => {
    const cursorEnv: NodeJS.ProcessEnv = {
      OPENUSAGE_CURSOR_STATE_DB: "/tmp/other/state.vscdb",
    };
    applyProviderHomeEnv(cursorEnv, "cursor", "/tmp/cursor-work");
    expect(cursorEnv.OPENUSAGE_CURSOR_CONFIG_DIR).toBe("/tmp/cursor-work");
    expect(cursorEnv.OPENUSAGE_CURSOR_STATE_DB).toBeUndefined();

    const ideEnv: NodeJS.ProcessEnv = {
      OPENUSAGE_ANTIGRAVITY_CLI_HOME: "/tmp/.agy-homes/other",
    };
    applyProviderHomeEnv(ideEnv, "antigravity", "/tmp/.config/Antigravity");
    expect(ideEnv.OPENUSAGE_ANTIGRAVITY_CONFIG_DIR).toBe("/tmp/.config/Antigravity");
    expect(ideEnv.OPENUSAGE_ANTIGRAVITY_CLI_HOME).toBeUndefined();

    const cliEnv: NodeJS.ProcessEnv = {
      OPENUSAGE_ANTIGRAVITY_CONFIG_DIR: "/tmp/.config/Antigravity",
    };
    applyProviderHomeEnv(cliEnv, "antigravity", "/tmp/.agy-homes/acct1");
    expect(cliEnv.OPENUSAGE_ANTIGRAVITY_CLI_HOME).toBe("/tmp/.agy-homes/acct1");
    expect(cliEnv.OPENUSAGE_ANTIGRAVITY_CONFIG_DIR).toBeUndefined();
  });
});
