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

export function formatMoney(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatDate(value?: string): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

export function formatRelativeTime(isoString: string): string {
  const target = new Date(isoString).getTime();
  const now = Date.now();
  const diffMs = target - now;
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
