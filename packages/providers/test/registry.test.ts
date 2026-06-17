import { describe, expect, test } from "bun:test";
import { OpenUsagePluginProvider, getProviders } from "../src/index";

describe("provider registry", () => {
  test.each([
    ["claude-code", "Claude Code"],
    ["codex", "Codex"],
    ["github-copilot", "GitHub Copilot"],
  ] as const)("registers %s through the original OpenUsage plugin adapter", (providerId, name) => {
    const provider = getProviders().find((item) => item.id === providerId);

    expect(provider).toBeInstanceOf(OpenUsagePluginProvider);
    expect(provider?.name).toBe(name);
  });
});
