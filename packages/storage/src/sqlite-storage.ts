import { Database } from "bun:sqlite";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ProviderId,
  ProviderStatus,
  UsageRecord,
  UsageSummary,
} from "../../core/src/types";
import type { Storage } from "./storage";

type UsageRecordRow = {
  id: string;
  provider_id: ProviderId;
  tool: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  started_at: string;
  ended_at: string | null;
  source: UsageRecord["source"];
  raw_json: string | null;
  created_at: string | null;
};

type ProviderStatusRow = {
  provider_id: ProviderId;
  name: string;
  enabled: number;
  detected: number;
  last_refresh_at: string | null;
  last_error: string | null;
};

type SettingsRow = {
  key: string;
  value: string | null;
};

export function getOpenUsageDir(): string {
  return process.env.OPENUSAGE_WEBUI_DIR ?? join(homedir(), ".openusage-webui");
}

export function getDatabasePath(): string {
  return join(getOpenUsageDir(), "openusage.sqlite");
}

export function getConfigPath(): string {
  return join(getOpenUsageDir(), "config.json");
}

export class SqliteStorage implements Storage {
  private db: Database | null = null;

  constructor(private readonly databasePath = getDatabasePath()) {}

  async init(): Promise<void> {
    const dataDir = getOpenUsageDir();
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700).catch(() => undefined);

    const configPath = getConfigPath();
    if (!existsSync(configPath)) {
      await writeFile(configPath, "{}\n", { mode: 0o600 });
      await chmod(configPath, 0o600).catch(() => undefined);
    }

    this.db = new Database(this.databasePath, { create: true });
    await chmod(this.databasePath, 0o600).catch(() => undefined);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        tool TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_creation_tokens INTEGER,
        cache_read_tokens INTEGER,
        total_tokens INTEGER,
        cost_usd REAL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        source TEXT NOT NULL,
        raw_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_usage_records_started_at
      ON usage_records(started_at);

      CREATE INDEX IF NOT EXISTS idx_usage_records_provider_id
      ON usage_records(provider_id);

      CREATE TABLE IF NOT EXISTS provider_status (
        provider_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        detected INTEGER NOT NULL DEFAULT 0,
        last_refresh_at TEXT,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS provider_settings (
        provider_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider_id, key)
      );
    `);
  }

  async upsertUsageRecords(records: UsageRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const db = this.requireDb();
    const insert = db.prepare(`
      INSERT INTO usage_records (
        id,
        provider_id,
        tool,
        model,
        input_tokens,
        output_tokens,
        cache_creation_tokens,
        cache_read_tokens,
        total_tokens,
        cost_usd,
        started_at,
        ended_at,
        source,
        raw_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      ON CONFLICT(id) DO UPDATE SET
        provider_id = excluded.provider_id,
        tool = excluded.tool,
        model = excluded.model,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        total_tokens = excluded.total_tokens,
        cost_usd = excluded.cost_usd,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        source = excluded.source,
        raw_json = excluded.raw_json
    `);

    const transaction = db.transaction((items: UsageRecord[]) => {
      for (const record of items) {
        insert.run(
          record.id,
          record.providerId,
          record.tool ?? null,
          record.model ?? null,
          record.inputTokens ?? null,
          record.outputTokens ?? null,
          record.cacheCreationTokens ?? null,
          record.cacheReadTokens ?? null,
          record.totalTokens ?? null,
          record.costUsd ?? null,
          record.startedAt,
          record.endedAt ?? null,
          record.source,
          record.raw === undefined ? null : JSON.stringify(record.raw),
          record.createdAt ?? null,
        );
      }
    });
    transaction(records);
  }

  async listUsageRecords(params: {
    providerId?: ProviderId;
    from?: string;
    to?: string;
    limit?: number;
  } = {}): Promise<UsageRecord[]> {
    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (params.providerId) {
      clauses.push("provider_id = ?");
      values.push(params.providerId);
    }
    if (params.from) {
      clauses.push("started_at >= ?");
      values.push(params.from);
    }
    if (params.to) {
      clauses.push("started_at <= ?");
      values.push(params.to);
    }

    const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
    values.push(limit);

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.requireDb()
      .query(`SELECT * FROM usage_records ${where} ORDER BY started_at DESC LIMIT ?`)
      .all(...values) as UsageRecordRow[];
    return rows.map(rowToUsageRecord);
  }

  async getUsageSummary(): Promise<UsageSummary> {
    const records = await this.listUsageRecords({ limit: 1000 });
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayMs = todayStart.getTime();
    const monthMs = monthStart.getTime();

    const summary: UsageSummary = {
      today: { totalTokens: 0, costUsd: 0, records: 0 },
      month: { totalTokens: 0, costUsd: 0, records: 0 },
      byProvider: [],
    };
    const byProvider = new Map<
      ProviderId,
      { providerId: ProviderId; totalTokens: number; costUsd: number; records: number }
    >();

    for (const record of records) {
      const tokens = record.totalTokens ?? 0;
      const cost = record.costUsd ?? 0;

      const startedAtMs = Date.parse(record.startedAt);
      if (!Number.isFinite(startedAtMs)) {
        continue;
      }

      if (startedAtMs >= todayMs) {
        summary.today.totalTokens += tokens;
        summary.today.costUsd += cost;
        summary.today.records += 1;
      }
      if (startedAtMs >= monthMs) {
        summary.month.totalTokens += tokens;
        summary.month.costUsd += cost;
        summary.month.records += 1;
      }

      const provider =
        byProvider.get(record.providerId) ??
        { providerId: record.providerId, totalTokens: 0, costUsd: 0, records: 0 };
      provider.totalTokens += tokens;
      provider.costUsd += cost;
      provider.records += 1;
      byProvider.set(record.providerId, provider);
    }

    summary.today.costUsd = roundCurrency(summary.today.costUsd);
    summary.month.costUsd = roundCurrency(summary.month.costUsd);
    summary.byProvider = [...byProvider.values()]
      .map((provider) => ({ ...provider, costUsd: roundCurrency(provider.costUsd) }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
    return summary;
  }

  async upsertProviderStatus(status: ProviderStatus): Promise<void> {
    this.requireDb()
      .query(`
        INSERT INTO provider_status (
          provider_id,
          name,
          enabled,
          detected,
          last_refresh_at,
          last_error
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_id) DO UPDATE SET
          name = excluded.name,
          enabled = excluded.enabled,
          detected = excluded.detected,
          last_refresh_at = excluded.last_refresh_at,
          last_error = excluded.last_error
      `)
      .run(
        status.providerId,
        status.name,
        status.enabled ? 1 : 0,
        status.detected ? 1 : 0,
        status.lastRefreshAt ?? null,
        status.lastError ?? null,
      );
  }

  async listProviderStatus(): Promise<ProviderStatus[]> {
    const rows = this.requireDb()
      .query("SELECT * FROM provider_status ORDER BY provider_id")
      .all() as ProviderStatusRow[];
    return rows.map((row) => ({
      providerId: row.provider_id,
      name: row.name,
      enabled: row.enabled === 1,
      detected: row.detected === 1,
      lastRefreshAt: row.last_refresh_at ?? undefined,
      lastError: row.last_error ?? undefined,
    }));
  }

  async getProviderSettings(providerId: ProviderId): Promise<Record<string, string>> {
    const rows = this.requireDb()
      .query("SELECT key, value FROM provider_settings WHERE provider_id = ? ORDER BY key")
      .all(providerId) as SettingsRow[];
    return Object.fromEntries(rows.map((row) => [row.key, row.value ?? ""]));
  }

  async updateProviderSettings(
    providerId: ProviderId,
    settings: Record<string, string>,
  ): Promise<void> {
    const db = this.requireDb();
    const insert = db.prepare(`
      INSERT INTO provider_settings (provider_id, key, value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(provider_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `);
    const transaction = db.transaction((entries: Array<[string, string]>) => {
      for (const [key, value] of entries) {
        insert.run(providerId, key, value);
      }
    });
    transaction(Object.entries(settings));
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error("Storage has not been initialized");
    }
    return this.db;
  }
}

function rowToUsageRecord(row: UsageRecordRow): UsageRecord {
  return {
    id: row.id,
    providerId: row.provider_id,
    tool: row.tool ?? undefined,
    model: row.model ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    cacheCreationTokens: row.cache_creation_tokens ?? undefined,
    cacheReadTokens: row.cache_read_tokens ?? undefined,
    totalTokens: row.total_tokens ?? undefined,
    costUsd: row.cost_usd ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    source: row.source,
    raw: row.raw_json ? JSON.parse(row.raw_json) : undefined,
    createdAt: row.created_at ?? undefined,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 10000) / 10000;
}
