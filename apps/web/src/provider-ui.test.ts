import { describe, expect, test } from "bun:test";
import {
  badgeToneClassName,
  CCUSAGE_NOTE,
  getProviderStatusLabel,
  isProviderRefreshable,
  providerCards,
} from "./provider-ui";

describe("badge urgency tone class", () => {
  test.each([
    ["expired", "status-pill reset-expired"],
    ["urgent", "status-pill reset-urgent"],
    ["soon", "status-pill reset-soon"],
    ["week", "status-pill reset-week"],
    ["normal", "status-pill reset-normal"],
  ] as const)("maps reset tone %s to %s", (tone, expected) => {
    expect(badgeToneClassName(tone)).toBe(expected);
  });

  test("falls back to the default chip for missing or unknown tone", () => {
    expect(badgeToneClassName(undefined)).toBe("value-chip");
    expect(badgeToneClassName("bogus")).toBe("value-chip");
  });
});

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
      note: "OpenUsage Plugin",
    });
    expect(isProviderRefreshable(providerId)).toBe(true);
    expect(getProviderStatusLabel(provider)).toBe("Adapter Loaded");
  });

  test("keeps detection wording for non-plugin providers", () => {
    const provider = providerCards.find((item) => item.providerId === "ccusage");

    expect(provider).toBeDefined();
    expect(getProviderStatusLabel(provider!)).toBe("Detected");
  });

  test("labels ccusage-backed providers by their shared source", () => {
    const provider = providerCards.find((item) => item.providerId === "gemini-cli");

    expect(provider).toMatchObject({
      note: CCUSAGE_NOTE,
    });
    expect(isProviderRefreshable("gemini-cli")).toBe(false);
    expect(getProviderStatusLabel(provider!)).toBe("Via ccusage");
  });
});
