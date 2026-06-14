import { createHash } from "node:crypto";
import type { ProviderId, UsageRecord } from "../../../core/src/types";
import type { UsageProvider } from "../types";

export interface ManualUsageInput {
  providerId?: ProviderId;
  tool?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  startedAt?: string;
  notes?: string;
}

export class ManualProvider implements UsageProvider {
  id = "manual" as const;
  name = "Manual";

  async detect(): Promise<boolean> {
    return true;
  }

  async refresh(): Promise<UsageRecord[]> {
    return [];
  }
}

export function createManualUsageRecord(input: ManualUsageInput): UsageRecord {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const providerId = input.providerId ?? "manual";
  const totalTokens = (input.inputTokens ?? 0) + (input.outputTokens ?? 0);
  const costUsd = input.costUsd ?? 0;
  const id = stableUsageId({
    providerId,
    tool: input.tool,
    model: input.model,
    startedAt,
    totalTokens,
    costUsd,
  });

  return {
    id,
    providerId,
    tool: input.tool,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens,
    costUsd,
    startedAt,
    source: "manual",
    raw: input.notes ? { notes: input.notes } : undefined,
  };
}

function stableUsageId(input: {
  providerId: ProviderId;
  tool?: string;
  model?: string;
  startedAt: string;
  totalTokens: number;
  costUsd: number;
}): string {
  return createHash("sha256")
    .update(
      [
        input.providerId,
        input.tool ?? "",
        input.model ?? "",
        input.startedAt,
        String(input.totalTokens),
        String(input.costUsd),
      ].join("|"),
    )
    .digest("hex");
}
