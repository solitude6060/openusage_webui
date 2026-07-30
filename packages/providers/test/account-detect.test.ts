import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProviderAccounts } from "../src/account-detect";

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
});
