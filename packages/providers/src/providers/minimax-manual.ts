import type { UsageRecord } from "../../../core/src/types";
import type { UsageProvider } from "../types";

export class MiniMaxManualProvider implements UsageProvider {
  id = "minimax" as const;
  name = "MiniMax";

  async detect(): Promise<boolean> {
    return true;
  }

  async refresh(): Promise<UsageRecord[]> {
    return [];
  }
}
