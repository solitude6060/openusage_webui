import { describe, expect, test } from "bun:test";
import { isProviderRefreshable, providerCards } from "./provider-ui";

describe("provider UI metadata", () => {
  test.each([
    ["amp", "Amp"],
    ["antigravity", "Antigravity"],
    ["claude-code", "Claude Code"],
    ["codex", "Codex"],
    ["cursor", "Cursor"],
    ["devin", "Devin"],
    ["factory", "Factory"],
    ["grok", "Grok"],
    ["github-copilot", "GitHub Copilot"],
    ["jetbrains-ai-assistant", "JetBrains AI Assistant"],
    ["kimi", "Kimi"],
    ["kiro", "Kiro"],
    ["opencode-go", "OpenCode Go"],
    ["perplexity", "Perplexity"],
    ["synthetic", "Synthetic"],
    ["zai", "Z.ai"],
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
