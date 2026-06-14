import type { UsageRecord } from "../../../core/src/types";
import type { UsageProvider } from "../types";

export class CcusageProvider implements UsageProvider {
  id = "ccusage" as const;
  name = "ccusage";

  async detect(): Promise<boolean> {
    return false;
  }

  async refresh(): Promise<UsageRecord[]> {
    return [];
  }
}
