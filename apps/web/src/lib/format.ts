import type { UsageRecord } from "../../../../packages/core/src/types";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function numberFromUnknown(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatOptionalNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatNumber(value) : "-";
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatApiMoney(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded % 1 === 0 ? Math.round(rounded) : rounded}%`;
}

export function formatOptionalMoney(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatMoney(value) : "-";
}

export function clampUsageLimit(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 100;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(1000, Math.max(1, Math.trunc(parsed)));
}

export function emptySessionMessage(filtersActive: boolean): string {
  return filtersActive ? "No Records Match These Filters" : "No Usage Records Yet";
}

export function formatDate(value?: string): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatQuota(record: UsageRecord): string {
  if (!isPlainObject(record.raw) || !isPlainObject(record.raw.quota)) {
    return "-";
  }
  const quota = record.raw.quota;
  const used = numberFromUnknown(quota.used);
  const limit = numberFromUnknown(quota.limit);
  if (used === undefined || limit === undefined) {
    return "-";
  }
  const remaining = numberFromUnknown(quota.remaining);
  const suffix = typeof quota.suffix === "string" ? ` ${quota.suffix}` : "";
  const reset = typeof quota.resetsAt === "string" ? ` · Resets ${formatDate(quota.resetsAt)}` : "";
  const remainingText = remaining === undefined ? "" : ` · ${formatNumber(remaining)} Left`;
  return `${formatNumber(used)} / ${formatNumber(limit)}${suffix}${remainingText}${reset}`;
}

export function progressResetLabel(input: {
  resetsAt?: string | null;
  periodDurationMs?: number | null;
  used?: number | null;
  nowMs?: number;
}): string | null {
  const nowMs = input.nowMs ?? Date.now();
  if (typeof input.resetsAt === "string" && input.resetsAt.trim()) {
    const target = new Date(input.resetsAt).getTime();
    if (!Number.isFinite(target)) return null;
    if (target <= nowMs) return "Reset Due · Refresh For New Value";
    return `Resets ${formatRelativeTime(input.resetsAt, nowMs)}`;
  }
  const period = Number(input.periodDurationMs);
  if (Number.isFinite(period) && period > 0 && input.used === 0) {
    return "Window Starts On Next Use";
  }
  return null;
}

export function formatRelativeTime(isoString: string, nowMs = Date.now()): string {
  const target = new Date(isoString).getTime();
  const diffMs = target - nowMs;
  if (diffMs <= 0) return "now";
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `in ${days}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `in ${minutes}m`;
  return "in <1m";
}

export function toDatetimeLocal(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

export function optionalNumber(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function linesFromRaw(raw: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(raw.lines)) return raw.lines as Array<Record<string, unknown>>;
  if (isPlainObject(raw.quota)) {
    const q = raw.quota as Record<string, unknown>;
    const lines: Array<Record<string, unknown>> = [];
    const format = q.format === "count"
      ? { kind: "count", suffix: typeof q.suffix === "string" ? q.suffix : "prompts" }
      : { kind: "percent" };
    lines.push({
      type: "progress",
      label: "Usage",
      used: Number(q.used) || 0,
      limit: Number(q.limit) || 100,
      format,
      resetsAt: typeof q.resetsAt === "string" ? q.resetsAt : undefined,
    });
    if (typeof raw.planName === "string") {
      lines.push({ type: "text", label: "Plan", value: raw.planName });
    }
    if (typeof raw.region === "string") {
      lines.push({ type: "text", label: "Region", value: raw.region });
    }
    return lines;
  }
  return [];
}
