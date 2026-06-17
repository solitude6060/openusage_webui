import type { ProviderId } from "../../../packages/core/src/types";

export const providerCards: Array<{ providerId: ProviderId; name: string; note?: string }> = [
  { providerId: "ccusage", name: "ccusage" },
  { providerId: "amp", name: "Amp", note: "OpenUsage plugin" },
  { providerId: "antigravity", name: "Antigravity", note: "OpenUsage plugin" },
  { providerId: "claude-code", name: "Claude Code", note: "OpenUsage plugin" },
  { providerId: "codex", name: "Codex", note: "OpenUsage plugin" },
  { providerId: "cursor", name: "Cursor", note: "OpenUsage plugin" },
  { providerId: "devin", name: "Devin", note: "OpenUsage plugin" },
  { providerId: "factory", name: "Factory", note: "OpenUsage plugin" },
  { providerId: "grok", name: "Grok", note: "OpenUsage plugin" },
  { providerId: "github-copilot", name: "GitHub Copilot", note: "OpenUsage plugin" },
  { providerId: "jetbrains-ai-assistant", name: "JetBrains AI Assistant", note: "OpenUsage plugin" },
  { providerId: "kimi", name: "Kimi", note: "OpenUsage plugin" },
  { providerId: "kiro", name: "Kiro", note: "OpenUsage plugin" },
  { providerId: "opencode-go", name: "OpenCode Go", note: "OpenUsage plugin" },
  { providerId: "perplexity", name: "Perplexity", note: "OpenUsage plugin" },
  { providerId: "synthetic", name: "Synthetic", note: "OpenUsage plugin" },
  { providerId: "zai", name: "Z.ai", note: "OpenUsage plugin" },
  { providerId: "gemini-cli", name: "Gemini CLI / Google AI Pro", note: "via ccusage" },
  { providerId: "minimax", name: "MiniMax" },
  { providerId: "manual", name: "Manual" },
];

const refreshableProviders = new Set<ProviderId>([
  "ccusage",
  "amp",
  "antigravity",
  "claude-code",
  "codex",
  "cursor",
  "devin",
  "factory",
  "grok",
  "github-copilot",
  "jetbrains-ai-assistant",
  "kimi",
  "kiro",
  "opencode-go",
  "perplexity",
  "synthetic",
  "zai",
  "manual",
  "minimax",
]);

export function isProviderRefreshable(providerId: ProviderId): boolean {
  return refreshableProviders.has(providerId);
}

export function getProviderStatusLabel(provider: { note?: string }): string {
  return provider.note === "OpenUsage plugin" ? "Adapter Loaded" : "Detected";
}
