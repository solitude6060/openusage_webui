import type { Database } from "bun:sqlite";

export const CODEX_TOKEN_EVENTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS codex_token_events (
    provider_id TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    input INTEGER NOT NULL,
    cached_input INTEGER NOT NULL,
    output INTEGER NOT NULL,
    plan_type TEXT,
    weekly_used_percent REAL,
    weekly_resets_at TEXT,
    total_tokens INTEGER NOT NULL,
    UNIQUE (provider_id, observed_at, total_tokens)
  );

  CREATE INDEX IF NOT EXISTS idx_codex_token_events_provider_time
  ON codex_token_events(provider_id, observed_at);

  CREATE TABLE IF NOT EXISTS codex_event_cursors (
    path TEXT PRIMARY KEY,
    mtime_ms INTEGER NOT NULL,
    offset INTEGER NOT NULL,
    last_total_tokens INTEGER
  );
`;

export interface CodexTokenEventInsert {
  providerId: string;
  observedAt: string;
  tokens: number;
  input: number;
  cachedInput: number;
  output: number;
  planType: string | null;
  weeklyUsedPercent: number | null;
  weeklyResetsAt: string | null;
  totalTokens: number;
}

export interface CodexEventCursor {
  path: string;
  mtimeMs: number;
  offset: number;
  lastTotalTokens: number | null;
}

export interface CodexTokenEventReading {
  providerId: string;
  observedAt: string;
  tokens: number;
}

const INSERT_CODEX_TOKEN_EVENT = `
  INSERT OR IGNORE INTO codex_token_events (
    provider_id, observed_at, tokens, input, cached_input, output,
    plan_type, weekly_used_percent, weekly_resets_at, total_tokens
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function runCodexTokenEventInsert(
  insert: { run: (...params: unknown[]) => unknown },
  row: CodexTokenEventInsert,
): void {
  insert.run(
    row.providerId,
    row.observedAt,
    row.tokens,
    row.input,
    row.cachedInput,
    row.output,
    row.planType,
    row.weeklyUsedPercent,
    row.weeklyResetsAt,
    row.totalTokens,
  );
}

export function insertCodexTokenEvents(db: Database, events: CodexTokenEventInsert[]): void {
  if (events.length === 0) return;
  const insert = db.prepare(INSERT_CODEX_TOKEN_EVENT);
  const write = db.transaction((rows: CodexTokenEventInsert[]) => {
    for (const row of rows) runCodexTokenEventInsert(insert, row);
  });
  write(events);
}

export function replaceCodexTokenEvents(
  db: Database,
  providerIds: string[],
  events: CodexTokenEventInsert[],
): void {
  const insert = db.prepare(INSERT_CODEX_TOKEN_EVENT);
  const write = db.transaction((ids: string[], rows: CodexTokenEventInsert[]) => {
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(", ");
      db.query(`DELETE FROM codex_token_events WHERE provider_id IN (${placeholders})`).run(...ids);
    }
    for (const row of rows) runCodexTokenEventInsert(insert, row);
  });
  write(providerIds, events);
}

export function listCodexTokenEventReadings(db: Database, from: string): CodexTokenEventReading[] {
  const rows = db.query(`
    SELECT provider_id, observed_at, tokens
    FROM codex_token_events
    WHERE tokens > 0 AND observed_at >= ?
  `).all(from) as Array<{ provider_id: string; observed_at: string; tokens: number }>;
  return rows.map((row) => ({
    providerId: row.provider_id,
    observedAt: row.observed_at,
    tokens: Number(row.tokens) || 0,
  }));
}

export function listCodexEventProviderIds(db: Database, from: string): string[] {
  const rows = db.query(`
    SELECT DISTINCT provider_id
    FROM codex_token_events
    WHERE observed_at >= ?
    ORDER BY provider_id
  `).all(from) as Array<{ provider_id: string }>;
  return rows.map((row) => row.provider_id);
}

export function listCodexEventCursors(db: Database): CodexEventCursor[] {
  const rows = db.query(`
    SELECT path, mtime_ms, offset, last_total_tokens
    FROM codex_event_cursors
  `).all() as Array<{
    path: string;
    mtime_ms: number;
    offset: number;
    last_total_tokens: number | null;
  }>;
  return rows.map((row) => ({
    path: row.path,
    mtimeMs: Number(row.mtime_ms),
    offset: Number(row.offset),
    lastTotalTokens: row.last_total_tokens == null ? null : Number(row.last_total_tokens),
  }));
}

export function saveCodexEventCursors(db: Database, cursors: CodexEventCursor[]): void {
  if (cursors.length === 0) return;
  const upsert = db.prepare(`
    INSERT INTO codex_event_cursors (path, mtime_ms, offset, last_total_tokens)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      mtime_ms = excluded.mtime_ms,
      offset = excluded.offset,
      last_total_tokens = excluded.last_total_tokens
  `);
  const write = db.transaction((rows: CodexEventCursor[]) => {
    for (const row of rows) upsert.run(row.path, row.mtimeMs, row.offset, row.lastTotalTokens);
  });
  write(cursors);
}
