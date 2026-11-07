import { lstatSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { observationsFromLines } from "./quota-observations";
import { errorCode, listJsonl, logReadFailure, readNewText, sessionCreatorHash } from "./codex-session-files";

export type CodexMeterShape = "weekly-primary" | "five-hour-primary";

export interface CodexEventAccount {
  id: string;
  homePath: string;
  shape: CodexMeterShape | null;
  planType: string | null;
  /** SHA-256 of `tokens.account_id` from the home's auth.json; never the raw id. */
  accountIdHash?: string | null;
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
  /** Every listing and file read succeeded; `complete` also requires a rescan to find an event. */
  readComplete: boolean;
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

// A missing sessions path is incomplete when stored cursors show it held files before, so a rescan
// cannot treat files that are only temporarily missing as gone. A home that never had one is skipped.
function sessionScanRoots(
  accounts: Array<{ homePath: string }>,
  cursors: Array<{ path: string }> = [],
): { roots: string[]; complete: boolean } {
  const roots = new Set<string>();
  let complete = true;
  for (const account of accounts) {
    const sessions = join(account.homePath, "sessions");
    let stat;
    try {
      stat = lstatSync(sessions);
    } catch (error) {
      if (errorCode(error) !== "ENOENT" || hadSessions(account.homePath, cursors)) {
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

function hadSessions(homePath: string, cursors: Array<{ path: string }>): boolean {
  const prefixes = [join(homePath, "sessions") + sep];
  try {
    prefixes.push(join(realpathSync(homePath), "sessions") + sep);
  } catch {
    // The home itself is gone; the configured path is the only prefix to compare.
  }
  return cursors.some((cursor) => prefixes.some((prefix) => cursor.path.startsWith(prefix)));
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
  let found = 0;
  const discovered = sessionScanRoots(input.accounts, input.cursors);
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
      const parsed = parseTokenCounts(read.slice.text, read.slice.previousTotal);
      const creatorRead = parsed.events.length > 0 ? sessionCreatorHash(path) : null;
      if (creatorRead?.failed) {
        // Keep the cursor so the next refresh retries; never store these events under the fallback.
        complete = false;
        const existing = cursors.get(path);
        if (existing) nextCursors.push(existing);
        continue;
      }
      filesRead += 1;
      found += parsed.events.length;
      unmapped += parsed.unmapped;
      const creator = creatorAccount(creatorRead?.hash ?? null, input.accounts);
      for (const event of parsed.events) {
        if (creator) {
          events.push({ ...event.draft, providerId: creator });
          continue;
        }
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
    // Plans learned while some files could not be read may be wrong; on such a rescan these events
    // stay unmapped, so the replace leaves their stored rows on their previous account.
    if (rescan && !complete) {
      unmapped += 1;
      continue;
    }
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
    // A rescan that finds no event changes nothing; saving its key would use it up, and files that
    // return with their old size and modified time would then never be reread.
    complete: complete && (!rescan || found > 0),
    readComplete: complete,
  };
}

function codexEventMapKey(accounts: CodexEventAccount[]): string {
  return JSON.stringify(
    accounts
      .map((account) => [account.id, account.shape, account.planType, account.accountIdHash ?? null] as const)
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

function creatorAccount(creatorHash: string | null, accounts: CodexEventAccount[]): string | null {
  if (!creatorHash) return null;
  const matches = accounts.filter((account) => account.accountIdHash === creatorHash);
  return matches.length === 1 ? matches[0]!.id : null;
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
