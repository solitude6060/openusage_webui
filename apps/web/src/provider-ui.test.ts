import { describe, expect, test } from "bun:test";
import { isProviderRefreshable, providerCards } from "./provider-ui";

describe("provider UI metadata", () => {
  test.each([
    ["claude-code", "Claude Code"],
    ["codex", "Codex"],
    ["github-copilot", "GitHub Copilot"],
  ] as const)("shows %s as an original OpenUsage plugin provider", (providerId, name) => {
    const provider = providerCards.find((item) => item.providerId === providerId);

    expect(provider).toMatchObject({
      providerId,
      name,
      note: "OpenUsage plugin",
    });
    expect(isProviderRefreshable(providerId)).toBe(true);
  });
});
