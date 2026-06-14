import { createHash } from "node:crypto";
import type { ProviderId, UsageRecord } from "../../../core/src/types";

type JsonObject = Record<string, unknown>;

export function normalizeCcusageRecords(stdout: string, command: string): UsageRecord[] {
  return parseCcusageRecords(stdout, command).records;
}

export function parseCcusageRecords(
  stdout: string,
  command: string,
): { parsed: boolean; records: UsageRecord[] } {
  const parsed = parseCcusageOutput(stdout);
  if (!parsed.ok) {
    return { parsed: false, records: [] };
  }

  const rows = extractRows(parsed.value);
  const records = rows
    .map((row) => normalizeRow(row, command))
    .filter((record): record is UsageRecord => record !== null);
  return { parsed: true, records };
}

export function createRawCcusageRecord(stdout: string, command: string): UsageRecord {
  const startedAt = startOfTodayIso();
  return {
    id: stableUsageId({
      providerId: "ccusage",
      tool: `ccusage ${command}`,
      startedAt,
      totalTokens: 0,
      costUsd: 0,
      command,
    }),
    providerId: "ccusage",
    tool: `ccusage ${command}`,
    totalTokens: 0,
    costUsd: 0,
    startedAt,
    source: "cli",
    raw: {
      command,
      stdout,
    },
  };
}

function normalizeRow(row: JsonObject, command: string): UsageRecord | null {
  const startedAt = parseStartedAt(row);
  if (!startedAt) {
    return null;
  }

  const tool = textField(row, ["tool", "source", "provider", "agent"]);
  const providerId = providerIdFromTool(tool);
  const totalTokens = numberField(row, ["totalTokens", "tokens"]);
  const costUsd = numberField(row, ["totalCost", "costUSD", "costUsd", "cost"]);
  const inputTokens = numberField(row, ["inputTokens"]);
  const outputTokens = numberField(row, ["outputTokens"]);
  const cacheCreationTokens = numberField(row, ["cacheCreationTokens"]);
  const cacheReadTokens = numberField(row, ["cacheReadTokens", "cachedInputTokens"]);
  const model = textField(row, ["model", "modelName"]);

  return {
    id: stableUsageId({
      providerId,
      tool,
      model,
      startedAt,
      totalTokens: totalTokens ?? 0,
      costUsd: costUsd ?? 0,
      command,
    }),
    providerId,
    tool: tool ?? "ccusage",
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalTokens,
    costUsd,
    startedAt,
    source: "cli",
    raw: {
      command,
      row,
    },
  };
}

function parseCcusageOutput(stdout: string): { ok: true; value: unknown } | { ok: false } {
  const jsonText = extractLastJsonValue(stdout);
  if (!jsonText) {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(jsonText) };
  } catch {
    return { ok: false };
  }
}

function extractLastJsonValue(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  if (isJson(trimmed)) {
    return trimmed;
  }

  const starts = [...trimmed.matchAll(/[\[{]/g)].map((match) => match.index ?? 0).reverse();
  for (const start of starts) {
    const candidate = trimmed.slice(start).trim();
    if (isJson(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function extractRows(parsed: unknown): JsonObject[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(isObject);
  }
  if (!isObject(parsed)) {
    return [];
  }

  for (const key of ["daily", "sessions", "session", "monthly", "months", "records"]) {
    const value = parsed[key];
    if (Array.isArray(value)) {
      return value.filter(isObject);
    }
  }

  const data = parsed.data;
  if (isObject(data)) {
    return extractRows(data);
  }
  return [];
}

function parseStartedAt(row: JsonObject): string | null {
  const raw = textField(row, ["startedAt", "startTime", "timestamp", "date", "month"]);
  if (!raw) {
    return null;
  }

  const value = raw.trim();
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}T00:00:00.000Z`;
  }

  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00.000Z`;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function providerIdFromTool(tool: string | undefined): ProviderId {
  const value = (tool ?? "").toLowerCase();
  if (value.includes("claude")) {
    return "claude-code";
  }
  if (value.includes("codex")) {
    return "codex";
  }
  if (value.includes("copilot")) {
    return "github-copilot";
  }
  if (value.includes("gemini") || value.includes("google ai")) {
    return "gemini-cli";
  }
  return "ccusage";
}

function textField(row: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function numberField(row: JsonObject, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined) {
      continue;
    }
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return undefined;
}

function stableUsageId(input: {
  providerId: ProviderId;
  tool?: string;
  model?: string;
  startedAt: string;
  totalTokens: number;
  costUsd: number;
  command: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.providerId,
        input.tool ?? "",
        input.model ?? "",
        input.startedAt,
        input.command,
      ].join("|"),
    )
    .digest("hex");
}

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
