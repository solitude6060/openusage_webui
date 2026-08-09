import { Fragment, useEffect, useMemo, useState } from "react";
import type {
  ProviderStatus,
  TokenUsageBreakdown,
} from "../../../../packages/core/src/types";
import { getTokenUsage } from "../lib/api";
import { formatNumber } from "../lib/format";
import { providerLabel } from "../provider-ui";

type RangePreset = "today" | "7d" | "30d" | "month" | "all" | "custom";
export type TokenGrouping = "provider" | "model";

export type TokenTableGroup = {
  key: string;
  kind: TokenGrouping;
  label: string;
  totalTokens: number;
  records: number;
  children: Array<{
    key: string;
    kind: TokenGrouping;
    label: string;
    totalTokens: number;
    records: number;
  }>;
};

export function formatCompactTokenCount(value: number): string {
  return formatNumber(value);
}

export function canonicalModelName(model: string): string {
  return model;
}

export function buildTokenGroups(
  data: TokenUsageBreakdown,
  _grouping: TokenGrouping,
): TokenTableGroup[] {
  return data.providers.map((provider) => ({
    key: `provider:${provider.providerId}`,
    kind: "provider",
    label: provider.providerId,
    totalTokens: provider.totalTokens,
    records: provider.records,
    children: provider.models.map((model) => ({
      key: `model:${provider.providerId}:${model.model}`,
      kind: "model",
      label: model.model,
      totalTokens: model.totalTokens,
      records: model.records,
    })),
  }));
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function safeToISO(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function rangeBounds(
  preset: RangePreset,
  customFrom: string,
  customTo: string,
  now = new Date(),
): { from?: string; to?: string } {
  if (preset === "all") return {};
  if (preset === "custom") {
    const to = safeToISO(customTo);
    const toEnd = to ? new Date(to) : undefined;
    // datetime-local only carries minute precision; extend the parsed instant to
    // the end of that minute so records inside it are not excluded by `<=`.
    if (toEnd) toEnd.setSeconds(59, 999);
    return {
      from: safeToISO(customFrom),
      to: toEnd?.toISOString(),
    };
  }
  if (preset === "today") {
    // ccusage daily records are anchored at UTC midnight, so preset bounds use
    // UTC day boundaries to keep day-granularity rows inside the window.
    return {
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString(),
      to: now.toISOString(),
    };
  }
  if (preset === "month") {
    return {
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      to: now.toISOString(),
    };
  }
  const days = preset === "7d" ? 7 : 30;
  return {
    from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };
}

export function customRangeError(customFrom: string, customTo: string): string | null {
  if (!customFrom || !customTo) return null;
  const from = new Date(customFrom);
  const to = new Date(customTo);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return null;
  return from > to ? "From Must Be Before To" : null;
}

export function TokensPage({
  providers,
  refreshToken,
}: {
  providers: ProviderStatus[];
  refreshToken: number;
}) {
  const [preset, setPreset] = useState<RangePreset>("7d");
  const [customFrom, setCustomFrom] = useState(() =>
    toLocalInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [customTo, setCustomTo] = useState(() => toLocalInputValue(new Date()));
  const [data, setData] = useState<TokenUsageBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const providerNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const status of providers) {
      map.set(status.providerId, status.name);
    }
    return map;
  }, [providers]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const customError = preset === "custom" ? customRangeError(customFrom, customTo) : null;
        if (customError) {
          setError(customError);
          setData(null);
          return;
        }
        const bounds = rangeBounds(preset, customFrom, customTo);
        const next = await getTokenUsage(bounds);
        if (!cancelled) setData(next);
      } catch (loadError) {
        if (!cancelled) {
          console.error("Token usage load failed:", loadError);
          setError(loadError instanceof Error ? loadError.message : "Failed to load token usage");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [preset, customFrom, customTo, refreshToken]);

  function toggle(providerId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  }

  const presets: Array<{ id: RangePreset; label: string }> = [
    { id: "today", label: "Today" },
    { id: "7d", label: "Last 7 Days" },
    { id: "30d", label: "Last 30 Days" },
    { id: "month", label: "This Month" },
    { id: "all", label: "All" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <section className="page-grid">
      <section className="panel">
        <div className="panel-header">
          <h3>Token Usage</h3>
          <span>{data ? `${formatNumber(data.totalTokens)} Tokens · ${data.records} Rows` : "—"}</span>
        </div>
        <div className="token-range-bar">
          <div className="chip-list" role="group" aria-label="Time Range">
            {presets.map((item) => (
              <button
                key={item.id}
                type="button"
                className={preset === item.id ? "value-chip token-range-active" : "value-chip"}
                onClick={() => setPreset(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {preset === "custom" ? (
            <div className="token-custom-range">
              <label>
                From
                <input
                  type="datetime-local"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="datetime-local"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </div>
        <div className="panel-body">
          <p className="settings-help muted">
            Totals come from local usage records that already store token counts. Provider cards that
            only show live quotas are not included unless refresh wrote records.
          </p>
          {error ? <div className="alert error">{error}</div> : null}
          {loading ? <div className="loading-indicator">Loading...</div> : null}
          {!loading && data && data.providers.length === 0 ? (
            <p className="settings-help muted">No Token Records In This Range</p>
          ) : null}
        </div>
        {!loading && data && data.providers.length > 0 ? (
          <div className="table-scroll">
            <table className="token-table">
              <thead>
                <tr>
                  <th>Provider / Model</th>
                  <th>Tokens</th>
                  <th>Rows</th>
                </tr>
              </thead>
              <tbody>
                {data.providers.map((provider) => {
                  const open = expanded.has(provider.providerId);
                  return (
                    <Fragment key={provider.providerId}>
                      <tr className="token-provider-row">
                        <td>
                          <button
                            type="button"
                            className="token-expand"
                            aria-expanded={open}
                            onClick={() => toggle(provider.providerId)}
                          >
                            <span aria-hidden>{open ? "▾" : "▸"}</span>
                            {providerLabel(provider.providerId, providerNames.get(provider.providerId))}
                          </button>
                        </td>
                        <td>{formatNumber(provider.totalTokens)}</td>
                        <td>{formatNumber(provider.records)}</td>
                      </tr>
                      {open
                        ? provider.models.map((model) => (
                            <tr key={`${provider.providerId}:${model.model}`} className="token-model-row">
                              <td>{model.model}</td>
                              <td>{formatNumber(model.totalTokens)}</td>
                              <td>{formatNumber(model.records)}</td>
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </section>
  );
}
