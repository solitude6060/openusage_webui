import type { ProviderId } from "../../../packages/core/src/types";

export const providerCards: Array<{ providerId: ProviderId; name: string; note?: string }> = [
  { providerId: "ccusage", name: "ccusage" },
  { providerId: "amp", name: "Amp", note: "OpenUsage Plugin" },
  { providerId: "antigravity", name: "Antigravity", note: "OpenUsage Plugin" },
  { providerId: "claude-code", name: "Claude Code", note: "OpenUsage Plugin" },
  { providerId: "codex", name: "Codex", note: "OpenUsage Plugin" },
  { providerId: "cursor", name: "Cursor", note: "OpenUsage Plugin" },
  { providerId: "devin", name: "Devin", note: "OpenUsage Plugin" },
  { providerId: "factory", name: "Factory", note: "OpenUsage Plugin" },
  { providerId: "grok", name: "Grok", note: "OpenUsage Plugin" },
  { providerId: "github-copilot", name: "GitHub Copilot", note: "OpenUsage Plugin" },
  { providerId: "jetbrains-ai-assistant", name: "JetBrains AI Assistant", note: "OpenUsage Plugin" },
  { providerId: "kimi", name: "Kimi", note: "OpenUsage Plugin" },
  { providerId: "kiro", name: "Kiro", note: "OpenUsage Plugin" },
  { providerId: "opencode-go", name: "OpenCode Go", note: "OpenUsage Plugin" },
  { providerId: "perplexity", name: "Perplexity", note: "OpenUsage Plugin" },
  { providerId: "synthetic", name: "Synthetic", note: "OpenUsage Plugin" },
  { providerId: "zai", name: "Z.ai", note: "OpenUsage Plugin" },
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
  if (provider.note === "via ccusage") return "Via ccusage";
  return provider.note === "OpenUsage Plugin" ? "Adapter Loaded" : "Detected";
}
