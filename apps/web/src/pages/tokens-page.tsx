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
  if (value >= 1_000_000_000) {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value / 1_000_000_000)}B`;
  }
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value / 1_000_000)}M`;
  }
  return formatNumber(value);
}

export function canonicalModelName(model: string): string {
  let value = model
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!value || value === "unknown") return "Unknown";

  value = value.replace(/^cursor-/, "");
  const claudeOrder = value.match(/^claude-(\d+(?:[.-]\d+)?)-(opus|sonnet|haiku|fable)(.*)$/);
  if (claudeOrder) {
    value = `claude-${claudeOrder[2]}-${claudeOrder[1]}${claudeOrder[3]}`;
  }
  value = value
    .replace(/-20\d{6}$/, "")
    .replace(/(?:-(?:thinking|low|medium|high|xhigh|max|fast))+$/, "")
    .replace(
      /^(gpt|grok|composer|claude-(?:opus|sonnet|haiku|fable))-(\d+)-(\d+)(?=-|$)/,
      "$1-$2.$3",
    );
  return value || "Unknown";
}

export function buildTokenGroups(
  data: TokenUsageBreakdown,
  grouping: TokenGrouping,
): TokenTableGroup[] {
  const byTotal = <T extends { label: string; totalTokens: number }>(left: T, right: T) =>
    right.totalTokens - left.totalTokens || left.label.localeCompare(right.label);
  const providerGroups = data.providers.map((provider) => {
    const models = new Map<string, TokenTableGroup["children"][number]>();
    for (const model of provider.models) {
      const label = canonicalModelName(model.model);
      const current = models.get(label);
      if (current) {
        current.totalTokens += model.totalTokens;
        current.records += model.records;
      } else {
        models.set(label, {
          key: `model:${provider.providerId}:${label}`,
          kind: "model",
          label,
          totalTokens: model.totalTokens,
          records: model.records,
        });
      }
    }
    return {
      key: `provider:${provider.providerId}`,
      kind: "provider" as const,
      label: provider.providerId,
      totalTokens: provider.totalTokens,
      records: provider.records,
      children: [...models.values()].sort(byTotal),
    };
  }).sort(byTotal);

  if (grouping === "provider") return providerGroups;

  const modelGroups = new Map<string, TokenTableGroup>();
  for (const provider of providerGroups) {
    for (const model of provider.children) {
      const current = modelGroups.get(model.label);
      const providerRow = {
        key: `provider:${model.label}:${provider.label}`,
        kind: "provider" as const,
        label: provider.label,
        totalTokens: model.totalTokens,
        records: model.records,
      };
      if (current) {
        current.totalTokens += model.totalTokens;
        current.records += model.records;
        current.children.push(providerRow);
      } else {
        modelGroups.set(model.label, {
          key: `model:${model.label}`,
          kind: "model",
          label: model.label,
          totalTokens: model.totalTokens,
          records: model.records,
          children: [providerRow],
        });
      }
    }
  }
  return [...modelGroups.values()]
    .map((group) => ({ ...group, children: group.children.sort(byTotal) }))
    .sort(byTotal);
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
  const [grouping, setGrouping] = useState<TokenGrouping>("provider");
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
  const groups = useMemo(() => data ? buildTokenGroups(data, grouping) : [], [data, grouping]);

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

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function rowLabel(kind: TokenGrouping, label: string): string {
    return kind === "provider" ? providerLabel(label, providerNames.get(label)) : label;
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
          <span title={data ? `${formatNumber(data.totalTokens)} Tokens` : undefined}>
            {data ? `${formatCompactTokenCount(data.totalTokens)} Tokens · ${data.records} Rows` : "—"}
          </span>
        </div>
        <div className="token-range-bar">
          <div className="token-control-row">
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
            <div className="chip-list" role="group" aria-label="Token Grouping">
              <button
                type="button"
                className={grouping === "provider" ? "value-chip token-range-active" : "value-chip"}
                onClick={() => setGrouping("provider")}
              >
                By Provider
              </button>
              <button
                type="button"
                className={grouping === "model" ? "value-chip token-range-active" : "value-chip"}
                onClick={() => setGrouping("model")}
              >
                By Model
              </button>
            </div>
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
            Parent totals use compact units. Expand a row for exact provider and model values.
            Provider cards that only show live quotas are not included unless refresh wrote records.
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
                  <th>{grouping === "provider" ? "Provider / Model" : "Model / Provider"}</th>
                  <th>Tokens</th>
                  <th>Rows</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const open = expanded.has(group.key);
                  const compactTotal = formatCompactTokenCount(group.totalTokens);
                  const exactTotal = formatNumber(group.totalTokens);
                  return (
                    <Fragment key={group.key}>
                      <tr className="token-provider-row">
                        <td>
                          <button
                            type="button"
                            className="token-expand"
                            aria-expanded={open}
                            onClick={() => toggle(group.key)}
                          >
                            <span aria-hidden>{open ? "▾" : "▸"}</span>
                            {rowLabel(group.kind, group.label)}
                          </button>
                        </td>
                        <td>
                          <span title={`${exactTotal} Tokens`}>{compactTotal}</span>
                          {open && compactTotal !== exactTotal ? (
                            <span className="token-exact-total">{exactTotal}</span>
                          ) : null}
                        </td>
                        <td>{formatNumber(group.records)}</td>
                      </tr>
                      {open
                        ? group.children.map((child) => (
                            <tr key={child.key} className="token-model-row">
                              <td>{rowLabel(child.kind, child.label)}</td>
                              <td>{formatNumber(child.totalTokens)}</td>
                              <td>{formatNumber(child.records)}</td>
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
