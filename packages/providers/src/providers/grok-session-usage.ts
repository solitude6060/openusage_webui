import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProviderId, UsageRecord } from "../../../core/src/types";
import { expandHome } from "./openusage-plugin-runtime";
import { createTokenRecord } from "./structured-usage";

const MAXIMUM_PLAUSIBLE_TOKENS = 1_000_000_000_000;
const COST_TICKS_DIVISOR = 10_000_000_000;

type JsonObject = Record<string, unknown>;

type GrokSessionEntry = {
  eventID: string | null;
  startedAt: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUsd?: number;
};

export function grokHomePath(
  homeDir: string,
  env: Record<string, string | undefined> = {},
): string {
  const fromEnv = env.GROK_HOME?.trim();
  if (fromEnv) return expandHome(fromEnv, homeDir);
  return join(homeDir, ".grok");
}

export function parseGrokSessionFile(text: string): GrokSessionEntry[] {
  const entries: GrokSessionEntry[] = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.indexOf("turn_completed") < 0) continue;
    let object: unknown;
    try {
      object = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(object)) continue;
    entries.push(...parseCompletedTurn(object));
  }
  return entries;
}

export function scanGrokSessionUsage(options: {
  providerId: ProviderId;
  homeDir: string;
  env?: Record<string, string | undefined>;
}): UsageRecord[] {
  const sessionsDir = join(grokHomePath(options.homeDir, options.env ?? {}), "sessions");
  const files = listUpdatesJsonl(sessionsDir);
  const entries: GrokSessionEntry[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    entries.push(...parseGrokSessionFile(text));
  }
  return aggregateGrokSessionRecords(options.providerId, entries);
}

export function aggregateGrokSessionRecords(
  providerId: ProviderId,
  entries: GrokSessionEntry[],
): UsageRecord[] {
  const seen = new Set<string>();
  const totals = new Map<
    string,
    {
      startedAt: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      totalTokens: number;
      costUsd?: number;
    }
  >();

  for (const entry of entries) {
    if (entry.eventID) {
      const key = `${entry.eventID}\0${entry.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (entry.totalTokens <= 0) continue;
    const key = `${entry.startedAt}|${entry.model}`;
    const current = totals.get(key);
    if (current) {
      current.inputTokens += entry.inputTokens;
      current.outputTokens += entry.outputTokens;
      current.cacheCreationTokens += entry.cacheCreationTokens;
      current.cacheReadTokens += entry.cacheReadTokens;
      current.totalTokens += entry.totalTokens;
      if (entry.costUsd !== undefined || current.costUsd !== undefined) {
        current.costUsd = (current.costUsd ?? 0) + (entry.costUsd ?? 0);
      }
    } else {
      totals.set(key, { ...entry });
    }
  }

  return [...totals.values()].map((row) => {
    const record = createTokenRecord(
      providerId,
      row.startedAt,
      row.model,
      {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheCreationTokens: row.cacheCreationTokens,
        cacheReadTokens: row.cacheReadTokens,
        totalTokens: row.totalTokens,
      },
      "grok-session",
    );
    if (row.costUsd !== undefined) record.costUsd = row.costUsd;
    return record;
  });
}

function parseCompletedTurn(object: JsonObject): GrokSessionEntry[] {
  const params = isObject(object.params) ? object.params : undefined;
  const update = (params && isObject(params.update) ? params.update : undefined)
    ?? (isObject(object.update) ? object.update : undefined);
  if (!update || update.sessionUpdate !== "turn_completed") return [];
  const usage = isObject(update.usage) ? update.usage : undefined;
  const modelUsage = usage && isObject(usage.modelUsage) ? usage.modelUsage : undefined;
  const startedAt = startedAtFromObject(object, params);
  if (!usage || !modelUsage || !startedAt) return [];

  const topLevelTicks = parseNumber(usage.costUsdTicks);
  const models = Object.entries(modelUsage).sort(([left], [right]) => left.localeCompare(right));
  const entries: GrokSessionEntry[] = [];

  for (const [rawModel, rawUsage] of models) {
    const model = rawModel.trim();
    if (!model || !isObject(rawUsage)) continue;
    const inputValue = parseNumber(rawUsage.inputTokens);
    if (inputValue === undefined || inputValue < 0) continue;

    const input = boundedTokenCount(inputValue);
    const cacheRead = Math.min(boundedTokenCount(rawUsage.cachedReadTokens), input);
    const cacheWrite = Math.min(boundedTokenCount(rawUsage.cacheCreationTokens), input - cacheRead);
    const output = boundedTokenCount(rawUsage.outputTokens);
    const ticks = parseNumber(rawUsage.costUsdTicks)
      ?? (models.length === 1 ? topLevelTicks : undefined);
    const totalTokens = input + output;
    if (totalTokens <= 0) continue;

    entries.push({
      eventID: readEventId(params, object),
      startedAt,
      model,
      inputTokens: input - cacheRead - cacheWrite,
      outputTokens: output,
      cacheCreationTokens: cacheWrite,
      cacheReadTokens: cacheRead,
      totalTokens,
      costUsd: ticks !== undefined && ticks >= 0 ? ticks / COST_TICKS_DIVISOR : undefined,
    });
  }
  return entries;
}

function startedAtFromObject(object: JsonObject, params: JsonObject | undefined): string | null {
  for (const meta of [params && params._meta, object._meta]) {
    if (!isObject(meta)) continue;
    const milliseconds = parseNumber(meta.agentTimestampMs);
    if (milliseconds !== undefined && milliseconds > 0) {
      return utcDay(milliseconds);
    }
  }

  const timestamp = object.timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0) {
    const milliseconds = Math.abs(timestamp) < 1e11 ? timestamp * 1000 : timestamp;
    return utcDay(milliseconds);
  }
  if (typeof timestamp === "string" && timestamp.trim()) {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? utcDay(parsed) : null;
  }
  return null;
}

function utcDay(milliseconds: number): string | null {
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function readEventId(params: JsonObject | undefined, object: JsonObject): string | null {
  for (const meta of [params && params._meta, object._meta]) {
    if (!isObject(meta) || typeof meta.eventId !== "string") continue;
    const eventID = meta.eventId.trim();
    if (eventID) return eventID;
  }
  return null;
}

function listUpdatesJsonl(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      let info;
      try {
        info = entry.isSymbolicLink() ? statSync(path) : entry;
      } catch {
        continue;
      }
      if (info.isDirectory()) walk(path);
      else if (info.isFile() && entry.name === "updates.jsonl") files.push(path);
    }
  };
  walk(root);
  return files;
}

function boundedTokenCount(value: unknown): number {
  const number = parseNumber(value);
  if (number === undefined || number <= 0) return 0;
  if (number > MAXIMUM_PLAUSIBLE_TOKENS) return MAXIMUM_PLAUSIBLE_TOKENS;
  return Math.trunc(number);
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
