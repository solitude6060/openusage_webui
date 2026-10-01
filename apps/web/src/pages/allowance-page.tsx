import { useEffect, useMemo, useState } from "react";
import type { ProviderStatus } from "../../../../packages/core/src/types";
import {
  getAllowance,
  type AllowanceEstimate,
  type AllowanceRange,
} from "../lib/api";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { providerLabel } from "../provider-ui";
import { formatCompactTokenCount } from "./tokens-page";

const RANGE_OPTIONS: Array<{ id: AllowanceRange; label: string }> = [
  { id: "1", label: "1 Day" },
  { id: "3", label: "3 Days" },
  { id: "5", label: "5 Days" },
  { id: "7", label: "7 Days" },
  { id: "30", label: "30 Days" },
  { id: "month", label: "This Month" },
  { id: "period", label: "This Period" },
  { id: "previous", label: "Previous Period" },
];

export function AllowancePage({
  providers,
  refreshToken,
}: {
  providers: ProviderStatus[];
  refreshToken: number;
}) {
  const [range, setRange] = useState<AllowanceRange>("7");
  const [estimates, setEstimates] = useState<AllowanceEstimate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const names = useMemo(
    () => new Map(providers.map((provider) => [provider.providerId, provider.name])),
    [providers],
  );
  const groups = useMemo(() => groupEstimates(estimates), [estimates]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const next = await getAllowance(range);
        if (!cancelled) {
          setEstimates(next.estimates);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          console.error("Allowance load failed:", loadError);
          setError(loadError instanceof Error ? loadError.message : "Failed to load allowance");
          setEstimates([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [range, refreshToken]);

  return (
    <section className="page-grid">
      <section className="panel">
        <div className="panel-header">
          <h3>Allowance</h3>
          <span>{loading ? "—" : `${estimates.length} Windows`}</span>
        </div>
        <div className="token-range-bar">
          <div className="chip-list" role="group" aria-label="Time Range">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={range === option.id ? "value-chip token-range-active" : "value-chip"}
                onClick={() => setRange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          <p className="settings-help muted">
            Estimated allowance divides the tokens used while the meter moved by how far that meter moved. API Value applies that same ratio to the API price recorded on those tokens. This Period is the current reset cycle, and Previous Period is the cycle before it. This Month uses this computer's calendar.
          </p>
          <p className="settings-help muted">
            Daily totals cannot be split at a meter reading or reset within the day. Those spans show Daily Usage Cannot Align and have no allowance estimate. Token totals below include only fully covered records.
          </p>
          {error ? <div className="alert error">{error}</div> : null}
          {loading ? <div className="loading-indicator">Loading...</div> : null}
          {!loading && !error && groups.length === 0 ? (
            <p className="settings-help muted">No Allowance Estimate In This Range</p>
          ) : null}
          {!loading && groups.length > 0 ? (
            <div className="allowance-list">
              {groups.map((group) => (
                <article className="allowance-account" key={`${group.providerId}:${group.windowKey}`}>
                  <div className="allowance-account-header">
                    <h4>{providerLabel(group.providerId, names.get(group.providerId))}</h4>
                    <span>{group.windowLabel}</span>
                  </div>
                  {group.cycles.map((cycle) => (
                    <AllowanceCycle key={`${cycle.from}:${cycle.resetsAt ?? ""}`} cycle={cycle} />
                  ))}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function AllowanceCycle({ cycle }: { cycle: AllowanceEstimate }) {
  const allowance = cycle.estimatedAllowance;
  return (
    <div className="allowance-cycle">
      <p className="allowance-meta">
        {formatDate(cycle.from)} – {formatDate(cycle.to)}
        {cycle.percentStart != null && cycle.percentEnd != null
          ? ` · ${formatPercent(cycle.percentStart)} → ${formatPercent(cycle.percentEnd)}`
          : ""}
      </p>
      {allowance != null ? (
        <p className="allowance-figure" title={`${formatNumber(Math.round(allowance))} tokens`}>
          {formatCompactTokenCount(Math.round(allowance))}
          <span className="allowance-unit"> tokens</span>
        </p>
      ) : (
        <p className="allowance-reason">{reasonLabel(cycle.reason)}</p>
      )}
      {cycle.estimatedApiCost != null ? (
        <p className="allowance-api">API Value {formatApiMoney(cycle.estimatedApiCost)}</p>
      ) : null}
      <p className="allowance-meta">
        {cycle.tokens > 0 ? `${formatCompactTokenCount(cycle.tokens)} tokens used` : "No tokens in this span"}
        {cycle.apiCost != null ? ` · API Cost ${formatApiMoney(cycle.apiCost)}` : ""}
        {cycle.coarse ? " · Rough Estimate" : ""}
        {cycle.statedLimit != null ? ` · Stated Cap ${formatLimit(cycle)}` : ""}
      </p>
      {cycle.models.length > 0 ? (
        <ul className="allowance-models">
          {cycle.models.map((model) => (
            <li key={model.model}>
              <span>{model.model}</span>
              <span>{formatCompactTokenCount(model.tokens)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function groupEstimates(estimates: AllowanceEstimate[]): Array<{
  providerId: string;
  windowKey: string;
  windowLabel: string;
  cycles: AllowanceEstimate[];
}> {
  const groups: Array<{
    providerId: string;
    windowKey: string;
    windowLabel: string;
    cycles: AllowanceEstimate[];
  }> = [];
  for (const estimate of estimates) {
    const current = groups.find((group) =>
      group.providerId === estimate.providerId && group.windowKey === estimate.windowKey,
    );
    if (current) current.cycles.push(estimate);
    else {
      groups.push({
        providerId: estimate.providerId,
        windowKey: estimate.windowKey,
        windowLabel: estimate.windowLabel,
        cycles: [estimate],
      });
    }
  }
  return groups;
}

function formatApiMoney(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded % 1 === 0 ? Math.round(rounded) : rounded}%`;
}

function formatLimit(cycle: AllowanceEstimate): string {
  if (cycle.statedLimit == null) return "";
  if (cycle.statedLimitUnit === "usd") return formatMoney(cycle.statedLimit);
  if (cycle.statedLimitUnit === "tokens") return `${formatNumber(Math.round(cycle.statedLimit))} tokens`;
  if (cycle.statedLimitUnit === "requests") return `${formatNumber(Math.round(cycle.statedLimit))} requests`;
  return formatNumber(cycle.statedLimit);
}

function reasonLabel(reason: AllowanceEstimate["reason"]): string {
  if (reason === "unaligned") return "Daily Usage Cannot Align";
  if (reason === "shared-log") return "Shared Session Log";
  if (reason === "meter-fell") return "Meter Fell";
  if (reason === "no-tokens") return "No Tokens In This Range";
  return "Meter Did Not Move";
}
