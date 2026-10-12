import { closeSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { observationsFromLines } from "./quota-observations";

export type CodexMeterShape = "weekly-primary" | "five-hour-primary";

export interface CodexEventAccount {
  id: string;
  homePath: string;
  shape: CodexMeterShape | null;
  planType: string | null;
}

export interface CodexEventCursor {
  path: string;
  mtimeMs: number;
  offset: number;
  lastTotalTokens: number | null;
}

export interface CodexTokenEventDraft {
  providerId: string;
  observedAt: string;
  tokens: number;
  input: number;
  cachedInput: number;
  output: number;
  planType: string | null;
  weeklyUsedPercent: number | null;
  weeklyResetsAt: string | null;
  totalTokens: number;
}

export interface CodexEventScanInput {
  accounts: CodexEventAccount[];
  cursors: CodexEventCursor[];
  storedMapKey: string | null;
}

export interface CodexEventScanResult {
  events: CodexTokenEventDraft[];
  cursors: CodexEventCursor[];
  filesRead: number;
  mapKey: string;
  learnedPlans: Array<{ providerId: string; planType: string }>;
  unmapped: number;
  replaceProviderIds: string[];
  complete: boolean;
}

export interface CodexShapeObservation {
  windowKey: string;
  periodMs: number | null;
  present: boolean;
  observedAt: string;
  resetsAt: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_MINUTES = 10080;
const FIVE_HOUR_MINUTES = 300;

export function codexSessionScanRoots(accounts: Array<{ homePath: string }>): string[] {
  return sessionScanRoots(accounts).roots;
}

function sessionScanRoots(accounts: Array<{ homePath: string }>): { roots: string[]; complete: boolean } {
  const roots = new Set<string>();
  let complete = true;
  for (const account of accounts) {
    const sessions = join(account.homePath, "sessions");
    let stat;
    try {
      stat = lstatSync(sessions);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        complete = false;
        logReadFailure(error);
      }
      continue;
    }
    if (!stat.isDirectory() && !stat.isSymbolicLink()) continue;
    try {
      roots.add(realpathSync(sessions));
    } catch (error) {
      complete = false;
      logReadFailure(error);
    }
  }
  return { roots: [...roots].sort(), complete };
}

export function meterShapeFromObservations(rows: CodexShapeObservation[]): CodexMeterShape | null {
  const present = rows.filter((row) => row.present);
  const latest = (windowKey: string) => present
    .filter((row) => row.windowKey === windowKey)
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
    .at(-1) ?? null;
  const sessionMs = effectivePeriod(latest("session"));
  const weekly = latest("weekly");
  const weeklyMs = weekly ? (weekly.periodMs != null && weekly.periodMs > 0 ? weekly.periodMs : 7 * DAY_MS) : null;
  const sessionIsSubDay = sessionMs != null && sessionMs < DAY_MS;
  const longWindow = (sessionMs != null && sessionMs >= DAY_MS) || (weeklyMs != null && weeklyMs >= DAY_MS);
  if (sessionIsSubDay && weeklyMs != null && weeklyMs >= DAY_MS) return "five-hour-primary";
  if (!sessionIsSubDay && longWindow) return "weekly-primary";
  return null;
}

export function scanCodexEventsForRefresh(
  providerId: string,
  lines: unknown[],
  startedAt: string,
  input: CodexEventScanInput,
): CodexEventScanResult {
  const shape = meterShapeFromObservations(observationsFromLines(providerId, lines, startedAt).map((row) => ({
    windowKey: row.windowKey,
    periodMs: row.periodMs,
    present: row.present,
    observedAt: row.observedAt,
    resetsAt: row.resetsAt,
  })));
  const accounts = input.accounts.map((account) => (
    account.id === providerId && shape ? { ...account, shape } : account
  ));
  return scanCodexSessionEvents({ ...input, accounts });
}

export function scanCodexSessionEvents(input: CodexEventScanInput): CodexEventScanResult {
  const inputKey = codexEventMapKey(input.accounts);
  const rescan = inputKey !== input.storedMapKey;
  const cursors = new Map((rescan ? [] : input.cursors).map((cursor) => [cursor.path, cursor]));
  const events: CodexTokenEventDraft[] = [];
  const pending: ParsedEvent[] = [];
  const nextCursors: CodexEventCursor[] = [];
  const learned = new Map<string, Set<string>>();
  let filesRead = 0;
  let unmapped = 0;
  const discovered = sessionScanRoots(input.accounts);
  let complete = discovered.complete;

  for (const root of discovered.roots) {
    const listed = listJsonl(root);
    if (!listed.complete) complete = false;
    for (const path of listed.files) {
      const read = readNewText(path, cursors.get(path) ?? null, rescan);
      if (read.failed) {
        complete = false;
        continue;
      }
      if (!read.slice) {
        const existing = cursors.get(path);
        if (existing) nextCursors.push(existing);
        continue;
      }
      filesRead += 1;
      const parsed = parseTokenCounts(read.slice.text, read.slice.previousTotal);
      unmapped += parsed.unmapped;
      for (const event of parsed.events) {
        const providerId = assignAccount(event.shape, event.planType, input.accounts);
        if (!providerId) {
          pending.push(event);
          continue;
        }
        if (event.shape && event.planType) {
          const plans = learned.get(providerId) ?? new Set<string>();
          plans.add(event.planType);
          learned.set(providerId, plans);
        }
        events.push({ ...event.draft, providerId });
      }
      nextCursors.push({
        path,
        mtimeMs: read.slice.mtimeMs,
        offset: read.slice.nextOffset,
        lastTotalTokens: parsed.lastTotal,
      });
    }
  }

  const learnedPlans = [...learned.entries()]
    .filter(([, plans]) => plans.size === 1)
    .map(([providerId, plans]) => ({ providerId, planType: [...plans][0]! }));
  const planById = new Map(learnedPlans.map((item) => [item.providerId, item.planType]));
  const recorded = input.accounts.map((account) => ({
    ...account,
    planType: planById.get(account.id) ?? account.planType,
  }));
  for (const event of pending) {
    const providerId = assignAccount(event.shape, event.planType, recorded);
    if (!providerId) {
      unmapped += 1;
      continue;
    }
    events.push({ ...event.draft, providerId });
  }
  return {
    events,
    cursors: nextCursors,
    filesRead,
    mapKey: codexEventMapKey(recorded),
    learnedPlans,
    unmapped,
    replaceProviderIds: rescan ? input.accounts.map((account) => account.id) : [],
    complete,
  };
}

function codexEventMapKey(accounts: CodexEventAccount[]): string {
  return JSON.stringify(
    accounts
      .map((account) => [account.id, account.shape, account.planType] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
  );
}

function effectivePeriod(row: CodexShapeObservation | null): number | null {
  if (!row) return null;
  if (row.periodMs != null && row.periodMs >= DAY_MS) return row.periodMs;
  if (row.resetsAt && row.observedAt) {
    const horizon = Date.parse(row.resetsAt) - Date.parse(row.observedAt);
    if (Number.isFinite(horizon) && horizon >= DAY_MS) return horizon;
  }
  return row.periodMs;
}

function assignAccount(
  shape: CodexMeterShape | null,
  planType: string | null,
  accounts: CodexEventAccount[],
): string | null {
  if (shape) {
    const matches = accounts.filter((account) => account.shape === shape);
    if (matches.length === 1) return matches[0]!.id;
  }
  if (planType) {
    const matches = accounts.filter((account) => account.planType === planType);
    if (matches.length === 1) return matches[0]!.id;
  }
  return null;
}

interface ReadSlice {
  text: string;
  nextOffset: number;
  mtimeMs: number;
  previousTotal: number | null;
}

function readNewText(
  path: string,
  cursor: CodexEventCursor | null,
  rescan: boolean,
): { failed: true } | { failed: false; slice: ReadSlice | null } {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    logReadFailure(error);
    return { failed: true };
  }
  const mtimeMs = Math.trunc(stat.mtimeMs);
  const size = stat.size;
  if (!rescan && cursor && cursor.offset === size && cursor.mtimeMs === mtimeMs) return { failed: false, slice: null };
  const start = !rescan && cursor && size >= cursor.offset ? cursor.offset : 0;
  const previousTotal = start === 0 ? null : cursor?.lastTotalTokens ?? null;
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const length = size - start;
    if (length <= 0) return { failed: false, slice: { text: "", nextOffset: start, mtimeMs, previousTotal } };
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, start);
    const slice = buffer.subarray(0, read);
    let end = slice.length;
    if (end === 0 || slice[end - 1] !== 0x0a) {
      const newline = slice.lastIndexOf(0x0a);
      if (newline < 0) return { failed: false, slice: { text: "", nextOffset: start, mtimeMs, previousTotal } };
      end = newline + 1;
    }
    return {
      failed: false,
      slice: { text: slice.subarray(0, end).toString("utf8"), nextOffset: start + end, mtimeMs, previousTotal },
    };
  } catch (error) {
    logReadFailure(error);
    return { failed: true };
  } finally {
    if (fd != null) closeSync(fd);
  }
}

function listJsonl(root: string): { files: string[]; complete: boolean } {
  const files: string[] = [];
  const stack = [root];
  let complete = true;
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      complete = false;
      logReadFailure(error);
      continue;
    }
    for (const name of names) {
      const path = join(dir, name);
      let stat;
      try {
        stat = lstatSync(path);
      } catch (error) {
        complete = false;
        logReadFailure(error);
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) stack.push(path);
      else if (stat.isFile() && name.endsWith(".jsonl")) files.push(path);
    }
  }
  files.sort();
  return { files, complete };
}

function logReadFailure(error: unknown): void {
  console.error(JSON.stringify({ event: "codex_session_read_failed", code: errorCode(error) }));
}

interface ParsedEvent {
  shape: CodexMeterShape | null;
  planType: string | null;
  draft: Omit<CodexTokenEventDraft, "providerId">;
}

function parseTokenCounts(text: string, previousTotal: number | null): {
  events: ParsedEvent[];
  lastTotal: number | null;
  unmapped: number;
} {
  const events: ParsedEvent[] = [];
  let lastTotal = previousTotal;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = tokenCountEvent(record, lastTotal);
    if (!parsed) continue;
    if (parsed.totalTokens != null) lastTotal = parsed.totalTokens;
    if (parsed.unchanged || !parsed.event) continue;
    events.push(parsed.event);
  }
  return { events, lastTotal, unmapped: 0 };
}

function tokenCountEvent(record: unknown, previousTotal: number | null): {
  event: ParsedEvent | null;
  totalTokens: number | null;
  unchanged: boolean;
} | null {
  if (!isRecord(record) || record.type !== "event_msg" || !isRecord(record.payload)) return null;
  if (record.payload.type !== "token_count") return null;
  const info = isRecord(record.payload.info) ? record.payload.info : null;
  const totals = info ? readUsage(info.total_token_usage) : null;
  const totalTokens = totals?.total ?? null;
  if (totalTokens != null && previousTotal != null && totalTokens === previousTotal) {
    return { event: null, totalTokens, unchanged: true };
  }
  const last = info ? readUsage(info.last_token_usage) : null;
  const usage = last ?? (totals ? subtractUsage(totals, previousTotal) : null);
  if (!usage || usage.total <= 0) return { event: null, totalTokens, unchanged: false };
  const observedAt = timestampIso(record.timestamp);
  if (!observedAt) return { event: null, totalTokens, unchanged: false };
  const limits = isRecord(record.payload.rate_limits) ? record.payload.rate_limits : null;
  const shape = limits ? eventShape(limits) : null;
  const weekly = limits ? weeklyReading(limits) : { percent: null, resetsAt: null };
  const planType = limits && typeof limits.plan_type === "string" && limits.plan_type.trim()
    ? limits.plan_type.trim()
    : null;
  return {
    unchanged: false,
    totalTokens: totalTokens ?? usage.total,
    event: {
      shape,
      planType,
      draft: {
        observedAt,
        tokens: usage.total,
        input: usage.input,
        cachedInput: usage.cached,
        output: usage.output,
        planType,
        weeklyUsedPercent: weekly.percent,
        weeklyResetsAt: weekly.resetsAt,
        totalTokens: totalTokens ?? usage.total,
      },
    },
  };
}

interface UsageCounts {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  total: number;
}

function readUsage(value: unknown): UsageCounts | null {
  if (!isRecord(value)) return null;
  const input = intField(value, "input_tokens", "prompt_tokens", "input");
  const cached = intField(value, "cached_input_tokens", "cache_read_input_tokens", "cached_tokens");
  const output = intField(value, "output_tokens", "completion_tokens", "output");
  const reasoning = intField(value, "reasoning_output_tokens", "reasoning_tokens");
  const reported = intField(value, "total_tokens");
  const recomputed = input + output + reasoning;
  return {
    input,
    cached,
    output,
    reasoning,
    total: reported > 0 || recomputed === 0 ? reported : recomputed,
  };
}

function subtractUsage(totals: UsageCounts, previousTotal: number | null): UsageCounts {
  const total = Math.max(0, totals.total - (previousTotal ?? 0));
  return { ...totals, total: total > 0 ? total : totals.total };
}

function eventShape(limits: Record<string, unknown>): CodexMeterShape | null {
  const primary = isRecord(limits.primary) ? intField(limits.primary, "window_minutes") : 0;
  const secondary = isRecord(limits.secondary) ? intField(limits.secondary, "window_minutes") : 0;
  if (primary === WEEKLY_MINUTES) return "weekly-primary";
  if (primary === FIVE_HOUR_MINUTES && secondary === WEEKLY_MINUTES) return "five-hour-primary";
  return null;
}

function weeklyReading(limits: Record<string, unknown>): { percent: number | null; resetsAt: string | null } {
  const primary = isRecord(limits.primary) ? limits.primary : null;
  const secondary = isRecord(limits.secondary) ? limits.secondary : null;
  const window = primary && intField(primary, "window_minutes") === WEEKLY_MINUTES
    ? primary
    : secondary && intField(secondary, "window_minutes") === WEEKLY_MINUTES
      ? secondary
      : null;
  if (!window) return { percent: null, resetsAt: null };
  const percent = typeof window.used_percent === "number" && Number.isFinite(window.used_percent)
    ? window.used_percent
    : null;
  return { percent, resetsAt: resetsAtIso(window.resets_at) };
}

function resetsAtIso(value: unknown): string | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || number <= 0) return null;
  const milliseconds = number > 10_000_000_000 ? number : number * 1000;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function timestampIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function intField(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}
