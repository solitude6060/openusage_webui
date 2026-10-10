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
    ["grok", "Grok Build"],
    ["github-copilot", "GitHub Copilot"],
    ["jetbrains-ai-assistant", "JetBrains AI Assistant"],
    ["kimi", "Kimi"],
    ["kiro", "Kiro"],
    ["ollama", "Ollama"],
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

  test("registers Ollama as opt-in and every other plugin provider as enabled by default", () => {
    const optedOut = getProviders().filter((provider) => provider.defaultEnabled === false);

    expect(optedOut.map((provider) => provider.id)).toEqual(["ollama"]);
  });

  test("rejects bundled plugin path traversal ids", () => {
    expect(() => resolveBundledPluginScriptPath("../cursor")).toThrow("Invalid bundled plugin id.");
    expect(() => resolveBundledPluginScriptPath("cursor/../../codex")).toThrow("Invalid bundled plugin id.");
  });
});
