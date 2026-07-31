import { describe, expect, test } from "bun:test";
import {
  buildProviderAccountId,
  isMultiAccountProviderId,
  isProviderAccountId,
  slugifyAccountLabel,
} from "../src/provider-accounts";
import { isValidProviderId } from "../src/types";

describe("provider account ids", () => {
  test("accepts multi-account provider account ids", () => {
    expect(isProviderAccountId("codex:local")).toBe(true);
    expect(isProviderAccountId("claude-code:family")).toBe(true);
    expect(isProviderAccountId("cursor:work")).toBe(true);
    expect(isProviderAccountId("antigravity:acct1")).toBe(true);
    expect(isProviderAccountId("codex")).toBe(false);
    expect(isMultiAccountProviderId("claude-code")).toBe(true);
    expect(isMultiAccountProviderId("cursor")).toBe(true);
    expect(isMultiAccountProviderId("antigravity")).toBe(true);
  });

  test("validates base providers and account instances", () => {
    expect(isValidProviderId("codex")).toBe(true);
    expect(isValidProviderId("claude-code:work")).toBe(true);
    expect(isValidProviderId("cursor:work")).toBe(true);
    expect(isValidProviderId("not-a-provider")).toBe(false);
  });

  test("builds unique account ids from labels", () => {
    expect(slugifyAccountLabel("Claude Code · Work")).toBe("work");
    expect(slugifyAccountLabel("Cursor · Work")).toBe("work");
    expect(slugifyAccountLabel("Antigravity · Acct1")).toBe("acct1");
    expect(buildProviderAccountId("claude-code", "Work", [])).toBe("claude-code:work");
    expect(buildProviderAccountId("cursor", "Work", [])).toBe("cursor:work");
    expect(buildProviderAccountId("codex", "Family", ["codex:family"])).toBe("codex:family-2");
  });
});
