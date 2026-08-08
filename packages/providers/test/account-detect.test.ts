import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyProviderHomeEnv,
  antigravityCliOauthPath,
  detectProviderAccounts,
  looksLikeAntigravityCliHome,
} from "../src/account-detect";

const tempDirs: string[] = [];

function idTokenWithEmail(email: string): string {
  const header = Buffer.from("{}").toString("base64url");
  const payload = Buffer.from(JSON.stringify({ email })).toString("base64url");
  return `${header}.${payload}.signature`;
}

function writeCliOauth(homePath: string, overrides: Record<string, unknown> = {}): void {
  mkdirSync(join(homePath, ".gemini", "antigravity-cli"), { recursive: true });
  writeFileSync(
    antigravityCliOauthPath(homePath),
    JSON.stringify({
      token: { access_token: "tok", refresh_token: "rt" },
      ...overrides,
    }),
  );
}

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

  test("detects default HOME CLI oauth and labels homes without email", () => {
    const home = mkdtempSync(join(tmpdir(), "openusage-account-detect-agy-email-"));
    tempDirs.push(home);

    writeCliOauth(home, {
      id_token: idTokenWithEmail("default@example.com"),
      token: { access_token: "tok-default", refresh_token: "rt-default" },
    });

    const acct2 = join(home, ".agy-homes", "acct2");
    writeCliOauth(acct2, {
      id_token: idTokenWithEmail("acct2@example.com"),
      token: { access_token: "tok-acct2", refresh_token: "rt-acct2" },
    });

    const detected = detectProviderAccounts("antigravity", { homeDir: home, env: {} });
    const byPath = Object.fromEntries(detected.map((item) => [item.homePath, item.label]));

    expect(byPath[home]).toBe("Antigravity · Local CLI");
    expect(byPath[acct2]).toBe("Antigravity · acct2");
  });

  test("looksLikeAntigravityCliHome prefers an existing oauth token over path shape", () => {
    const home = mkdtempSync(join(tmpdir(), "openusage-account-detect-agy-token-"));
    tempDirs.push(home);

    // Ends like an IDE home but carries a CLI oauth token → token wins.
    const ideShaped = join(home, ".config", "Antigravity IDE");
    writeCliOauth(ideShaped);
    expect(looksLikeAntigravityCliHome(ideShaped)).toBe(true);

    const plain = join(home, ".config", "Antigravity");
    expect(looksLikeAntigravityCliHome(plain)).toBe(false);
  });

  test("looksLikeAntigravityCliHome classifies real-world home shapes", () => {
    expect(looksLikeAntigravityCliHome("/home/ma/.agy-homes/acct1")).toBe(true);
    expect(looksLikeAntigravityCliHome("/home/ma/.agy-homes")).toBe(true);
    expect(looksLikeAntigravityCliHome("/home/ma/.agy-homes/acct1/.gemini/antigravity-cli")).toBe(true);

    expect(
      looksLikeAntigravityCliHome("/home/ma/AppData/Roaming/Code/User/globalStorage/antigravity.google"),
    ).toBe(false);
    expect(
      looksLikeAntigravityCliHome("/home/ma/.config/Code/User/globalStorage/antigravity.google"),
    ).toBe(false);
    expect(looksLikeAntigravityCliHome("/home/ma/.config/Antigravity")).toBe(false);
    expect(looksLikeAntigravityCliHome("/home/ma/.config/Antigravity IDE")).toBe(false);
    expect(
      looksLikeAntigravityCliHome("/home/ma/Library/Application Support/Antigravity"),
    ).toBe(false);
    expect(
      looksLikeAntigravityCliHome("/home/ma/Library/Application Support/Antigravity IDE"),
    ).toBe(false);

    expect(looksLikeAntigravityCliHome("/home/ma/.config/antigravity-cli")).toBe(true);
  });
});

describe("looksLikeAntigravityCliHome", () => {
  test("treats an existing oauth token file as CLI before any path check", () => {
    const home = mkdtempSync(join(tmpdir(), "openusage-account-detect-oauth-"));
    tempDirs.push(home);
    const ideShaped = join(home, "AppData", "Roaming", "Code", "User", "globalStorage");
    mkdirSync(join(ideShaped, ".gemini", "antigravity-cli"), { recursive: true });
    writeFileSync(
      join(ideShaped, ".gemini", "antigravity-cli", "antigravity-oauth-token"),
      "{}",
    );

    expect(looksLikeAntigravityCliHome(ideShaped)).toBe(true);
  });

  test("returns true for .agy-homes profiles including windows separators", () => {
    expect(looksLikeAntigravityCliHome("/home/ma/.agy-homes/acct1")).toBe(true);
    expect(looksLikeAntigravityCliHome("/home/ma/.agy-homes")).toBe(true);
    expect(looksLikeAntigravityCliHome("C:\\Users\\ma\\.agy-homes\\acct1")).toBe(true);
  });

  test("returns false for VS Code-family IDE homes with globalStorage", () => {
    expect(
      looksLikeAntigravityCliHome(
        "/home/ma/AppData/Roaming/Code/User/globalStorage/antigravity/state.vscdb",
      ),
    ).toBe(false);
    expect(
      looksLikeAntigravityCliHome("/home/ma/.config/Cursor/User/globalStorage/state.vscdb"),
    ).toBe(false);
  });

  test("returns false for Antigravity IDE config and macOS application support homes", () => {
    expect(looksLikeAntigravityCliHome("/home/ma/.config/Antigravity")).toBe(false);
    expect(looksLikeAntigravityCliHome("/home/ma/.config/Antigravity IDE")).toBe(false);
    expect(
      looksLikeAntigravityCliHome("/home/ma/Library/Application Support/Antigravity"),
    ).toBe(false);
    expect(
      looksLikeAntigravityCliHome(
        "/home/ma/Library/Application Support/Antigravity/User/globalStorage",
      ),
    ).toBe(false);
  });

  test("returns true for unclassified paths (default CLI fallback)", () => {
    expect(looksLikeAntigravityCliHome("/home/ma/.gemini")).toBe(true);
    expect(looksLikeAntigravityCliHome("/home/ma/whatever/state")).toBe(true);
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
