import type {
  ProviderId,
  ProviderStatus,
  UsageRecord,
} from "../../core/src/types";

export interface UsageProvider {
  id: ProviderId;
  name: string;
  detect(): Promise<boolean>;
  refresh(): Promise<UsageRecord[]>;
  getStatus?(): Promise<ProviderStatus>;
}
