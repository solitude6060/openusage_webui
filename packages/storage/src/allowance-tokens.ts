import type { Database } from "bun:sqlite";
import type { UsageRecord } from "../../core/src/types";

const HOUR_MS = 3600000;

// Token tools whose rows are daily buckets in usage_records.
export const DAILY_TOKEN_TOOLS = ["ccusage", "Cursor Usage Event", "Grok Session"];

export const TOKEN_HOURLY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS token_hourly (
    provider_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    hour_start TEXT NOT NULL,
    model TEXT NOT NULL,
    total_tokens INTEGER NOT NULL,
    cost_usd REAL,
    PRIMARY KEY (provider_id, tool, hour_start, model)
  );
`;

// An hourly token record is a token-tool record that spans exactly one hour. Daily rows have no endedAt.
export function isHourlyTokenRecord(record: UsageRecord): boolean {
  return (
    record.tool !== undefined &&
    DAILY_TOKEN_TOOLS.includes(record.tool) &&
    record.endedAt !== undefined &&
    Date.parse(record.endedAt) - Date.parse(record.startedAt) === HOUR_MS
  );
}

export function prepareHourlyUpsert(db: Database): (record: UsageRecord) => void {
  const upsert = db.prepare(`
    INSERT INTO token_hourly (provider_id, tool, hour_start, model, total_tokens, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id, tool, hour_start, model) DO UPDATE SET
      total_tokens = excluded.total_tokens,
      cost_usd = excluded.cost_usd
  `);
  return (record) => {
    upsert.run(
      record.providerId,
      record.tool ?? "",
      record.startedAt,
      record.model ?? "Unknown",
      record.totalTokens ?? 0,
      record.costUsd ?? null,
    );
  };
}

export function allowanceTokenTimes(tool: string | null, startedAt: string): { startedAt: string; bucketEnd?: string } {
  if (tool === "ccusage") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(startedAt);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      // ponytail: this assumes the server time zone at read time equals the zone ccusage used when the row was imported; a server moved to another zone shifts every historical ccusage row.
      return {
        startedAt: new Date(year, month - 1, day).toISOString(),
        bucketEnd: new Date(year, month - 1, day + 1).toISOString(),
      };
    }
  }
  if (tool != null && DAILY_TOKEN_TOOLS.includes(tool)) {
    return {
      startedAt,
      bucketEnd: new Date(Date.parse(startedAt) + 86400000).toISOString(),
    };
  }
  return { startedAt };
}
