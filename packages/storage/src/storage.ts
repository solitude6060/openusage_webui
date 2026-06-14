import type {
  ProviderId,
  ProviderStatus,
  UsageRecord,
  UsageSummary,
} from "../../core/src/types";

export interface Storage {
  init(): Promise<void>;
  upsertUsageRecords(records: UsageRecord[]): Promise<void>;
  listUsageRecords(params?: {
    providerId?: ProviderId;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<UsageRecord[]>;
  getUsageSummary(): Promise<UsageSummary>;
  upsertProviderStatus(status: ProviderStatus): Promise<void>;
  listProviderStatus(): Promise<ProviderStatus[]>;
  getProviderSettings(providerId: ProviderId): Promise<Record<string, string>>;
  updateProviderSettings(
    providerId: ProviderId,
    settings: Record<string, string>,
  ): Promise<void>;
}
