export const QUOTA_RECORD_GAP_MS = 6 * 60 * 60 * 1000;

export type QuotaLimitUnit = "usd" | "tokens" | "requests";

export interface QuotaObservation {
  providerId: string;
  observedAt: string;
  windowKey: string;
  windowLabel: string;
  periodMs: number | null;
  resetsAt: string | null;
  present: boolean;
  usedPercent: number | null;
  limitValue: number | null;
  limitUnit: QuotaLimitUnit | null;
  usedValue: number | null;
}

const ACCOUNT_LABELS = new Set([
  "session",
  "weekly",
  "reviews",
  "premium",
  "chat",
  "usage",
  "credits",
  "total-usage",
  "auto-usage",
  "api-usage",
  "on-demand",
  "requests",
]);

export function quotaWindowKey(providerId: string, label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug === "session" || slug === "weekly") return slug;
  const base = providerId.split(":")[0];
  if (base === "cursor" && ACCOUNT_LABELS.has(slug)) return `cursor:${slug}`;
  if (ACCOUNT_LABELS.has(slug)) return slug;
  return `model:${slug}`;
}

export function observationsFromLines(
  providerId: string,
  lines: unknown[],
  observedAt: string,
): QuotaObservation[] {
  const byKey = new Map<string, QuotaObservation>();
  for (const line of lines) {
    const observation = observationFromLine(providerId, line, observedAt);
    if (observation) byKey.set(observation.windowKey, observation);
  }
  return [...byKey.values()];
}

export function selectQuotaObservations(
  presentWindows: QuotaObservation[],
  latest: QuotaObservation[],
  observedAt: string,
): QuotaObservation[] {
  const latestByKey = new Map(latest.map((row) => [row.windowKey, row]));
  const selected: QuotaObservation[] = [];
  const seen = new Set<string>();

  for (const window of presentWindows) {
    seen.add(window.windowKey);
    const previous = latestByKey.get(window.windowKey);
    if (!previous || quotaObservationChanged(previous, window, observedAt)) {
      selected.push({ ...window, observedAt });
    }
  }

  for (const previous of latest) {
    if (seen.has(previous.windowKey) || !previous.present) continue;
    selected.push({
      ...previous,
      observedAt,
      present: false,
      usedPercent: null,
      usedValue: null,
    });
  }
  return selected;
}

function quotaObservationChanged(
  previous: QuotaObservation,
  next: QuotaObservation,
  observedAt: string,
): boolean {
  if (previous.present !== next.present) return true;
  if ((previous.resetsAt ?? null) !== (next.resetsAt ?? null)) return true;
  if ((previous.limitValue ?? null) !== (next.limitValue ?? null)) return true;
  if ((previous.limitUnit ?? null) !== (next.limitUnit ?? null)) return true;
  if (previous.usedPercent == null || next.usedPercent == null) {
    return previous.usedPercent !== next.usedPercent;
  }
  if (previous.usedPercent !== next.usedPercent) return true;
  const gap = Date.parse(observedAt) - Date.parse(previous.observedAt);
  return Number.isFinite(gap) && gap >= QUOTA_RECORD_GAP_MS;
}

function observationFromLine(
  providerId: string,
  line: unknown,
  observedAt: string,
): QuotaObservation | null {
  if (!isRecord(line) || line.type !== "progress" || typeof line.label !== "string" || !line.label.trim()) {
    return null;
  }
  const format = isRecord(line.format) && typeof line.format.kind === "string" ? line.format.kind : null;
  const used = finiteNumber(line.used);
  const limit = finiteNumber(line.limit);
  let usedPercent: number | null = null;
  let limitValue = finiteNumber(line.limitValue);
  let usedValue = finiteNumber(line.usedValue);
  let limitUnit = limitUnitFrom(line.limitUnit);

  if (format === "percent") {
    usedPercent = used;
  } else if (format === "dollars" && used != null && limit != null && limit > 0) {
    usedPercent = (used / limit) * 100;
    if (limitValue == null) limitValue = limit;
    if (usedValue == null) usedValue = used;
    if (!limitUnit) limitUnit = "usd";
  } else if (used != null && limit != null && limit > 0 && limit !== 100) {
    usedPercent = (used / limit) * 100;
    if (limitValue == null) limitValue = limit;
    if (usedValue == null) usedValue = used;
  }

  return {
    providerId,
    observedAt,
    windowKey: quotaWindowKey(providerId, line.label),
    windowLabel: line.label.trim(),
    periodMs: finiteNumber(line.periodDurationMs),
    resetsAt: typeof line.resetsAt === "string" && line.resetsAt.trim() ? line.resetsAt : null,
    present: true,
    usedPercent,
    limitValue,
    limitUnit,
    usedValue,
  };
}

function limitUnitFrom(value: unknown): QuotaLimitUnit | null {
  return value === "usd" || value === "tokens" || value === "requests" ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
