import type { ProviderId } from "../../../packages/core/src/types";

export const providerCards: Array<{ providerId: ProviderId; name: string; note?: string }> = [
  { providerId: "ccusage", name: "ccusage" },
  { providerId: "claude-code", name: "Claude Code", note: "via ccusage" },
  { providerId: "codex", name: "Codex", note: "via ccusage" },
  { providerId: "github-copilot", name: "GitHub Copilot", note: "OpenUsage plugin" },
  { providerId: "gemini-cli", name: "Gemini CLI / Google AI Pro", note: "via ccusage" },
  { providerId: "minimax", name: "MiniMax" },
  { providerId: "manual", name: "Manual" },
];

const refreshableProviders = new Set<ProviderId>([
  "ccusage",
  "github-copilot",
  "manual",
  "minimax",
]);

export function isProviderRefreshable(providerId: ProviderId): boolean {
  return refreshableProviders.has(providerId);
}
