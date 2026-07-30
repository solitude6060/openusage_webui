import { describe, expect, test } from "bun:test";
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
});
