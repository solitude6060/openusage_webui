import type { UsageRecord } from "../../../packages/core/src/types";
import {
  observationsFromLines,
  selectQuotaObservations,
} from "../../../packages/providers/src/quota-observations";
import {
  codexSessionTokenDuplicateIds,
  codexSharedSessionAccountIds,
} from "../../../packages/providers/src/codex-session-ownership";
import {
  allowanceSpanId,
  buildAllowanceEstimates,
  isAllowanceDays,
  normalizeAllowanceSpan,
  type AllowanceDays,
  type AllowanceEstimate,
  type AllowanceSpan,
} from "../../../packages/providers/src/allowance-estimate";
import {
  buildQuotaWindowViews,
  previousResetCutoff,
  type QuotaWindowView,
} from "../../../packages/providers/src/quota-view";
import type { SqliteStorage } from "../../../packages/storage/src/index";

const TOKEN_LOOKBACK_MS = 70 * 24 * 60 * 60 * 1000;
const FAILURE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const ALLOWANCE_BASELINE_MS = 40 * 24 * 60 * 60 * 1000;
const ALLOWANCE_PERIOD_HISTORY_MS = 100 * 24 * 60 * 60 * 1000;

export { isAllowanceDays };
export type { AllowanceDays };

export async function recordQuotaFromRefresh(
  storage: SqliteStorage,
  providerId: string,
  records: UsageRecord[],
): Promise<void> {
  const snapshot = records.find((record) =>
    record.tool === "OpenUsage Plugin Snapshot"
    && record.raw
    && typeof record.raw === "object"
    && Array.isArray((record.raw as { lines?: unknown }).lines),
  );
  if (!snapshot) return;
  const lines = (snapshot.raw as { lines: unknown[] }).lines;
  const observedAt = snapshot.startedAt;
  const present = observationsFromLines(providerId, lines, observedAt);
  const latest = await storage.listLatestQuotaObservations(providerId);
  await storage.insertQuotaObservations(selectQuotaObservations(present, latest, observedAt));
}

export async function backfillQuotaObservations(storage: SqliteStorage): Promise<number> {
  if (await storage.getAppMeta("quota_backfill_v2") === "done") return 0;
  const latest = new Map<string, Map<string, ReturnType<typeof observationsFromLines>[number]>>();
  const pending: ReturnType<typeof observationsFromLines> = [];
  storage.forEachApiSnapshot((row) => {
    let lines: unknown;
    try {
      lines = JSON.parse(row.rawJson)?.lines;
    } catch {
      return;
    }
    if (!Array.isArray(lines)) return;
    const providerLatest = [...(latest.get(row.providerId)?.values() ?? [])];
    const selected = selectQuotaObservations(
      observationsFromLines(row.providerId, lines, row.startedAt),
      providerLatest,
      row.startedAt,
    );
    if (selected.length === 0) return;
    pending.push(...selected);
    const map = latest.get(row.providerId) ?? new Map();
    for (const item of selected) map.set(item.windowKey, item);
    latest.set(row.providerId, map);
  });
  await storage.insertQuotaObservations(pending);
  await storage.setAppMeta("quota_backfill_v2", "done");
  return pending.length;
}

export async function loadQuotaDashboard(storage: SqliteStorage): Promise<{
  windows: QuotaWindowView[];
  failures: Array<{ providerId: string; failedAt: string; message: string }>;
}> {
  const accounts = await storage.listProviderAccounts();
  const sharedProviderIds = new Set(codexSharedSessionAccountIds(
    accounts
      .filter((account) => account.providerId === "codex")
      .map((account) => ({ id: account.id, homePath: account.homePath })),
  ));
  const latest = await storage.listLatestQuotaObservations();
  const pairs = [];
  for (const current of latest) {
    const cutoff = current.resetsAt ? previousResetCutoff(current.resetsAt, current.periodMs) : null;
    const previous = cutoff
      ? await storage.latestQuotaObservationBeforeReset(current.providerId, current.windowKey, cutoff)
      : null;
    pairs.push({ current, previous });
  }
  const tokenRows = await storage.listPositiveTokenRows(
    new Date(Date.now() - TOKEN_LOOKBACK_MS).toISOString(),
  );
  const failures = await storage.listLatestProbeFailures(
    new Date(Date.now() - FAILURE_LOOKBACK_MS).toISOString(),
  );
  return {
    windows: buildQuotaWindowViews(pairs, tokenRows, sharedProviderIds),
    failures,
  };
}

export async function loadAllowanceEstimates(
  storage: SqliteStorage,
  spanInput: AllowanceDays | AllowanceSpan,
  now = new Date(),
): Promise<{ span: string; days?: AllowanceDays; estimates: AllowanceEstimate[] }> {
  const span = normalizeAllowanceSpan(spanInput);
  const lookbackStart = span.kind === "days"
    ? now.getTime() - span.days * 24 * 60 * 60 * 1000
    : span.kind === "month"
      ? new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      : now.getTime() - ALLOWANCE_PERIOD_HISTORY_MS;
  const historyStart = span.kind === "period" || span.kind === "previous"
    ? lookbackStart
    : lookbackStart - ALLOWANCE_BASELINE_MS;
  const accounts = await storage.listProviderAccounts();
  const codexHomes = accounts
    .filter((account) => account.providerId === "codex")
    .map((account) => ({ id: account.id, homePath: account.homePath }));
  // The symlink account has no tokens of its own. The real directory can use its own meter.
  const sharedProviderIds = new Set(codexSessionTokenDuplicateIds(codexHomes));
  const observations = await storage.listQuotaObservationsSince(new Date(historyStart).toISOString());
  // A UTC-midnight daily bucket starts before a window that opens later that same day.
  const tokenRows = await storage.listPositiveTokenRows(
    new Date(historyStart - 24 * 60 * 60 * 1000).toISOString(),
  );
  return {
    span: allowanceSpanId(span),
    ...(span.kind === "days" ? { days: span.days } : {}),
    estimates: buildAllowanceEstimates(observations, tokenRows, sharedProviderIds, span, now),
  };
}
