import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  MultiAccountProviderId,
  ProviderAccount,
  ProviderId,
  ProviderStatus,
  TokenUsageBreakdown,
  UsageRecord,
  UsageSummary,
} from "../../core/src/types";
import { isMultiAccountProviderId, providerIdFromAccountId } from "../../core/src/types";
import type { Storage } from "./storage";
import type { QuotaLimitUnit, QuotaObservation } from "../../providers/src/quota-observations";

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

type ProviderAccountRow = {
  id: string;
  provider_id: string;
  label: string;
  home_path: string;
  enabled: number;
  sort_order: number;
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

      CREATE TABLE IF NOT EXISTS provider_accounts (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        label TEXT NOT NULL,
        home_path TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_provider_accounts_provider_id
      ON provider_accounts(provider_id);

      CREATE TABLE IF NOT EXISTS quota_observations (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        window_key TEXT NOT NULL,
        window_label TEXT NOT NULL,
        period_ms INTEGER,
        resets_at TEXT,
        present INTEGER NOT NULL,
        used_percent REAL,
        limit_value REAL,
        limit_unit TEXT,
        used_value REAL
      );

      CREATE INDEX IF NOT EXISTS idx_quota_observations_window
      ON quota_observations(provider_id, window_key, observed_at);

      CREATE TABLE IF NOT EXISTS probe_failures (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        failed_at TEXT NOT NULL,
        message TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_probe_failures_provider
      ON probe_failures(provider_id, failed_at);

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.migrateCodexInstancesToProviderAccounts();
  }

  private migrateCodexInstancesToProviderAccounts(): void {
    const db = this.requireDb();
    const legacy = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_instances'")
      .get() as { name: string } | null;
    if (!legacy) return;

    const rows = db
      .query("SELECT id, label, home_path, enabled, sort_order FROM codex_instances")
      .all() as Array<{
      id: string;
      label: string;
      home_path: string;
      enabled: number;
      sort_order: number;
    }>;

    const insert = db.prepare(`
      INSERT OR IGNORE INTO provider_accounts (id, provider_id, label, home_path, enabled, sort_order)
      VALUES (?, 'codex', ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(row.id, row.label, row.home_path, row.enabled, row.sort_order);
    }
    db.exec("DROP TABLE IF EXISTS codex_instances");
  }

  async upsertUsageRecords(
    records: UsageRecord[],
    options: { replaceScopes?: boolean } = {},
  ): Promise<void> {
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
    const deleteScope = db.prepare(`
      DELETE FROM usage_records
      WHERE provider_id = ? AND tool = ? AND started_at = ? AND source = ?
    `);
    const clearLegacyCcusageTokens = db.prepare(`
      UPDATE usage_records
      SET input_tokens = NULL,
          output_tokens = NULL,
          cache_creation_tokens = NULL,
          cache_read_tokens = NULL,
          total_tokens = NULL
      WHERE provider_id = ? AND started_at = ? AND source = 'cli'
    `);

    const transaction = db.transaction((items: UsageRecord[]) => {
      if (options.replaceScopes) {
        const scopes = new Set<string>();
        const legacyScopes = new Set<string>();
        for (const record of items) {
          if (record.totalTokens === undefined || !record.tool) continue;
          const baseProviderId = providerIdFromAccountId(record.providerId) ?? record.providerId;
          if (
            record.tool === "ccusage" &&
            record.source === "local-log" &&
            (baseProviderId === "claude-code" || baseProviderId === "codex")
          ) {
            const legacyScope = JSON.stringify([baseProviderId, record.startedAt]);
            if (!legacyScopes.has(legacyScope)) {
              legacyScopes.add(legacyScope);
              clearLegacyCcusageTokens.run(baseProviderId, record.startedAt);
            }
          }
          const scope = JSON.stringify([record.providerId, record.tool, record.startedAt, record.source]);
          if (scopes.has(scope)) continue;
          scopes.add(scope);
          deleteScope.run(record.providerId, record.tool, record.startedAt, record.source);
        }
      }
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
    const rows = this.requireDb()
      .query("SELECT provider_id, tool, source, total_tokens, cost_usd, started_at FROM usage_records")
      .all() as Array<{
      provider_id: ProviderId;
      tool: string | null;
      source: UsageRecord["source"];
      total_tokens: number | null;
      cost_usd: number | null;
      started_at: string;
    }>;
    // Legacy CLI rows lack an account/home identifier. Only deduplicate when the
    // provider has one known structured account; retain ambiguous account costs.
    const accounts = new Map<string, Set<string>>();
    const rememberAccount = (base: string, id: string) => {
      const ids = accounts.get(base) ?? new Set<string>();
      ids.add(id);
      accounts.set(base, ids);
    };
    for (const account of await this.listProviderAccounts()) {
      rememberAccount(account.providerId, account.id);
    }
    const structuredDays = new Map<string, typeof rows>();
    const legacyPricedDays = new Set<string>();
    for (const row of rows) {
      const base = providerIdFromAccountId(row.provider_id) ?? row.provider_id;
      if (base !== "codex" && base !== "claude-code") continue;
      const key = JSON.stringify([base, row.started_at]);
      if (row.source === "local-log" && row.tool === "ccusage") {
        rememberAccount(base, row.provider_id);
        const day = structuredDays.get(key) ?? [];
        day.push(row);
        structuredDays.set(key, day);
      } else if (row.source === "cli" && row.provider_id === base && row.cost_usd !== null) {
        legacyPricedDays.add(key);
      }
    }
    const excludedCosts = new Set<(typeof rows)[number]>();
    for (const row of rows) {
      const base = providerIdFromAccountId(row.provider_id) ?? row.provider_id;
      if (accounts.get(base)?.size !== 1) continue;
      const key = JSON.stringify([base, row.started_at]);
      const day = structuredDays.get(key);
      if (!day) continue;
      const complete = day.every((record) => record.cost_usd !== null);
      if (complete && row.source === "cli" && row.provider_id === base) {
        excludedCosts.add(row);
      } else if (!complete && legacyPricedDays.has(key) && day.includes(row)) {
        excludedCosts.add(row);
      }
    }
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

    for (const row of rows) {
      const tokens = row.total_tokens ?? 0;
      const cost = excludedCosts.has(row) ? 0 : row.cost_usd ?? 0;

      const startedAtMs = Date.parse(row.started_at);
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
        byProvider.get(row.provider_id) ??
        { providerId: row.provider_id, totalTokens: 0, costUsd: 0, records: 0 };
      provider.totalTokens += tokens;
      provider.costUsd += cost;
      provider.records += 1;
      byProvider.set(row.provider_id, provider);
    }

    summary.today.costUsd = roundCurrency(summary.today.costUsd);
    summary.month.costUsd = roundCurrency(summary.month.costUsd);
    summary.byProvider = [...byProvider.values()]
      .map((provider) => ({ ...provider, costUsd: roundCurrency(provider.costUsd) }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
    return summary;
  }

  async getTokenUsageBreakdown(params: {
    from?: string;
    to?: string;
  } = {}): Promise<TokenUsageBreakdown> {
    const clauses: string[] = ["COALESCE(total_tokens, 0) > 0"];
    const values: string[] = [];
    if (params.from) {
      clauses.push("started_at >= ?");
      values.push(params.from);
    }
    if (params.to) {
      clauses.push("started_at <= ?");
      values.push(params.to);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const rows = this.requireDb()
      .query(
        `
        SELECT
          provider_id,
          CASE
            WHEN model IS NULL OR TRIM(model) = '' THEN 'Unknown'
            ELSE model
          END AS model,
          SUM(COALESCE(total_tokens, 0)) AS total_tokens,
          COUNT(*) AS records
        FROM usage_records
        ${where}
        GROUP BY
          provider_id,
          CASE
            WHEN model IS NULL OR TRIM(model) = '' THEN 'Unknown'
            ELSE model
          END
        ORDER BY total_tokens DESC, provider_id ASC, model ASC
        `,
      )
      .all(...values) as Array<{
      provider_id: ProviderId;
      model: string;
      total_tokens: number | null;
      records: number | null;
    }>;

    const providersMap = new Map<
      ProviderId,
      {
        providerId: ProviderId;
        totalTokens: number;
        records: number;
        models: Array<{ model: string; totalTokens: number; records: number }>;
      }
    >();
    let totalTokens = 0;
    let records = 0;

    for (const row of rows) {
      const tokens = Number(row.total_tokens) || 0;
      const count = Number(row.records) || 0;
      totalTokens += tokens;
      records += count;
      const provider =
        providersMap.get(row.provider_id) ??
        {
          providerId: row.provider_id,
          totalTokens: 0,
          records: 0,
          models: [],
        };
      provider.totalTokens += tokens;
      provider.records += count;
      provider.models.push({
        model: row.model || "Unknown",
        totalTokens: tokens,
        records: count,
      });
      providersMap.set(row.provider_id, provider);
    }

    const providers = [...providersMap.values()]
      .map((provider) => ({
        ...provider,
        models: [...provider.models].sort((a, b) => b.totalTokens - a.totalTokens),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    return {
      from: params.from ?? null,
      to: params.to ?? null,
      totalTokens,
      records,
      providers,
    };
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

  async deleteProviderStatus(providerId: ProviderId): Promise<void> {
    this.requireDb().query("DELETE FROM provider_status WHERE provider_id = ?").run(providerId);
  }

  async deleteUsageRecordsForProvider(providerId: ProviderId): Promise<void> {
    this.requireDb().query("DELETE FROM usage_records WHERE provider_id = ?").run(providerId);
  }

  async deleteLocalLogUsageRecords(providerIds: ProviderId[], tool: string): Promise<void> {
    if (providerIds.length === 0) return;
    const placeholders = providerIds.map(() => "?").join(", ");
    this.requireDb()
      .query(
        `DELETE FROM usage_records WHERE provider_id IN (${placeholders}) AND tool = ? AND source = 'local-log'`,
      )
      .run(...providerIds, tool);
  }

  async listProviderAccounts(providerId?: string): Promise<ProviderAccount[]> {
    const db = this.requireDb();
    const rows = (
      providerId
        ? db
            .query(
              "SELECT * FROM provider_accounts WHERE provider_id = ? ORDER BY sort_order ASC, id ASC",
            )
            .all(providerId)
        : db
            .query("SELECT * FROM provider_accounts ORDER BY provider_id ASC, sort_order ASC, id ASC")
            .all()
    ) as ProviderAccountRow[];
    return rows.map(rowToProviderAccount).filter((account): account is ProviderAccount => account !== null);
  }

  async getProviderAccount(id: string): Promise<ProviderAccount | null> {
    const row = this.requireDb()
      .query("SELECT * FROM provider_accounts WHERE id = ?")
      .get(id) as ProviderAccountRow | null;
    return row ? rowToProviderAccount(row) : null;
  }

  async upsertProviderAccount(account: ProviderAccount): Promise<void> {
    this.requireDb()
      .query(`
        INSERT INTO provider_accounts (id, provider_id, label, home_path, enabled, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          provider_id = excluded.provider_id,
          label = excluded.label,
          home_path = excluded.home_path,
          enabled = excluded.enabled,
          sort_order = excluded.sort_order
      `)
      .run(
        account.id,
        account.providerId,
        account.label,
        account.homePath,
        account.enabled ? 1 : 0,
        account.sortOrder,
      );
  }

  async deleteProviderAccount(id: string): Promise<void> {
    this.requireDb().query("DELETE FROM provider_accounts WHERE id = ?").run(id);
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

  async insertQuotaObservations(rows: QuotaObservation[]): Promise<void> {
    if (rows.length === 0) return;
    const db = this.requireDb();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO quota_observations (
        id, provider_id, observed_at, window_key, window_label, period_ms, resets_at,
        present, used_percent, limit_value, limit_unit, used_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const write = db.transaction((items: QuotaObservation[]) => {
      for (const row of items) {
        insert.run(
          quotaObservationId(row),
          row.providerId,
          row.observedAt,
          row.windowKey,
          row.windowLabel,
          row.periodMs,
          row.resetsAt,
          row.present ? 1 : 0,
          row.usedPercent,
          row.limitValue,
          row.limitUnit,
          row.usedValue,
        );
      }
    });
    write(rows);
  }

  async listQuotaObservationsSince(from: string): Promise<QuotaObservation[]> {
    const rows = this.requireDb().query(`
      SELECT * FROM quota_observations
      WHERE observed_at >= ?
      ORDER BY observed_at ASC, id ASC
    `).all(from) as QuotaObservationRow[];
    return rows.map(rowToQuotaObservation);
  }

  async listLatestQuotaObservations(providerId?: string): Promise<QuotaObservation[]> {
    const rows = this.requireDb().query(`
      SELECT * FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY provider_id, window_key
            ORDER BY observed_at DESC, id DESC
          ) AS rn
        FROM quota_observations
        WHERE (? IS NULL OR provider_id = ?)
      ) WHERE rn = 1
    `).all(providerId ?? null, providerId ?? null) as QuotaObservationRow[];
    return rows.map(rowToQuotaObservation);
  }

  async latestQuotaObservationBeforeReset(
    providerId: string,
    windowKey: string,
    resetsAt: string,
  ): Promise<QuotaObservation | null> {
    const row = this.requireDb().query(`
      SELECT * FROM quota_observations
      WHERE provider_id = ? AND window_key = ? AND present = 1
        AND resets_at IS NOT NULL AND resets_at < ?
        AND (
          period_ms IS NULL OR period_ms <= 0
          OR julianday(observed_at) >= julianday(resets_at) - (period_ms / 86400000.0) / 2
        )
      ORDER BY observed_at DESC, id DESC
      LIMIT 1
    `).get(providerId, windowKey, resetsAt) as QuotaObservationRow | null;
    return row ? rowToQuotaObservation(row) : null;
  }

  async listPositiveTokenRows(from: string): Promise<Array<{
    providerId: string;
    model: string;
    startedAt: string;
    tokens: number;
    costUsd: number | null;
    bucketEnd?: string;
  }>> {
    const rows = this.requireDb().query(`
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
      startedAt: row.started_at,
      tokens: Number(row.total_tokens) || 0,
      costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
      ...(["ccusage", "Cursor Usage Event", "Grok Session"].includes(row.tool ?? "")
        ? { bucketEnd: new Date(Date.parse(row.started_at) + 86400000).toISOString() }
        : {}),
    }));
  }

  async insertProbeFailure(providerId: string, failedAt: string, message: string): Promise<void> {
    const text = message.slice(0, 500);
    const id = createHash("sha256").update([providerId, failedAt, text].join("|")).digest("hex");
    this.requireDb().query(`
      INSERT OR IGNORE INTO probe_failures (id, provider_id, failed_at, message)
      VALUES (?, ?, ?, ?)
    `).run(id, providerId, failedAt, text);
  }

  async listLatestProbeFailures(from: string): Promise<Array<{
    providerId: string;
    failedAt: string;
    message: string;
  }>> {
    const rows = this.requireDb().query(`
      SELECT provider_id, failed_at, message FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY provider_id
            ORDER BY failed_at DESC, id DESC
          ) AS rn
        FROM probe_failures
        WHERE failed_at >= ?
      ) WHERE rn = 1
    `).all(from) as Array<{ provider_id: string; failed_at: string; message: string }>;
    return rows.map((row) => ({
      providerId: row.provider_id,
      failedAt: row.failed_at,
      message: row.message,
    }));
  }

  async getAppMeta(key: string): Promise<string | null> {
    const row = this.requireDb().query("SELECT value FROM app_meta WHERE key = ?").get(key) as
      | { value: string }
      | null;
    return row?.value ?? null;
  }

  async setAppMeta(key: string, value: string): Promise<void> {
    this.requireDb().query(`
      INSERT INTO app_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  forEachApiSnapshot(
    onRow: (row: { providerId: string; startedAt: string; rawJson: string }) => void,
  ): void {
    const query = this.requireDb().query(`
      SELECT provider_id, started_at, raw_json
      FROM usage_records
      WHERE source = 'api'
        AND tool = 'OpenUsage Plugin Snapshot'
        AND raw_json IS NOT NULL
      ORDER BY started_at ASC, id ASC
    `);
    for (const row of query.iterate() as Iterable<{
      provider_id: string;
      started_at: string;
      raw_json: string;
    }>) {
      onRow({
        providerId: row.provider_id,
        startedAt: row.started_at,
        rawJson: row.raw_json,
      });
    }
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

function rowToProviderAccount(row: ProviderAccountRow): ProviderAccount | null {
  if (!isMultiAccountProviderId(row.provider_id)) return null;
  return {
    id: row.id,
    providerId: row.provider_id as MultiAccountProviderId,
    label: row.label,
    homePath: row.home_path,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 10000) / 10000;
}

type QuotaObservationRow = {
  provider_id: string;
  observed_at: string;
  window_key: string;
  window_label: string;
  period_ms: number | null;
  resets_at: string | null;
  present: number;
  used_percent: number | null;
  limit_value: number | null;
  limit_unit: string | null;
  used_value: number | null;
};

function quotaObservationId(row: QuotaObservation): string {
  return createHash("sha256").update([
    row.providerId,
    row.windowKey,
    row.observedAt,
    row.present ? "1" : "0",
    row.usedPercent ?? "",
    row.limitValue ?? "",
    row.limitUnit ?? "",
    row.usedValue ?? "",
    row.resetsAt ?? "",
  ].join("|")).digest("hex");
}

function rowToQuotaObservation(row: QuotaObservationRow): QuotaObservation {
  return {
    providerId: row.provider_id,
    observedAt: row.observed_at,
    windowKey: row.window_key,
    windowLabel: row.window_label,
    periodMs: row.period_ms,
    resetsAt: row.resets_at,
    present: row.present === 1,
    usedPercent: row.used_percent,
    limitValue: row.limit_value,
    limitUnit: row.limit_unit === "usd" || row.limit_unit === "tokens" || row.limit_unit === "requests"
      ? row.limit_unit as QuotaLimitUnit
      : null,
    usedValue: row.used_value,
  };
}
