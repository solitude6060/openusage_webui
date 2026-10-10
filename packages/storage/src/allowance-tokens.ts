import type { Database } from "bun:sqlite";
import type { UsageRecord } from "../../core/src/types";

const HOUR_MS = 3600000;

// Token tools whose rows are daily buckets in usage_records.
export const DAILY_TOKEN_TOOLS = ["ccusage", "Cursor Usage Event", "Grok Session", "Pi Session"];

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
  if (tool === "ccusage" || tool === "Pi Session") {
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

export type AllowanceTokenRow = {
  providerId: string;
  model: string;
  startedAt: string;
  tokens: number;
  costUsd: number | null;
  bucketEnd?: string;
};

type DailyTokenRow = AllowanceTokenRow & { tool: string | null; day: string };

export function listDailyTokenRows(db: Database, from: string): DailyTokenRow[] {
  const rows = db.query(`
    SELECT provider_id, model, started_at, total_tokens, cost_usd, tool
    FROM usage_records
    WHERE COALESCE(total_tokens, 0) > 0 AND started_at >= ?
  `).all(from) as Array<{
    provider_id: string;
    model: string | null;
    started_at: string;
    total_tokens: number | null;
    cost_usd: number | null;
    tool: string | null;
  }>;
  return rows.map((row) => ({
    providerId: row.provider_id,
    model: row.model?.trim() ? row.model : "Unknown",
    tokens: Number(row.total_tokens) || 0,
    costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
    tool: row.tool,
    day: row.started_at.slice(0, 10),
    ...allowanceTokenTimes(row.tool, row.started_at),
  }));
}

// The calendar day an hour belongs to: a local day for ccusage, a UTC day for Cursor and Grok.
function hourDay(tool: string, hourStart: string): string {
  if (tool !== "ccusage") return hourStart.slice(0, 10);
  const date = new Date(hourStart);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const dayKey = (providerId: string, tool: string | null, day: string) => JSON.stringify([providerId, tool, day]);

// Daily rows, except that a provider/tool/day with hourly rows is read from those rows instead.
export function listAllowanceRows(db: Database, from: string): AllowanceTokenRow[] {
  // A day label is a UTC midnight, but a local day can start up to 14 hours earlier.
  const hourlyFrom = new Date(Date.parse(from) - 24 * HOUR_MS).toISOString();
  const hours = db.query(`
    SELECT provider_id, tool, hour_start, model, total_tokens, cost_usd
    FROM token_hourly
    WHERE total_tokens > 0 AND hour_start >= ?
  `).all(hourlyFrom) as Array<{
    provider_id: string;
    tool: string;
    hour_start: string;
    model: string;
    total_tokens: number;
    cost_usd: number | null;
  }>;
  const rows: AllowanceTokenRow[] = [];
  const covered = new Set<string>();
  for (const hour of hours) {
    covered.add(dayKey(hour.provider_id, hour.tool, hourDay(hour.tool, hour.hour_start)));
    rows.push({
      providerId: hour.provider_id,
      model: hour.model,
      tokens: Number(hour.total_tokens),
      costUsd: hour.cost_usd == null ? null : Number(hour.cost_usd),
      startedAt: hour.hour_start,
      bucketEnd: new Date(Date.parse(hour.hour_start) + HOUR_MS).toISOString(),
    });
  }
  for (const { tool, day, ...row } of listDailyTokenRows(db, from)) {
    if (!covered.has(dayKey(row.providerId, tool, day))) rows.push(row);
  }
  return rows;
}
