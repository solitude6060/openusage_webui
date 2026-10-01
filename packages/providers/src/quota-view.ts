import type { QuotaObservation } from "./quota-observations";

const DAY_MS = 24 * 60 * 60 * 1000;
const IMPLIED_MIN_PERCENT = 20;

export interface QuotaTokenRow {
  providerId: string;
  model: string;
  startedAt: string;
  tokens: number;
}

export interface QuotaWindowPair {
  current: QuotaObservation;
  previous: QuotaObservation | null;
}

export interface QuotaWindowView {
  providerId: string;
  windowKey: string;
  windowLabel: string;
  present: boolean;
  usedPercent: number | null;
  resetsAt: string | null;
  periodMs: number | null;
  tokensInWindow: number | null;
  limitValue: number | null;
  limitUnit: QuotaObservation["limitUnit"];
  usedValue: number | null;
  impliedAllowance: number | null;
  models: Array<{ model: string; tokens: number }>;
  previous: {
    usedPercent: number | null;
    impliedAllowance: number | null;
    resetsAt: string | null;
  } | null;
}

interface DraftWindow extends QuotaWindowView {
  modelTotals: Array<{ model: string; tokens: number }>;
}

export function previousResetCutoff(resetsAt: string, periodMs: number | null): string | null {
  const end = Date.parse(resetsAt);
  if (!Number.isFinite(end)) return null;
  const separation = periodMs != null && periodMs > 0 ? periodMs / 2 : 60 * 60 * 1000;
  return new Date(end - separation).toISOString();
}

export function buildQuotaWindowViews(
  pairs: QuotaWindowPair[],
  tokenRows: QuotaTokenRow[],
  sharedProviderIds: ReadonlySet<string>,
): QuotaWindowView[] {
  const drafted: DraftWindow[] = pairs.map((pair) => {
    const tokens = tokensInWindow(pair.current, tokenRows, sharedProviderIds);
    const previousTokens = pair.previous
      ? tokensInWindow(pair.previous, tokenRows, sharedProviderIds)
      : null;
    return {
      providerId: pair.current.providerId,
      windowKey: pair.current.windowKey,
      windowLabel: pair.current.windowLabel,
      present: pair.current.present,
      usedPercent: pair.current.usedPercent,
      resetsAt: pair.current.resetsAt,
      periodMs: pair.current.periodMs,
      tokensInWindow: tokens?.total ?? null,
      limitValue: pair.current.limitValue,
      limitUnit: pair.current.limitUnit,
      usedValue: pair.current.usedValue,
      impliedAllowance: impliedAllowance(tokens?.total ?? null, pair.current.usedPercent),
      models: [],
      modelTotals: tokens?.models ?? [],
      previous: pair.previous
        ? {
            usedPercent: pair.previous.usedPercent,
            impliedAllowance: impliedAllowance(previousTokens?.total ?? null, pair.previous.usedPercent),
            resetsAt: pair.previous.resetsAt,
          }
        : null,
    };
  });

  const breakdownKey = new Map<string, string>();
  for (const providerId of new Set(drafted.map((view) => view.providerId))) {
    const candidates = drafted.filter((view) =>
      view.providerId === providerId && view.modelTotals.length > 0,
    );
    const chosen = candidates.find((view) => view.windowKey === "weekly")
      ?? candidates.find((view) => view.windowKey === "cursor:total-usage")
      ?? candidates.slice().sort((left, right) => (right.periodMs ?? 0) - (left.periodMs ?? 0))[0];
    if (chosen) breakdownKey.set(providerId, chosen.windowKey);
  }

  return drafted
    .map(({ modelTotals, ...view }) => {
      const showTokens = breakdownKey.get(view.providerId) === view.windowKey;
      return {
        ...view,
        tokensInWindow: showTokens ? view.tokensInWindow : null,
        impliedAllowance: showTokens ? view.impliedAllowance : null,
        models: showTokens ? modelTotals : [],
        previous: view.previous
          ? {
              ...view.previous,
              impliedAllowance: showTokens ? view.previous.impliedAllowance : null,
            }
          : null,
      };
    })
    .sort((left, right) =>
      left.providerId.localeCompare(right.providerId)
      || left.windowLabel.localeCompare(right.windowLabel),
    );
}

function tokensInWindow(
  window: QuotaObservation,
  tokenRows: QuotaTokenRow[],
  sharedProviderIds: ReadonlySet<string>,
): { total: number; models: Array<{ model: string; tokens: number }> } | null {
  if (!window.present || sharedProviderIds.has(window.providerId)) return null;
  if (window.periodMs == null || window.periodMs < DAY_MS || !window.resetsAt) return null;
  const end = Date.parse(window.resetsAt);
  if (!Number.isFinite(end)) return null;
  const start = end - window.periodMs;
  const models = new Map<string, number>();
  for (const row of tokenRows) {
    if (row.providerId !== window.providerId || row.tokens <= 0) continue;
    const started = Date.parse(row.startedAt);
    if (!Number.isFinite(started) || started < start || started >= end) continue;
    models.set(row.model, (models.get(row.model) ?? 0) + row.tokens);
  }
  const list = [...models.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model));
  return {
    total: list.reduce((sum, row) => sum + row.tokens, 0),
    models: list,
  };
}

function impliedAllowance(tokens: number | null, usedPercent: number | null): number | null {
  if (tokens == null || tokens <= 0 || usedPercent == null || usedPercent < IMPLIED_MIN_PERCENT) return null;
  return tokens / (usedPercent / 100);
}
