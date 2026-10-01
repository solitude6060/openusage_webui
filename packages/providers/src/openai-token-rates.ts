import type { UsageRecord } from "../../core/src/types";

export type OpenAiTokenRate = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  cacheWritePerMillion: number | null;
  outputPerMillion: number;
};

// Standard short-context rates, USD per 1M tokens.
// Source: https://developers.openai.com/api/docs/pricing (read 2026-09-30).
// Daily totals do not identify long-context or Fast requests, so those tiers are not applied here.
export const OPENAI_STANDARD_TOKEN_RATES: Record<string, OpenAiTokenRate> = {
  "gpt-6-astra": { inputPerMillion: 10, cachedInputPerMillion: 1, cacheWritePerMillion: 12.5, outputPerMillion: 50 },
  "gpt-6.1-sol": { inputPerMillion: 2, cachedInputPerMillion: 0.1, cacheWritePerMillion: 2.5, outputPerMillion: 10 },
  "gpt-6-sol": { inputPerMillion: 2, cachedInputPerMillion: 0.2, cacheWritePerMillion: 2.5, outputPerMillion: 10 },
  "gpt-6-luna": { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, cacheWritePerMillion: 0.125, outputPerMillion: 0.5 },
  "gpt-5.6-sol": { inputPerMillion: 4, cachedInputPerMillion: 0.4, cacheWritePerMillion: 5, outputPerMillion: 20 },
  "gpt-5.6-terra": { inputPerMillion: 2, cachedInputPerMillion: 0.2, cacheWritePerMillion: 2.5, outputPerMillion: 12 },
  "gpt-5.6-luna": { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, cacheWritePerMillion: 0.25, outputPerMillion: 1.2 },
  "gpt-5.5": { inputPerMillion: 5, cachedInputPerMillion: 0.5, cacheWritePerMillion: null, outputPerMillion: 30 },
  "gpt-5.4": { inputPerMillion: 2.5, cachedInputPerMillion: 0.25, cacheWritePerMillion: null, outputPerMillion: 15 },
  "gpt-5.4-mini": { inputPerMillion: 0.75, cachedInputPerMillion: 0.075, cacheWritePerMillion: null, outputPerMillion: 4.5 },
  "gpt-5.3-codex": { inputPerMillion: 1.75, cachedInputPerMillion: 0.175, cacheWritePerMillion: null, outputPerMillion: 14 },
};

export function openAiTokenCostUsd(
  model: string | undefined,
  usage: Pick<UsageRecord, "inputTokens" | "outputTokens" | "cacheCreationTokens" | "cacheReadTokens">,
): number | undefined {
  if (!model) return undefined;
  const rate = OPENAI_STANDARD_TOKEN_RATES[model];
  if (!rate) return undefined;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheCreationTokens ?? 0;
  if (cacheWrite > 0 && rate.cacheWritePerMillion == null) return undefined;
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return undefined;
  return (
    input * rate.inputPerMillion
    + cacheRead * rate.cachedInputPerMillion
    + cacheWrite * (rate.cacheWritePerMillion ?? 0)
    + output * rate.outputPerMillion
  ) / 1_000_000;
}
