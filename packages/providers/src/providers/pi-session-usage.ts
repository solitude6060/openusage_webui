// Ported from robinebers/openusage bb7de176def23a99bbdcaabe1ac7269f18c738be.
// Copyright (c) 2026 Robin Ebers. MIT license: see repository LICENSE.
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { ProviderId, UsageRecord } from "../../../core/src/types";
import { openAiTokenCostUsd } from "../openai-token-rates";
import { createUtilApi } from "./openusage-plugin-api";
import { expandHome } from "./openusage-plugin-runtime";
import { createTokenRecord } from "./structured-usage";

type JsonObject = Record<string, unknown>;
const { toIso } = createUtilApi();
type PiCard = "claude" | "codex";
type PiEntry = {
  id?: string;
  timestamp: Date;
  card: PiCard;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  carriedCost?: number;
};

export function piAgentDirectory(homeDir: string, env: Record<string, string | undefined>): string {
  const override = env.PI_CODING_AGENT_DIR?.trim();
  return override ? expandHome(override, homeDir) : join(homeDir, ".pi/agent");
}

export function piSessionsDirectory(homeDir: string, env: Record<string, string | undefined>): string {
  const override = env.PI_CODING_AGENT_SESSION_DIR?.trim();
  return override ? expandHome(override, homeDir) : join(piAgentDirectory(homeDir, env), "sessions");
}

export function scanPiSessionUsage(options: {
  providerId: ProviderId;
  card: PiCard;
  homeDir: string;
  env?: Record<string, string | undefined>;
  now?: string;
}): UsageRecord[] {
  const since = new Date(options.now ?? new Date().toISOString());
  since.setDate(since.getDate() - 30);
  since.setHours(0, 0, 0, 0);
  const seen = new Set<string>();
  const totals = new Map<string, { startedAt: string; entry: PiEntry; costUsd?: number }>();
  // shortcut: full rescan instead of upstream's persistent cache; add caching if refresh timing requires it.
  const files = jsonlFiles(piSessionsDirectory(options.homeDir, options.env ?? {}));
  for (const file of files) {
    let contents: string;
    try { contents = readFileSync(file, "utf8"); } catch (error) {
      logReadError(error);
      continue;
    }
    for (const line of contents.split("\n")) {
      if (!line.includes('"usage":{')) continue;
      const entry = parseLine(line);
      if (!entry) continue;
      if (entry.id !== undefined) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
      }
      if (entry.card !== options.card || entry.timestamp < since) continue;
      const costUsd = entryCost(entry);
      if (entry.totalTokens <= 0 && costUsd === undefined) continue;
      const startedAt = localDay(entry.timestamp);
      const key = `${startedAt}|${entry.model}`;
      const current = totals.get(key);
      if (current) {
        current.entry.inputTokens += entry.inputTokens;
        current.entry.outputTokens += entry.outputTokens;
        current.entry.cacheCreationTokens += entry.cacheCreationTokens;
        current.entry.cacheReadTokens += entry.cacheReadTokens;
        current.entry.totalTokens += entry.totalTokens;
        current.costUsd = current.costUsd === undefined || costUsd === undefined
          ? undefined : current.costUsd + costUsd;
      } else {
        totals.set(key, { startedAt, entry, costUsd });
      }
    }
  }
  return [...totals.values()].map(({ startedAt, entry, costUsd }) => createTokenRecord(
    options.providerId, startedAt, entry.model,
    { inputTokens: entry.inputTokens, outputTokens: entry.outputTokens,
      cacheCreationTokens: entry.cacheCreationTokens, cacheReadTokens: entry.cacheReadTokens,
      totalTokens: entry.totalTokens },
    "pi-session", costUsd,
  ));
}

function parseLine(line: string): PiEntry | null {
  let object: unknown;
  try { object = JSON.parse(line); } catch { return null; }
  if (!isObject(object) || object.type !== "message" || typeof object.timestamp !== "string") return null;
  const normalized = object.timestamp.trim()
    .replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T").replace(/ UTC$/, "Z");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(normalized)) return null;
  const timestampIso = toIso(normalized);
  if (!timestampIso) return null;
  const timestamp = new Date(timestampIso);
  const message = object.message;
  if (!isObject(message) || message.role !== "assistant" || !isObject(message.usage)) return null;
  const card = message.provider === "openai-codex" ? "codex"
    : message.provider === "anthropic" || message.provider === "claude-agent-sdk" ? "claude" : null;
  if (!card) return null;
  const usage = message.usage;
  const cacheWrite = Math.trunc(number(usage.cacheWrite) ?? 0);
  const cacheWrite1h = Math.trunc(number(usage.cacheWrite1h) ?? 0);
  return {
    id: typeof object.id === "string" ? object.id : undefined,
    timestamp,
    card,
    model: typeof message.model === "string" && message.model.trim() ? message.model.trim() : "Unknown",
    inputTokens: Math.trunc(number(usage.input) ?? 0),
    outputTokens: Math.trunc(number(usage.output) ?? 0),
    cacheCreationTokens: Math.max(cacheWrite - cacheWrite1h, 0) + cacheWrite1h,
    cacheReadTokens: Math.trunc(number(usage.cacheRead) ?? 0),
    totalTokens: Math.trunc(number(usage.totalTokens) ?? 0),
    carriedCost: isObject(usage.cost) ? number(usage.cost.total) : undefined,
  };
}

function entryCost(entry: PiEntry): number | undefined {
  if (entry.card === "codex" && entry.model === "codex-auto-review"
    && entry.timestamp.getTime() >= Date.parse("2026-10-06T00:00:00Z")) return 0;
  if (entry.carriedCost !== undefined && entry.carriedCost > 0) return entry.carriedCost;
  return entry.card === "codex" ? openAiTokenCostUsd(entry.model, entry) : undefined;
}

function localDay(timestamp: Date): string {
  const year = timestamp.getFullYear();
  const month = String(timestamp.getMonth() + 1).padStart(2, "0");
  const day = String(timestamp.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

function jsonlFiles(root: string): string[] {
  let directory: string;
  try { directory = realpathSync(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") logReadError(error);
    return [];
  }
  const files: string[] = [];
  const walk = (path: string) => {
    let entries;
    try { entries = readdirSync(path, { withFileTypes: true }); } catch (error) {
      logReadError(error);
      return;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(child);
    }
  };
  walk(directory);
  return files.sort();
}

function logReadError(error: unknown): void {
  console.error("Pi session token scan failed:", (error as NodeJS.ErrnoException).code ?? "UNKNOWN");
}

function number(value: unknown): number | undefined {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
