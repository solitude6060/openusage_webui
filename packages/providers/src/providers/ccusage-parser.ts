import { createHash } from "node:crypto";
import type { ProviderId, UsageRecord } from "../../../core/src/types";

type JsonObject = Record<string, unknown>;

export function normalizeCcusageRecords(stdout: string, command: string): UsageRecord[] {
  return parseCcusageRecords(stdout, command).records;
}

export function parseCcusageRecords(
  stdout: string,
  command: string,
): { parsed: boolean; rowCount: number; records: UsageRecord[] } {
  const parsed = parseCcusageOutput(stdout);
  if (!parsed.ok) {
    return { parsed: false, rowCount: 0, records: [] };
  }

  const rows = extractRows(parsed.value);
  const records = rows
    .map((row) => normalizeRow(row, command))
    .filter((record): record is UsageRecord => record !== null);
  return { parsed: true, rowCount: rows.length, records };
}

export function createRawCcusageRecord(stdout: string, command: string): UsageRecord {
  const startedAt = startOfTodayIso();
  return {
    id: stableUsageId({
      providerId: "ccusage",
      tool: `ccusage ${command}`,
      startedAt,
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

export function parseCcusageJsonPayload(stdout: string): unknown | null {
  const parsed = parseCcusageOutput(stdout);
  return parsed.ok ? parsed.value : null;
}

function extractLastJsonValue(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  if (isJson(trimmed)) {
    return trimmed;
  }

  const starts = [...trimmed.matchAll(/[\[{]/g)].map((match) => match.index ?? 0);
  let selected: string | null = null;
  for (const start of starts) {
    const candidate = extractBalancedJsonValue(trimmed, start);
    if (!candidate) {
      continue;
    }
    const after = trimmed.slice(candidate.end + 1).trimStart();
    if (after.startsWith("}") || after.startsWith("]") || after.startsWith(",")) {
      continue;
    }
    if (isJson(candidate.text)) {
      selected = candidate.text;
    }
  }
  return selected;
}

function extractBalancedJsonValue(value: string, start: number): { text: string; end: number } | null {
  const first = value[start];
  if (first !== "{" && first !== "[") {
    return null;
  }

  const stack: string[] = [];
  let inString = false;
  let escaping = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char !== "}" && char !== "]") {
      continue;
    }

    const opener = stack.pop();
    if ((char === "}" && opener !== "{") || (char === "]" && opener !== "[")) {
      return null;
    }
    if (stack.length === 0) {
      return {
        text: value.slice(start, index + 1),
        end: index,
      };
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

  const compactMonth = value.match(/^(\d{4})(\d{2})$/);
  if (compactMonth) {
    return `${compactMonth[1]}-${compactMonth[2]}-01T00:00:00.000Z`;
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
