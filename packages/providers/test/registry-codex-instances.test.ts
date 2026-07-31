import { describe, expect, test } from "bun:test";
import { applyProviderHomeEnv } from "../src/account-detect";
import { getProviders } from "../src/registry";

describe("getProviders provider accounts", () => {
  test("keeps single cards when no accounts are configured", () => {
    const providers = getProviders({ providerAccounts: [] });
    const ids = providers.map((provider) => provider.id);
    expect(ids.filter((id) => id === "codex" || id.startsWith("codex:"))).toEqual(["codex"]);
    expect(ids.filter((id) => id === "claude-code" || id.startsWith("claude-code:"))).toEqual([
      "claude-code",
    ]);
  });

  test("replaces bare providers with configured accounts", () => {
    const providers = getProviders({
      providerAccounts: [
        {
          id: "codex:local",
          providerId: "codex",
          label: "Codex · Local",
          homePath: "/tmp/codex-local",
          enabled: true,
          sortOrder: 0,
        },
        {
          id: "claude-code:work",
          providerId: "claude-code",
          label: "Claude · Work",
          homePath: "/tmp/claude-work",
          enabled: true,
          sortOrder: 0,
        },
      ],
    });
    expect(
      providers
        .filter((provider) => provider.id.startsWith("codex"))
        .map((provider) => ({ id: provider.id, name: provider.name })),
    ).toEqual([{ id: "codex:local", name: "Codex · Local" }]);
    expect(
      providers
        .filter((provider) => provider.id.startsWith("claude-code"))
        .map((provider) => ({ id: provider.id, name: provider.name })),
    ).toEqual([{ id: "claude-code:work", name: "Claude · Work" }]);
  });

  test("falls back to bare providers when all accounts are disabled", () => {
    const providers = getProviders({
      providerAccounts: [
        {
          id: "codex:local",
          providerId: "codex",
          label: "Codex · Local",
          homePath: "/tmp/codex-local",
          enabled: false,
          sortOrder: 0,
        },
      ],
    });
    expect(
      providers.map((provider) => provider.id).filter((id) => id === "codex" || id.startsWith("codex:")),
    ).toEqual(["codex"]);
  });

  test("fans out cursor and antigravity accounts with CLI-shaped homes", () => {
    const providers = getProviders({
      providerAccounts: [
        {
          id: "cursor:work",
          providerId: "cursor",
          label: "Cursor · Work",
          homePath: "/tmp/cursor-work",
          enabled: true,
          sortOrder: 0,
        },
        {
          id: "antigravity:acct1",
          providerId: "antigravity",
          label: "Antigravity · Acct1",
          homePath: "/tmp/.agy-homes/acct1",
          enabled: true,
          sortOrder: 0,
        },
      ],
    });
    expect(
      providers
        .filter((provider) => provider.id.startsWith("cursor"))
        .map((provider) => ({ id: provider.id, name: provider.name })),
    ).toEqual([{ id: "cursor:work", name: "Cursor · Work" }]);
    expect(
      providers
        .filter((provider) => provider.id.startsWith("antigravity"))
        .map((provider) => ({ id: provider.id, name: provider.name })),
    ).toEqual([{ id: "antigravity:acct1", name: "Antigravity · Acct1" }]);

    // Registry copies process env then applyProviderHomeEnv; assert inject classification
    // for the same homePaths the fan-out uses (CLI overlay vs Cursor config root).
    const cursorEnv: NodeJS.ProcessEnv = {
      OPENUSAGE_CURSOR_STATE_DB: "/tmp/other/state.vscdb",
    };
    applyProviderHomeEnv(cursorEnv, "cursor", "/tmp/cursor-work");
    expect(cursorEnv.OPENUSAGE_CURSOR_CONFIG_DIR).toBe("/tmp/cursor-work");
    expect(cursorEnv.OPENUSAGE_CURSOR_STATE_DB).toBeUndefined();

    const agyEnv: NodeJS.ProcessEnv = {
      OPENUSAGE_ANTIGRAVITY_CONFIG_DIR: "/tmp/.config/Antigravity",
    };
    applyProviderHomeEnv(agyEnv, "antigravity", "/tmp/.agy-homes/acct1");
    expect(agyEnv.OPENUSAGE_ANTIGRAVITY_CLI_HOME).toBe("/tmp/.agy-homes/acct1");
    expect(agyEnv.OPENUSAGE_ANTIGRAVITY_CONFIG_DIR).toBeUndefined();
  });
});
