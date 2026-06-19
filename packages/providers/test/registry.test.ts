import { describe, expect, test } from "bun:test";
import { OpenUsagePluginProvider, getProviders } from "../src/index";
import { resolveBundledPluginScriptPath } from "../src/registry";

describe("provider registry", () => {
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
  ] as const)("registers %s through the original OpenUsage plugin adapter", async (providerId, name) => {
    const provider = getProviders().find((item) => item.id === providerId);

    expect(provider).toBeInstanceOf(OpenUsagePluginProvider);
    expect(provider?.name).toBe(name);
    await expect(provider?.detect()).resolves.toBe(true);
  });

  test("rejects bundled plugin path traversal ids", () => {
    expect(() => resolveBundledPluginScriptPath("../cursor")).toThrow("Invalid bundled plugin id.");
    expect(() => resolveBundledPluginScriptPath("cursor/../../codex")).toThrow("Invalid bundled plugin id.");
  });
});
