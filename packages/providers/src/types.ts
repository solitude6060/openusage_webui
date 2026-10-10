import type {
  ProviderId,
  ProviderStatus,
  UsageRecord,
} from "../../core/src/types";

export interface UsageProvider {
  id: ProviderId;
  name: string;
  /**
   * False when a newly seen provider should start disabled until the user turns it on. Used where
   * a local credential exists without the service being set up (Ollama's signing key is written on
   * first run, whether or not `ollama signin` ever linked it to an account). Absent means enabled.
   */
  defaultEnabled?: boolean;
  detect(): Promise<boolean>;
  refresh(): Promise<UsageRecord[]>;
  getStatus?(): Promise<ProviderStatus>;
}
