import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withIsolatedHome, writeJson } from "./openusage-plugin-fixture-helpers";

describe("OpenUsage plugin fixture helpers", () => {
  test("cleans up isolated home directories after callback completion", async () => {
    let homePath = "";

    await withIsolatedHome((home) => {
      homePath = home;
      expect(existsSync(home)).toBe(true);
    });

    expect(existsSync(homePath)).toBe(false);
  });

  test("writes JSON after creating the target parent directory", () => {
    const base = mkdtempSync(join(tmpdir(), "openusage-fixture-json-"));
    const target = join(base, "nested", "state.json");

    writeJson(target, { ok: true });

    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ ok: true });
  });
});
