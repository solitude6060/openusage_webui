import type { AllowanceTokenRow } from "./allowance-estimate";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
// Any UTC month start works as the anchor of calendar months.
const CALENDAR_ANCHOR_MS = Date.UTC(2000, 0, 1);

export interface AllowanceBillingPart {
  from: string;
  to: string;
  consumedPercent: number;
  availablePercent: number;
}

export interface AllowanceBillingMonth {
  start: string;
  end: string;
  current: boolean;
  apiDollars: number | null;
  tokens: number;
  tokensFrom: string | null;
  weeklyParts: AllowanceBillingPart[];
  projectedApiDollars: number | null;
  projectionReliable: boolean | null;
}

export interface AllowanceBilling {
  anchor: string | null;
  anchorSource: "setting" | "calendar";
  months: AllowanceBillingMonth[];
}

export interface BillingCycle {
  start: number;
  end: number;
  readings: Array<{ at: number; usedPercent: number }>;
  spans: Array<{ from: number; to: number; startPercent: number; endPercent: number }>;
}

export interface BillingInput {
  anchor: string | undefined;
  nowMs: number;
  historyStartMs: number | undefined;
  rows: AllowanceTokenRow[];
  cycles: BillingCycle[];
  // First instant of the newer side of the latest regime change, when the baseline found one.
  regimeAt: number | null;
  // False when the weekly projection is unreliable for a meter reason: an early restart or a fall in the open cycle.
  meterStable: boolean;
}

export function buildBilling(input: BillingInput): AllowanceBilling {
  const parsed = input.anchor ? Date.parse(input.anchor) : Number.NaN;
  const fromSetting = Number.isFinite(parsed);
  const anchorMs = fromSetting ? parsed : CALENDAR_ANCHOR_MS;
  const firstRowMs = input.rows.reduce((first, row) => Math.min(first, Date.parse(row.startedAt) || Infinity), Infinity);
  // Months before the provider's first token row or meter reading hold no data.
  const firstDataMs = input.cycles.reduce(
    (first, cycle) => cycle.readings.reduce((inner, reading) => Math.min(inner, reading.at), first),
    firstRowMs,
  );
  const months: AllowanceBillingMonth[] = [];
  if (Number.isFinite(firstDataMs)) {
    const lowest = monthIndexAt(anchorMs, Math.max(firstDataMs, input.historyStartMs ?? firstDataMs));
    for (let k = monthIndexAt(anchorMs, input.nowMs); k >= lowest; k -= 1) {
      months.push(measureMonth(monthStart(anchorMs, k), monthStart(anchorMs, k + 1), firstRowMs, input));
    }
  }
  return { anchor: fromSetting ? new Date(parsed).toISOString() : null, anchorSource: fromSetting ? "setting" : "calendar", months };
}

// Every boundary is the anchor plus k months, so a clamped short month does not shift the later ones.
function monthStart(anchorMs: number, k: number): number {
  const anchor = new Date(anchorMs);
  const month = anchor.getUTCMonth() + k;
  const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return Date.UTC(
    anchor.getUTCFullYear(),
    month,
    Math.min(anchor.getUTCDate(), lastDay),
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
    anchor.getUTCMilliseconds(),
  );
}

function monthIndexAt(anchorMs: number, ms: number): number {
  const anchor = new Date(anchorMs);
  const at = new Date(ms);
  let k = (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + at.getUTCMonth() - anchor.getUTCMonth();
  while (monthStart(anchorMs, k) > ms) k -= 1;
  while (monthStart(anchorMs, k + 1) <= ms) k += 1;
  return k;
}

function measureMonth(
  start: number,
  end: number,
  firstRowMs: number,
  input: BillingInput,
): AllowanceBillingMonth {
  let tokens = 0;
  let dollars: number | null = 0;
  let count = 0;
  for (const row of input.rows) {
    const at = Date.parse(row.startedAt);
    if (!(at >= start && at < end)) continue;
    tokens += row.tokens;
    count += 1;
    const cost = row.costUsd;
    dollars = dollars != null && cost != null && Number.isFinite(cost) && cost >= 0 ? dollars + cost : null;
  }
  const apiDollars = count === 0 ? null : dollars;
  const tokensFrom = firstRowMs > start && firstRowMs < Infinity ? new Date(firstRowMs).toISOString() : null;
  const current = start <= input.nowMs && input.nowMs < end;
  const elapsed = input.nowMs - start;
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    current,
    apiDollars,
    tokens,
    tokensFrom,
    weeklyParts: weeklyParts(start, end, input),
    projectedApiDollars: current && apiDollars != null && elapsed > 0 ? apiDollars / elapsed * (end - start) : null,
    projectionReliable: current ? elapsed >= DAY_MS && input.meterStable && tokensFrom == null : null,
  };
}

interface PartTotals {
  from: number;
  to: number;
  consumed: number;
  available: number;
}

// One part per regime. Percent before and after a regime change measure different amounts, so they are never added.
// ponytail: only the latest regime change is known; an older one inside a listed month is not split.
function weeklyParts(start: number, end: number, input: BillingInput): AllowanceBillingPart[] {
  const until = Math.min(end, input.nowMs);
  const sides: Array<PartTotals | null> = [null, null];
  for (const cycle of input.cycles) {
    const from = Math.max(cycle.start, start);
    const to = Math.min(cycle.end, until);
    if (!(from < to)) continue;
    const at = input.regimeAt;
    const cuts = at != null && from < at && at < to ? [from, at, to] : [from, to];
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const side = at != null && cuts[index]! >= at ? 1 : 0;
      const part = sides[side] ?? { from: cuts[index]!, to: cuts[index + 1]!, consumed: 0, available: 0 };
      part.from = Math.min(part.from, cuts[index]!);
      part.to = Math.max(part.to, cuts[index + 1]!);
      part.consumed += climbWithin(cycle, cuts[index]!, cuts[index + 1]!);
      part.available += (cuts[index + 1]! - cuts[index]!) / WEEK_MS * 100;
      sides[side] = part;
    }
  }
  return sides.filter((part): part is PartTotals => part != null).map((part) => ({
    from: new Date(part.from).toISOString(),
    to: new Date(part.to).toISOString(),
    consumedPercent: part.consumed,
    availablePercent: part.available,
  }));
}

// A segment's own start or end percent counts only when that edge lies inside [from, to);
// a clipped edge uses the readings inside, with no interpolation.
function climbWithin(cycle: BillingCycle, from: number, to: number): number {
  let climb = 0;
  for (const span of cycle.spans) {
    if (span.to < from || span.from >= to) continue;
    const inside = cycle.readings.filter((reading) =>
      reading.at >= Math.max(from, span.from) && reading.at < to && reading.at <= span.to);
    const startPercent = span.from >= from ? span.startPercent : inside[0]?.usedPercent;
    const endPercent = span.to <= to
      ? span.endPercent
      : inside.length > 0 ? Math.max(...inside.map((reading) => reading.usedPercent)) : undefined;
    if (startPercent != null && endPercent != null) climb += Math.max(0, endPercent - startPercent);
  }
  return climb;
}
