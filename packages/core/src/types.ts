export const PROVIDER_IDS = [
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
  "gemini-cli",
  "google-ai-pro",
  "minimax",
  "manual",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type UsageSource =
  | "local-log"
  | "cli"
  | "api"
  | "proxy"
  | "manual"
  | "estimated";

export interface UsageRecord {
  id: string;
  providerId: ProviderId;
  tool?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  startedAt: string;
  endedAt?: string;
  source: UsageSource;
  raw?: unknown;
  createdAt?: string;
}

export interface ProviderStatus {
  providerId: ProviderId;
  name: string;
  enabled: boolean;
  detected: boolean;
  lastRefreshAt?: string;
  lastError?: string;
}

export interface UsageSummary {
  today: {
    totalTokens: number;
    costUsd: number;
    records: number;
  };
  month: {
    totalTokens: number;
    costUsd: number;
    records: number;
  };
  byProvider: Array<{
    providerId: ProviderId;
    totalTokens: number;
    costUsd: number;
    records: number;
  }>;
}
