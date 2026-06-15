import { createHash } from "node:crypto";
import type { UsageRecord } from "../../../core/src/types";
import type { UsageProvider } from "../types";

const GLOBAL_USAGE_URL = "https://www.minimax.io/v1/token_plan/remains";
const CN_USAGE_URL = "https://api.minimaxi.com/v1/token_plan/remains";
const GLOBAL_API_KEY_ENV_VARS = ["MINIMAX_API_KEY", "MINIMAX_API_TOKEN"] as const;
const CN_API_KEY_ENV_VARS = ["MINIMAX_CN_API_KEY", "MINIMAX_API_KEY", "MINIMAX_API_TOKEN"] as const;
const MODEL_CALLS_PER_PROMPT = 15;
const REQUEST_TIMEOUT_MS = 15_000;

const GLOBAL_PROMPT_LIMIT_TO_PLAN: Record<number, string> = {
  100: "Starter",
  300: "Plus",
  1000: "Max",
  2000: "Ultra",
};

const CN_PROMPT_LIMIT_TO_PLAN: Record<number, string> = {
  600: "Starter",
  1500: "Plus",
  4500: "Max",
};

type Region = "CN" | "GLOBAL";
type JsonObject = Record<string, unknown>;

export interface MiniMaxProviderOptions {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface ParsedQuota {
  model?: string;
  planName?: string;
  used: number;
  limit: number;
  remaining: number;
  format: "count" | "percent";
  suffix?: string;
  startedAt: string;
  endedAt?: string;
  periodDurationMs?: number;
}

export class MiniMaxProvider implements UsageProvider {
  id = "minimax" as const;
  name = "MiniMax";
  private readonly env: Record<string, string | undefined>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: MiniMaxProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async detect(): Promise<boolean> {
    return this.endpointAttempts().some((region) => this.loadApiKey(region) !== null);
  }

  async refresh(): Promise<UsageRecord[]> {
    let lastError: string | null = null;
    for (const region of this.endpointAttempts()) {
      const apiKey = this.loadApiKey(region);
      if (!apiKey) {
        continue;
      }
      try {
        const payload = await this.fetchPayload(region, apiKey);
        const parsed = parsePayload(payload, region);
        if (!parsed) {
          lastError = "Could not parse usage data.";
          continue;
        }
        return [recordFromQuota(parsed, region)];
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    throw new Error(
      lastError ?? "MiniMax API key missing. Set MINIMAX_API_KEY or MINIMAX_CN_API_KEY.",
    );
  }

  private endpointAttempts(): Region[] {
    return readString(this.env.MINIMAX_CN_API_KEY) ? ["CN", "GLOBAL"] : ["GLOBAL", "CN"];
  }

  private loadApiKey(region: Region): string | null {
    const keys = region === "CN" ? CN_API_KEY_ENV_VARS : GLOBAL_API_KEY_ENV_VARS;
    for (const key of keys) {
      const value = readString(this.env[key]);
      if (value) {
        return value;
      }
    }
    return null;
  }

  private async fetchPayload(region: Region, apiKey: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(region === "CN" ? CN_USAGE_URL : GLOBAL_USAGE_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error("Session expired. Check your MiniMax API key.");
      }
      if (!response.ok) {
        throw new Error(`Request failed (HTTP ${response.status}). Try again later.`);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error("Request failed. Check your connection.");
        }
        throw error;
      }
      throw new Error("Request failed. Check your connection.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parsePayload(payload: unknown, region: Region): ParsedQuota | null {
  if (!isObject(payload)) {
    return null;
  }
  const data = isObject(payload.data) ? payload.data : payload;
  const baseResp = isObject(data.base_resp)
    ? data.base_resp
    : isObject(payload.base_resp)
      ? payload.base_resp
      : null;
  const statusCode = baseResp ? numberField(baseResp, ["status_code", "statusCode"]) : undefined;
  const statusMessage = baseResp ? textField(baseResp, ["status_msg", "statusMsg"]) : undefined;
  if (statusCode !== undefined && statusCode !== 0) {
    if (statusCode === 1004 || /cookie|log in|login/i.test(statusMessage ?? "")) {
      throw new Error("Session expired. Check your MiniMax API key.");
    }
    throw new Error(statusMessage ? `MiniMax API error: ${statusMessage}` : `MiniMax API error (status ${statusCode}).`);
  }

  const rows = arrayField(data, ["model_remains", "modelRemains"])
    ?? arrayField(payload, ["model_remains", "modelRemains"]);
  if (!rows || rows.length === 0) {
    return null;
  }

  const multiplier = region === "CN" ? 1 / MODEL_CALLS_PER_PROMPT : 1;
  let chosen: JsonObject | null = null;
  let percentFallback: JsonObject | null = null;
  let generalPercentFallback: JsonObject | null = null;
  for (const row of rows) {
    const total = numberField(row, ["current_interval_total_count", "currentIntervalTotalCount"]);
    if (total !== undefined && total > 0 && Math.round(total * multiplier) > 0) {
      chosen = row;
      break;
    }
    const remainingPercent = numberField(row, [
      "current_interval_remaining_percent",
      "currentIntervalRemainingPercent",
    ]);
    if (remainingPercent !== undefined && remainingPercent >= 0 && remainingPercent <= 100) {
      percentFallback ??= row;
      if (!generalPercentFallback && textField(row, ["model_name", "modelName"]) === "general") {
        generalPercentFallback = row;
      }
    }
  }
  chosen ??= generalPercentFallback ?? percentFallback;
  if (!chosen) {
    return null;
  }

  const model = textField(chosen, ["model_name", "modelName"]);
  const total = numberField(chosen, ["current_interval_total_count", "currentIntervalTotalCount"]);
  const remainingPercent = numberField(chosen, [
    "current_interval_remaining_percent",
    "currentIntervalRemainingPercent",
  ]);
  const times = readTimes(chosen);
  const planName = normalizePlanName(
    pickFirstString([
      data.current_subscribe_title,
      data.plan_name,
      data.plan,
      data.current_plan_title,
      data.combo_title,
      payload.current_subscribe_title,
      payload.plan_name,
      payload.plan,
    ]),
  ) ?? inferPlanName(total, region);

  if (!(total !== undefined && total > 0 && Math.round(total * multiplier) > 0)) {
    if (remainingPercent === undefined) {
      return null;
    }
    return {
      model,
      planName,
      used: 100 - remainingPercent,
      limit: 100,
      remaining: remainingPercent,
      format: "percent",
      startedAt: times.startedAt,
      endedAt: times.endedAt,
      periodDurationMs: times.periodDurationMs,
    };
  }

  const remaining = remainingCount(chosen);
  const explicitUsed = numberField(chosen, [
    "current_interval_used_count",
    "currentIntervalUsedCount",
    "used_count",
    "used",
  ]);
  let used = explicitUsed;
  if (used === undefined && remaining !== undefined) {
    used = total - remaining;
  }
  if (used === undefined) {
    return null;
  }

  const displayUsed = clamp(Math.round(used * multiplier), 0, Math.round(total * multiplier));
  const displayLimit = Math.round(total * multiplier);
  return {
    model,
    planName,
    used: displayUsed,
    limit: displayLimit,
    remaining: Math.max(displayLimit - displayUsed, 0),
    format: "count",
    suffix: "prompts",
    startedAt: times.startedAt,
    endedAt: times.endedAt,
    periodDurationMs: times.periodDurationMs,
  };
}

function recordFromQuota(quota: ParsedQuota, region: Region): UsageRecord {
  const planName = quota.planName ? `${quota.planName} (${region})` : undefined;
  return {
    id: createHash("sha256")
      .update([
        "minimax",
        region,
        quota.model ?? "",
        quota.startedAt,
        quota.endedAt ?? "",
        quota.limit,
        quota.format,
      ].join("|"))
      .digest("hex"),
    providerId: "minimax",
    tool: "MiniMax Token Plan",
    model: quota.model,
    startedAt: quota.startedAt,
    endedAt: quota.endedAt,
    source: "api",
    raw: {
      region,
      planName,
      quota: {
        format: quota.format,
        used: quota.used,
        limit: quota.limit,
        remaining: quota.remaining,
        suffix: quota.suffix,
        resetsAt: quota.endedAt,
        periodDurationMs: quota.periodDurationMs,
      },
    },
  };
}

function readTimes(row: JsonObject): {
  startedAt: string;
  endedAt?: string;
  periodDurationMs?: number;
} {
  const startMs = epochToMs(row.start_time ?? row.startTime);
  const endMs = epochToMs(row.end_time ?? row.endTime);
  const startedAt = new Date(startMs ?? Date.now()).toISOString();
  const endedAt = endMs === undefined ? undefined : new Date(endMs).toISOString();
  const periodDurationMs = startMs !== undefined && endMs !== undefined && endMs > startMs
    ? endMs - startMs
    : undefined;
  return { startedAt, endedAt, periodDurationMs };
}

function remainingCount(row: JsonObject): number | undefined {
  return numberField(row, [
    "current_interval_remaining_count",
    "currentIntervalRemainingCount",
    "current_interval_remains_count",
    "currentIntervalRemainsCount",
    "current_interval_remain_count",
    "currentIntervalRemainCount",
    "remaining_count",
    "remainingCount",
    "remains_count",
    "remainsCount",
    "remaining",
    "remains",
    "left_count",
    "leftCount",
    "current_interval_usage_count",
    "currentIntervalUsageCount",
  ]);
}

function inferPlanName(total: number | undefined, region: Region): string | undefined {
  if (total === undefined || total <= 0) {
    return undefined;
  }
  const rounded = Math.round(total);
  if (region === "CN") {
    return CN_PROMPT_LIMIT_TO_PLAN[rounded];
  }
  if (GLOBAL_PROMPT_LIMIT_TO_PLAN[rounded]) {
    return GLOBAL_PROMPT_LIMIT_TO_PLAN[rounded];
  }
  if (rounded % MODEL_CALLS_PER_PROMPT !== 0) {
    return undefined;
  }
  return GLOBAL_PROMPT_LIMIT_TO_PLAN[rounded / MODEL_CALLS_PER_PROMPT];
}

function normalizePlanName(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  const withoutPrefix = compact.replace(/^minimax\s+coding\s+plan\b[:\-]?\s*/i, "").trim();
  if (withoutPrefix) {
    return withoutPrefix;
  }
  return /coding\s+plan/i.test(compact) ? "Coding Plan" : compact;
}

function epochToMs(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number)) {
    return undefined;
  }
  return Math.abs(number) < 1e10 ? number * 1000 : number;
}

function pickFirstString(values: unknown[]): string | null {
  for (const value of values) {
    const string = readString(value);
    if (string) {
      return string;
    }
  }
  return null;
}

function arrayField(row: JsonObject, keys: string[]): JsonObject[] | null {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) {
      return value.filter(isObject);
    }
  }
  return null;
}

function textField(row: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readString(row[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function numberField(row: JsonObject, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return undefined;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
