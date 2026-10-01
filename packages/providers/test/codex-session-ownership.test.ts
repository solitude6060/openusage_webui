import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexSessionTokenDuplicateIds,
  codexSessionTokenOwnerIds,
  codexSharedSessionAccountIds,
} from "../src/codex-session-ownership";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "openusage-codex-sessions-"));
  tempDirs.push(dir);
  return dir;
}

describe("codex session token ownership", () => {
  test("keeps token rows on the real sessions directory when another home symlinks to it", () => {
    const root = tempHome();
    const codexHome = join(root, "codex");
    const familyHome = join(root, "codex-family");
    mkdirSync(join(codexHome, "sessions"), { recursive: true });
    mkdirSync(familyHome, { recursive: true });
    symlinkSync(join(codexHome, "sessions"), join(familyHome, "sessions"));

    const accounts = [
      { id: "codex:family", homePath: familyHome },
      { id: "codex:codex", homePath: codexHome },
    ];

    expect([...codexSessionTokenOwnerIds(accounts)]).toEqual(["codex:codex"]);
    expect(codexSessionTokenDuplicateIds(accounts)).toEqual(["codex:family"]);
    expect(codexSharedSessionAccountIds(accounts)).toEqual(["codex:codex", "codex:family"]);
  });

  test("records tokens for homes whose sessions directories differ", () => {
    const root = tempHome();
    const localHome = join(root, "local");
    const otherHome = join(root, "other");
    mkdirSync(join(localHome, "sessions"), { recursive: true });
    mkdirSync(join(otherHome, "sessions"), { recursive: true });

    const accounts = [
      { id: "codex:local", homePath: localHome },
      { id: "codex:other", homePath: otherHome },
    ];

    expect([...codexSessionTokenOwnerIds(accounts)].sort()).toEqual(["codex:local", "codex:other"]);
    expect(codexSessionTokenDuplicateIds(accounts)).toEqual([]);
  });

  test("still records tokens when a home has no sessions directory", () => {
    const root = tempHome();
    const home = join(root, "empty");
    mkdirSync(home, { recursive: true });

    const accounts = [{ id: "codex:empty", homePath: home }];

    expect([...codexSessionTokenOwnerIds(accounts)]).toEqual(["codex:empty"]);
    expect(codexSessionTokenDuplicateIds(accounts)).toEqual([]);
  });
});
