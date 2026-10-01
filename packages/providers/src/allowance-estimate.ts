const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const COARSE_DELTA = 5;
// Family's weekly reset clock drifted 17 hours inside one cycle. A later Codex
// cycle restarted 36 hours after the previous reset, so the same-cycle gap stops at 20 hours.
const RESET_JITTER_MS = 20 * 60 * 60 * 1000;
const RECENT_CYCLE_MS = 45 * DAY_MS;

export const ALLOWANCE_DAY_OPTIONS = [1, 3, 5, 7, 30] as const;
export type AllowanceDays = (typeof ALLOWANCE_DAY_OPTIONS)[number];
export type AllowanceSpan =
  | { kind: "days"; days: AllowanceDays }
  | { kind: "month" }
  | { kind: "period" }
  | { kind: "previous" };

export function isAllowanceDays(value: number): value is AllowanceDays {
  return (ALLOWANCE_DAY_OPTIONS as readonly number[]).includes(value);
}

export function normalizeAllowanceSpan(value: AllowanceDays | AllowanceSpan): AllowanceSpan {
  return typeof value === "number" ? { kind: "days", days: value } : value;
}

export function parseAllowanceSpan(params: { get(name: string): string | null }): AllowanceSpan | null {
  const requested = params.get("span");
  if (requested != null && requested !== "") {
    if (requested === "month" || requested === "period" || requested === "previous") return { kind: requested };
    return null;
  }
  const days = Number(params.get("days") ?? "7");
  return isAllowanceDays(days) ? { kind: "days", days } : null;
}

export function allowanceSpanId(span: AllowanceSpan): string {
  return span.kind === "days" ? `${span.days}d` : span.kind;
}

export interface AllowanceObservation {
  providerId: string;
  observedAt: string;
  windowKey: string;
  windowLabel: string;
  periodMs: number | null;
  resetsAt: string | null;
  present: boolean;
  usedPercent: number | null;
  limitValue: number | null;
  limitUnit: "usd" | "tokens" | "requests" | null;
}

export interface AllowanceTokenRow {
  providerId: string;
  model: string;
  startedAt: string;
  tokens: number;
  costUsd?: number | null;
  bucketEnd?: string;
}

export interface AllowanceEstimate {
  providerId: string;
  windowKey: string;
  windowLabel: string;
  from: string;
  to: string;
  resetsAt: string | null;
  percentStart: number | null;
  percentEnd: number | null;
  tokens: number;
  estimatedAllowance: number | null;
  apiCost: number | null;
  estimatedApiCost: number | null;
  coarse: boolean;
  statedLimit: number | null;
  statedLimitUnit: AllowanceObservation["limitUnit"];
  models: Array<{ model: string; tokens: number }>;
  reason: "ok" | "shared-log" | "no-movement" | "meter-fell" | "no-tokens" | "unaligned";
}

interface MeterPoint {
  at: number;
  observedAt: string;
  usedPercent: number;
  resetsAt: string;
  periodMs: number;
  limitValue: number | null;
  limitUnit: AllowanceObservation["limitUnit"];
}

interface ChosenWindow {
  providerId: string;
  windowKey: string;
  windowLabel: string;
  periodMs: number;
}

export function buildAllowanceEstimates(
  observations: AllowanceObservation[],
  tokenRows: AllowanceTokenRow[],
  sharedProviderIds: ReadonlySet<string>,
  spanInput: AllowanceDays | AllowanceSpan,
  now: Date,
): AllowanceEstimate[] {
  const span = normalizeAllowanceSpan(spanInput);
  const rangeEnd = now.getTime();
  const estimates: AllowanceEstimate[] = [];

  for (const window of chooseWindows(observations)) {
    const points = meterPoints(observations, window).filter((point) => point.at <= rangeEnd);
    const cycles = boundedCycles(points);
    const shared = sharedProviderIds.has(window.providerId);
    const selected = selectCycles(cycles, span, rangeEnd, now, shared);
    for (const cycle of selected) {
      const rangeStart = span.kind === "period" || span.kind === "previous"
        ? cycle.start
        : lookbackStart(span, now);
      estimates.push(estimateCycle(
        window,
        cycle.points,
        tokenRows,
        rangeStart,
        Math.min(rangeEnd, cycle.end),
        sharedProviderIds,
      ));
    }
  }

  return estimates
    .filter((estimate) => !(estimate.reason === "no-movement" && estimate.tokens === 0))
    .sort((left, right) =>
      left.providerId.localeCompare(right.providerId)
      || right.from.localeCompare(left.from),
    );
}

function lookbackStart(span: AllowanceSpan, now: Date): number {
  if (span.kind === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (span.kind === "days") return now.getTime() - span.days * DAY_MS;
  return now.getTime();
}

function chooseWindows(observations: AllowanceObservation[]): ChosenWindow[] {
  const groups = new Map<string, AllowanceObservation[]>();
  for (const observation of observations) {
    const key = `${observation.providerId}\u0000${observation.windowKey}`;
    const list = groups.get(key) ?? [];
    list.push(observation);
    groups.set(key, list);
  }

  const byProvider = new Map<string, ChosenWindow[]>();
  for (const group of groups.values()) {
    const latest = group.reduce((best, item) => (item.observedAt > best.observedAt ? item : best));
    if (!latest.present) continue;
    const periodMs = effectivePeriod(latest, group);
    if (periodMs == null || periodMs < DAY_MS) continue;
    const list = byProvider.get(latest.providerId) ?? [];
    list.push({
      providerId: latest.providerId,
      windowKey: latest.windowKey,
      windowLabel: latest.windowLabel,
      periodMs,
    });
    byProvider.set(latest.providerId, list);
  }

  const chosen: ChosenWindow[] = [];
  for (const candidates of byProvider.values()) {
    const window = candidates.find((item) => item.windowKey === "weekly")
      ?? candidates.find((item) => item.windowKey === "cursor:total-usage")
      ?? candidates.slice().sort((left, right) => right.periodMs - left.periodMs)[0];
    if (!window) continue;
    chosen.push(window);
  }
  return chosen;
}

function effectivePeriod(latest: AllowanceObservation, group: AllowanceObservation[]): number | null {
  const stamped = latest.periodMs;
  if (stamped != null && stamped >= DAY_MS) return stamped;
  if (latest.windowKey !== "session") return stamped;
  let maxHorizon = 0;
  for (const observation of group) {
    if (!observation.present || !observation.resetsAt) continue;
    if (observation.resetsAt !== latest.resetsAt) continue;
    const horizon = Date.parse(observation.resetsAt) - Date.parse(observation.observedAt);
    if (Number.isFinite(horizon) && horizon > maxHorizon) maxHorizon = horizon;
  }
  if (maxHorizon < DAY_MS) return stamped;
  if (maxHorizon <= WEEK_MS + 12 * 60 * 60 * 1000) return WEEK_MS;
  return maxHorizon;
}

function meterPoints(observations: AllowanceObservation[], window: ChosenWindow): MeterPoint[] {
  const points: MeterPoint[] = [];
  const group = observations.filter((item) => item.providerId === window.providerId && item.windowKey === window.windowKey);
  const periods = new Map<string, number | null>();
  for (const observation of group) {
    if (!observation.present || observation.usedPercent == null || !observation.resetsAt) continue;
    const periodKey = `${observation.periodMs}:${observation.resetsAt}`;
    if (!periods.has(periodKey)) periods.set(periodKey, effectivePeriod(observation, group));
    const periodMs = periods.get(periodKey);
    if (periodMs == null || periodMs < DAY_MS) continue;
    const at = Date.parse(observation.observedAt);
    if (!Number.isFinite(at)) continue;
    points.push({
      at,
      observedAt: observation.observedAt,
      usedPercent: observation.usedPercent,
      resetsAt: observation.resetsAt,
      periodMs,
      limitValue: observation.limitValue,
      limitUnit: observation.limitUnit,
    });
  }
  return points.sort((left, right) => left.at - right.at);
}

interface BoundedCycle {
  points: MeterPoint[];
  start: number;
  end: number;
}

function boundedCycles(points: MeterPoint[]): BoundedCycle[] {
  const drafted = clusterPoints(points).map((cycle) => {
    const resetsAt = cycleEndOf(cycle);
    return {
      points: cycle,
      start: resetsAt - cycle[0].periodMs,
      end: resetsAt,
    };
  }).sort((left, right) => left.start - right.start);
  for (let index = 0; index < drafted.length - 1; index += 1) {
    const nextStart = drafted[index + 1]!.start;
    if (nextStart < drafted[index]!.end) drafted[index]!.end = nextStart;
  }
  return drafted;
}

function selectCycles(
  cycles: BoundedCycle[],
  span: AllowanceSpan,
  rangeEnd: number,
  now: Date,
  shared: boolean,
): BoundedCycle[] {
  if (span.kind === "period" || span.kind === "previous") {
    const open = [...cycles].reverse().find((cycle) => cycle.start <= rangeEnd && rangeEnd < cycle.end);
    if (span.kind === "period") return open ? [open] : [];
    if (open) {
      const index = cycles.indexOf(open);
      const previous = index > 0 ? cycles[index - 1] : undefined;
      return previous && rangeEnd - previous.end < RECENT_CYCLE_MS ? [previous] : [];
    }
    const ended = [...cycles].reverse().find((cycle) => cycle.end <= rangeEnd && rangeEnd - cycle.end < RECENT_CYCLE_MS);
    return ended ? [ended] : [];
  }
  const rangeStart = lookbackStart(span, now);
  const overlapping = cycles.filter((cycle) => cycle.end > rangeStart && cycle.start < rangeEnd);
  if (!shared) return overlapping;
  return overlapping.sort((left, right) => right.start - left.start).slice(0, 1);
}

function clusterPoints(points: MeterPoint[]): MeterPoint[][] {
  const sorted = [...points].sort((left, right) => (
    Date.parse(left.resetsAt) - Date.parse(right.resetsAt) || left.at - right.at
  ));
  const clusters: MeterPoint[][] = [];
  for (const point of sorted) {
    const resetAt = Date.parse(point.resetsAt);
    const current = clusters.at(-1);
    const previousReset = current ? cycleEndOf(current) : Number.NaN;
    const gapLimit = Math.min(point.periodMs / 4, RESET_JITTER_MS);
    if (!current || !Number.isFinite(resetAt) || resetAt - previousReset > gapLimit) {
      clusters.push([point]);
    } else {
      current.push(point);
    }
  }
  return clusters.map((cycle) => cycle.sort((left, right) => left.at - right.at));
}

function cycleEndOf(points: MeterPoint[]): number {
  return Math.max(...points.map((point) => Date.parse(point.resetsAt)));
}

function estimateCycle(
  window: ChosenWindow,
  points: MeterPoint[],
  tokenRows: AllowanceTokenRow[],
  rangeStart: number,
  rangeEnd: number,
  sharedProviderIds: ReadonlySet<string>,
): AllowanceEstimate {
  const cycleEnd = cycleEndOf(points);
  const segmentFrom = Math.max(rangeStart, cycleEnd - points[0].periodMs);
  const segmentTo = Math.min(rangeEnd, cycleEnd);
  const inside = points.filter((point) => point.at >= segmentFrom && point.at <= segmentTo);
  const startPoint = inside[0] ?? null;
  const endPoint = inside.at(-1) ?? null;
  const measured = startPoint != null && endPoint != null && endPoint.at > startPoint.at;
  const percentStart = measured ? startPoint.usedPercent : endPoint?.usedPercent ?? startPoint?.usedPercent ?? null;
  const percentEnd = measured ? endPoint.usedPercent : percentStart;
  const tokenFrom = measured ? startPoint.at : segmentFrom;
  const tokenTo = measured ? endPoint.at : segmentFrom;
  const unaligned = measured && tokenRows.some((row) => {
    if (row.providerId !== window.providerId || row.tokens <= 0 || !row.bucketEnd) return false;
    const start = Date.parse(row.startedAt);
    const end = Date.parse(row.bucketEnd);
    return start < tokenTo && end > tokenFrom && (start < tokenFrom || end > tokenTo);
  });
  const meterFell = inside.some((point, index) => index > 0 && point.usedPercent < inside[index - 1]!.usedPercent);
  const models = measured
    ? tokensBetween(tokenRows, window.providerId, tokenFrom, tokenTo)
    : [];
  const tokens = models.reduce((sum, model) => sum + model.tokens, 0);
  const apiCost = measured && !sharedProviderIds.has(window.providerId)
    ? apiCostBetween(tokenRows, window.providerId, tokenFrom, tokenTo)
    : null;
  const delta = measured && percentStart != null && percentEnd != null ? percentEnd - percentStart : 0;
  const shared = sharedProviderIds.has(window.providerId);
  const reason = shared
    ? "shared-log"
    : meterFell
      ? "meter-fell"
      : !measured || delta === 0
      ? "no-movement"
      : delta < 0
        ? "meter-fell"
        : unaligned
          ? "unaligned"
        : tokens <= 0
          ? "no-tokens"
          : "ok";

  return {
    providerId: window.providerId,
    windowKey: window.windowKey,
    windowLabel: window.windowLabel,
    from: new Date(measured ? tokenFrom : segmentFrom).toISOString(),
    to: new Date(measured ? tokenTo : segmentTo).toISOString(),
    resetsAt: new Date(cycleEnd).toISOString(),
    percentStart,
    percentEnd,
    tokens: shared ? 0 : tokens,
    estimatedAllowance: reason === "ok" ? tokens / (delta / 100) : null,
    apiCost: shared ? null : apiCost,
    estimatedApiCost: reason === "ok" && apiCost != null ? apiCost / (delta / 100) : null,
    coarse: reason === "ok" && delta < COARSE_DELTA,
    statedLimit: shared ? null : endPoint?.limitValue ?? startPoint?.limitValue ?? null,
    statedLimitUnit: shared ? null : endPoint?.limitUnit ?? startPoint?.limitUnit ?? null,
    models: shared ? [] : models,
    reason,
  };
}

function apiCostBetween(
  tokenRows: AllowanceTokenRow[],
  providerId: string,
  from: number,
  to: number,
): number | null {
  let cost = 0;
  let seen = false;
  for (const row of tokenRows) {
    if (row.providerId !== providerId || row.tokens <= 0) continue;
    const started = Date.parse(row.startedAt);
    if (!Number.isFinite(started) || started < from || started >= to) continue;
    if (row.bucketEnd && Date.parse(row.bucketEnd) > to) continue;
    seen = true;
    if (row.costUsd == null || !Number.isFinite(row.costUsd) || row.costUsd < 0) return null;
    cost += row.costUsd;
  }
  return seen ? cost : null;
}

function tokensBetween(
  tokenRows: AllowanceTokenRow[],
  providerId: string,
  from: number,
  to: number,
): Array<{ model: string; tokens: number }> {
  const models = new Map<string, number>();
  for (const row of tokenRows) {
    if (row.providerId !== providerId || row.tokens <= 0) continue;
    const started = Date.parse(row.startedAt);
    if (!Number.isFinite(started) || started < from || started >= to) continue;
    if (row.bucketEnd && Date.parse(row.bucketEnd) > to) continue;
    models.set(row.model, (models.get(row.model) ?? 0) + row.tokens);
  }
  return [...models.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model));
}
