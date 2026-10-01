import { createHash } from "node:crypto";
import type { ProviderId, UsageRecord, UsageSource } from "../../../core/src/types";
import { openAiTokenCostUsd } from "../openai-token-rates";

type JsonObject = Record<string, unknown>;
type TokenRecordKind = "ccusage" | "cursor-event" | "grok-session";

export function normalizeCcusageDailyRecords(
  providerId: ProviderId,
  daily: Array<Record<string, unknown>>,
): UsageRecord[] {
  const records: UsageRecord[] = [];

  for (const day of daily) {
    const startedAt = usageDate(day.date);
    if (!startedAt) continue;

    const dayRecords: UsageRecord[] = [];
    const modelRows = ccusageModelRows(day);
    let modelTokens = 0;
    for (const { model, usage } of modelRows) {
      const record = tokenRecord(providerId, startedAt, model, usage, "ccusage");
      if (!record) continue;
      modelTokens += record.totalTokens ?? 0;
      dayRecords.push(record);
    }

    const dayTokens = finiteNumber(day.totalTokens);
    const remainder = dayTokens === undefined ? 0 : dayTokens - modelTokens;
    if (remainder > 0) {
      dayRecords.push(tokenRecord(providerId, startedAt, "Unknown", { totalTokens: remainder }, "ccusage")!);
    }
    applyDayCost(day, dayRecords);
    if (providerId === "codex" || providerId.startsWith("codex:")) {
      applyListedTokenRates(dayRecords);
    }
    records.push(...dayRecords);
  }

  return records;
}

export class CursorUsageCollector {
  private readonly events: JsonObject[] = [];
  private expectedCount: number | null = null;
  private complete = false;
  private failed = false;

  capture(status: number, bodyText: string): void {
    if (status < 200 || status >= 300) {
      this.failed = true;
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      this.failed = true;
      return;
    }
    if (!isObject(body) || !Array.isArray(body.usageEventsDisplay)) {
      this.failed = true;
      return;
    }

    this.events.push(...body.usageEventsDisplay.filter(isObject));
    const total = finiteNumber(body.totalUsageEventsCount);
    if (total !== undefined) this.expectedCount = total;
    this.complete = this.expectedCount !== null
      ? this.events.length >= this.expectedCount
      : body.usageEventsDisplay.length < 200;
  }

  records(providerId: ProviderId): UsageRecord[] {
    if (this.failed || !this.complete) return [];

    const totals = new Map<
      string,
      { startedAt: string; model: string; tokens: TokenValues; costUsd: number; costKnown: boolean }
    >();
    for (const event of this.events) {
      if (!isObject(event.tokenUsage)) continue;
      const timestamp = eventTimestamp(event.timestamp);
      if (!timestamp) continue;
      const startedAt = `${timestamp.slice(0, 10)}T00:00:00.000Z`;
      const model = text(event.model) ?? "Unknown";
      const tokens = tokenValues(event.tokenUsage);
      if (!tokens) continue;
      const costUsd = eventCostUsd(event);
      const key = `${startedAt}|${model}`;
      const current = totals.get(key);
      if (current) {
        addTokenValues(current.tokens, tokens);
        if (costUsd === undefined) current.costKnown = false;
        else current.costUsd += costUsd;
      } else {
        totals.set(key, {
          startedAt,
          model,
          tokens,
          costUsd: costUsd ?? 0,
          costKnown: costUsd !== undefined,
        });
      }
    }

    return [...totals.values()].map(({ startedAt, model, tokens, costUsd, costKnown }) =>
      createTokenRecord(providerId, startedAt, model, tokens, "cursor-event", costKnown ? costUsd : undefined));
  }
}

function ccusageModelRows(day: JsonObject): Array<{ model: string; usage: JsonObject }> {
  if (isObject(day.models)) {
    const models = Object.entries(day.models)
      .filter((entry): entry is [string, JsonObject] => isObject(entry[1]))
      .map(([model, usage]) => ({ model, usage }));
    if (models.length > 0) return models;
  }
  if (!Array.isArray(day.modelBreakdowns)) return [];
  return day.modelBreakdowns.flatMap((value) => {
    if (!isObject(value)) return [];
    const model = text(value.modelName) ?? text(value.name) ?? text(value.model);
    return model ? [{ model, usage: value }] : [];
  });
}

function tokenRecord(
  providerId: ProviderId,
  startedAt: string,
  model: string,
  usage: JsonObject,
  kind: TokenRecordKind,
): UsageRecord | null {
  const tokens = tokenValues(usage);
  if (!tokens) return null;
  const record = createTokenRecord(providerId, startedAt, model, tokens, kind);
  const cost = usageCostUsd(usage);
  if (cost !== undefined) setRecordCost(record, cost, "reported-model");
  return record;
}

function applyListedTokenRates(records: UsageRecord[]): void {
  for (const record of records) {
    if (record.costUsd !== undefined) continue;
    const cost = openAiTokenCostUsd(record.model, record);
    if (cost !== undefined) setRecordCost(record, cost, "standard-rate");
  }
}

function applyDayCost(day: JsonObject, dayRecords: UsageRecord[]): void {
  const dayCost = usageCostUsd(day);
  if (dayCost === undefined || dayRecords.length === 0) return;
  const unknown = dayRecords.filter((record) => record.costUsd === undefined);
  if (unknown.length !== 1) return;
  const knownSum = dayRecords.reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
  const remainder = dayCost - knownSum;
  if (remainder >= 0) setRecordCost(unknown[0]!, remainder, "reported-day");
}

function setRecordCost(
  record: UsageRecord,
  costUsd: number,
  costSource: "reported-model" | "reported-day" | "standard-rate",
): void {
  record.costUsd = costUsd;
  record.raw = { ...(isObject(record.raw) ? record.raw : {}), costSource };
}

function usageCostUsd(usage: JsonObject): number | undefined {
  return finiteNumber(usage.costUSD ?? usage.totalCost ?? usage.costUsd ?? usage.cost);
}

function eventCostUsd(event: JsonObject): number | undefined {
  const charged = finiteNumber(event.chargedCents);
  const usage = isObject(event.tokenUsage) ? event.tokenUsage : undefined;
  const totalCents = usage ? finiteNumber(usage.totalCents) : undefined;
  const cents = charged !== undefined && charged > 0
    ? charged
    : totalCents !== undefined && totalCents > 0
      ? totalCents
      : charged !== undefined
        ? charged
        : totalCents;
  if (cents !== undefined) return cents / 100;
  if (typeof event.usageBasedCosts === "string") {
    const amount = event.usageBasedCosts.trim();
    if (!/^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(amount)) return undefined;
    const parsed = Number(amount.replace(/[$,]/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

type TokenValues = {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens: number;
};

function tokenValues(usage: JsonObject): TokenValues | null {
  const inputTokens = finiteNumber(usage.inputTokens);
  const outputTokens = finiteNumber(usage.outputTokens);
  const cacheCreationTokens = finiteNumber(usage.cacheCreationTokens ?? usage.cacheWriteTokens);
  const cacheReadTokens = finiteNumber(usage.cacheReadTokens ?? usage.cachedInputTokens);
  const explicitTotal = finiteNumber(usage.totalTokens);
  const totalTokens = explicitTotal ?? [
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    finiteNumber(usage.reasoningOutputTokens),
  ].reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (totalTokens <= 0) return null;

  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalTokens };
}

export function createTokenRecord(
  providerId: ProviderId,
  startedAt: string,
  model: string,
  tokens: TokenValues,
  kind: TokenRecordKind,
  costUsd?: number,
): UsageRecord {
  const tool =
    kind === "ccusage" ? "ccusage" : kind === "grok-session" ? "Grok Session" : "Cursor Usage Event";
  const source: UsageSource = kind === "cursor-event" ? "api" : "local-log";
  return {
    id: createHash("sha256")
      .update([providerId, kind, startedAt, model].join("|"))
      .digest("hex"),
    providerId,
    tool,
    model,
    ...tokens,
    ...(costUsd !== undefined ? { costUsd } : {}),
    startedAt,
    source,
  };
}

function addTokenValues(target: TokenValues, value: TokenValues): void {
  target.inputTokens = addOptional(target.inputTokens, value.inputTokens);
  target.outputTokens = addOptional(target.outputTokens, value.outputTokens);
  target.cacheCreationTokens = addOptional(target.cacheCreationTokens, value.cacheCreationTokens);
  target.cacheReadTokens = addOptional(target.cacheReadTokens, value.cacheReadTokens);
  target.totalTokens += value.totalTokens;
}

function addOptional(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

function usageDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt\s]|$)/);
  const parts = compact ?? dashed;
  if (parts) return `${parts[1]}-${parts[2]}-${parts[3]}T00:00:00.000Z`;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function eventTimestamp(value: unknown): string | null {
  if (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))) {
    const number = Number(value);
    const milliseconds = Math.abs(number) < 1e11 ? number * 1000 : number;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const raw = text(value);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
