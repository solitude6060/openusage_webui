import type {
  ProviderAccount,
  ProviderId,
  ProviderStatus,
  TokenUsageBreakdown,
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
  getTokenUsageBreakdown(params?: {
    from?: string;
    to?: string;
  }): Promise<TokenUsageBreakdown>;
  upsertProviderStatus(status: ProviderStatus): Promise<void>;
  listProviderStatus(): Promise<ProviderStatus[]>;
  deleteProviderStatus(providerId: ProviderId): Promise<void>;
  deleteUsageRecordsForProvider(providerId: ProviderId): Promise<void>;
  getProviderSettings(providerId: ProviderId): Promise<Record<string, string>>;
  updateProviderSettings(
    providerId: ProviderId,
    settings: Record<string, string>,
  ): Promise<void>;
  listProviderAccounts(providerId?: string): Promise<ProviderAccount[]>;
  getProviderAccount(id: string): Promise<ProviderAccount | null>;
  upsertProviderAccount(account: ProviderAccount): Promise<void>;
  deleteProviderAccount(id: string): Promise<void>;
}
