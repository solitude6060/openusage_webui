export type ProviderId =
  | "ccusage"
  | "claude-code"
  | "codex"
  | "github-copilot"
  | "gemini-cli"
  | "google-ai-pro"
  | "minimax"
  | "manual";

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
