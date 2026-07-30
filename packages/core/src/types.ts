import { isProviderAccountId } from "./provider-accounts";

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

export type BaseProviderId = (typeof PROVIDER_IDS)[number];

/** Base provider ids, plus WebUI account instance ids like `codex:family`. */
export type ProviderId = BaseProviderId | (string & {});

const BASE_PROVIDER_ID_SET = new Set<string>(PROVIDER_IDS);

export function isBaseProviderId(value: string): value is BaseProviderId {
  return BASE_PROVIDER_ID_SET.has(value);
}

export function isValidProviderId(value: string): value is ProviderId {
  return isBaseProviderId(value) || isProviderAccountId(value);
}

export type {
  CodexInstance,
  MultiAccountProviderCapability,
  MultiAccountProviderId,
  ProviderAccount,
} from "./provider-accounts";
export {
  buildCodexInstanceId,
  buildProviderAccountId,
  CODEX_INSTANCE_ID_PATTERN,
  isCodexInstanceId,
  isMultiAccountProviderId,
  isProviderAccountId,
  MULTI_ACCOUNT_PROVIDER_CAPABILITIES,
  MULTI_ACCOUNT_PROVIDER_IDS,
  providerIdFromAccountId,
  slugifyAccountLabel,
  slugifyCodexLabel,
} from "./provider-accounts";

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

export interface TokenUsageModelRow {
  model: string;
  totalTokens: number;
  records: number;
}

export interface TokenUsageProviderRow {
  providerId: ProviderId;
  totalTokens: number;
  records: number;
  models: TokenUsageModelRow[];
}

export interface TokenUsageBreakdown {
  from: string | null;
  to: string | null;
  totalTokens: number;
  records: number;
  providers: TokenUsageProviderRow[];
}
