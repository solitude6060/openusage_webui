import { useEffect, useMemo, useState } from "react";
import type { ProviderStatus } from "../../../../packages/core/src/types";
import {
  getAllowance,
  type AllowanceCompletedCycle,
  type AllowanceCycleExclusion,
  type AllowanceCycleStat,
  type AllowanceCycleSummary,
  type AllowanceEstimate,
  type AllowanceRange,
} from "../lib/api";
import { formatApiMoney, formatDate, formatMoney, formatNumber, formatPercent } from "../lib/format";
import { providerLabel } from "../provider-ui";
import { BillingMonths } from "./allowance-billing";
import { formatCompactTokenCount } from "./tokens-page";

const NARROW_LAYOUT = "(max-width: 640px)";

const RANGE_OPTIONS: Array<{ id: AllowanceRange; label: string }> = [
  { id: "1", label: "1 Day" },
  { id: "3", label: "3 Days" },
  { id: "5", label: "5 Days" },
  { id: "7", label: "7 Days" },
  { id: "30", label: "30 Days" },
  { id: "month", label: "This Month" },
  { id: "period", label: "This Period" },
  { id: "previous", label: "Previous Period" },
  { id: "cycles", label: "Subscription Period" },
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
  const [summaries, setSummaries] = useState<AllowanceCycleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloads, setReloads] = useState(0);
  const narrow = useNarrowLayout();
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
          if ("summaries" in next) {
            setSummaries(next.summaries);
            setEstimates([]);
          } else {
            setEstimates(next.estimates);
            setSummaries([]);
          }
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          console.error("Allowance load failed:", loadError);
          setError(loadError instanceof Error ? loadError.message : "Failed to load allowance");
          setEstimates([]);
          setSummaries([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [range, refreshToken, reloads]);

  return (
    <section className="page-grid">
      <section className="panel">
        <div className="panel-header">
          <h3>Allowance</h3>
          <span>{loading ? "—" : `${range === "cycles" ? summaries.length : estimates.length} Windows`}</span>
        </div>
        <div className="token-range-bar allowance-range-bar">
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
          <details className="allowance-explanation" open={!narrow}>
            <summary>How This Is Calculated</summary>
            {range === "cycles" ? (
              <>
                <p className="settings-help muted">
                  A subscription period runs from one reset to the next. The baseline is the median of the last four included periods. That median uses only the usage fully inside each period. The lowest, the highest, and how many periods that median used sit beside it, for tokens and for API dollars.
                </p>
                <p className="settings-help muted">
                  When the meter falls by 5 points or more while its stated reset stays put, the period was reset in place. Each stretch between resets is measured alone, and the period's consumed percent is the sum of their climbs, so it can pass 100. Allowance and dollars per percent divide only by the climbs of stretches that have tokens or a known API cost. A stretch that climbs 5 points or more with no tokens inside it leaves the period out as Segment Unmeasured. When dollars per percent on the two sides of a reset differ by more than 30 percent, the baseline keeps only the newer side.
                </p>
                <p className="settings-help muted">
                  The current period shows the latest meter reading, the tokens and API dollars fully inside it so far, and what remains of the baseline. The projected end percent is that reading divided by how much of the period has passed. Unreliable means the period is less than a day old, the meter fell during this period, or one of the last four periods ended more than an hour before its stated reset.
                </p>
              </>
            ) : (
              <>
                <p className="settings-help muted">
                  Estimated allowance divides the tokens used while the meter moved by how far that meter moved. API Value applies that same ratio to the API price recorded on those tokens. This Period is the current reset cycle, and Previous Period is the cycle before it. This Month uses this computer's calendar.
                </p>
                <p className="settings-help muted">
                  Daily totals cannot be split inside a day. A day boundary counts when the meter readings on both sides are equal, and each end can then be off by one percentage point. Spans that cannot find two such times show Daily Usage Cannot Align and have no allowance estimate. Token totals below include only fully covered records.
                </p>
              </>
            )}
          </details>
          {error ? <div className="alert error">{error}</div> : null}
          {loading ? <div className="loading-indicator">Loading...</div> : null}
          {!loading && !error && (range === "cycles" ? summaries.length : groups.length) === 0 ? (
            <p className="settings-help muted">No Allowance Estimate In This Range</p>
          ) : null}
          {!loading && range === "cycles" && summaries.length > 0 ? (
            <div className="allowance-list">
              {summaries.map((summary) => (
                <AllowancePeriod
                  key={`${summary.providerId}:${summary.windowKey}`}
                  summary={summary}
                  providerName={names.get(summary.providerId)}
                  onBillingSaved={() => setReloads((count) => count + 1)}
                />
              ))}
            </div>
          ) : null}
          {!loading && range !== "cycles" && groups.length > 0 ? (
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

function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(NARROW_LAYOUT).matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(NARROW_LAYOUT);
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return narrow;
}

function isCursorAccount(providerId: string): boolean {
  return providerId === "cursor" || providerId.startsWith("cursor:");
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
        {cycle.statedLimit != null
          ? ` · ${isCursorAccount(cycle.providerId) ? "Included Dollar Limit" : "Stated Cap"} ${formatLimit(cycle)}`
          : ""}
      </p>
      {isCursorAccount(cycle.providerId) && cycle.statedLimit != null ? (
        <p className="allowance-meta">
          When Cursor reports its combined pool percent, that percent has a different denominator from this dollar limit. Team plans, and plans without that percent, use spend divided by this limit.
        </p>
      ) : null}
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

function AllowancePeriod({
  summary,
  providerName,
  onBillingSaved,
}: {
  summary: AllowanceCycleSummary;
  providerName: string | undefined;
  onBillingSaved: () => void;
}) {
  const tokens = summary.baseline.tokens;
  const dollars = summary.baseline.apiDollars;
  const perPercent = summary.baseline.dollarsPerPercent;
  return (
    <article className="allowance-account">
      <div className="allowance-account-header">
        <h4>{providerLabel(summary.providerId, providerName)}</h4>
        <span>{summary.windowLabel}</span>
      </div>
      <section className="allowance-cycle-block">
        <h5>Baseline</h5>
        {tokens ? (
          <p className="allowance-figure" title={`${formatNumber(Math.round(tokens.median))} tokens`}>
            {formatCompactTokenCount(Math.round(tokens.median))}
            <span className="allowance-unit"> tokens</span>
          </p>
        ) : (
          <p className="allowance-reason">No Baseline</p>
        )}
        {tokens ? <p className="allowance-meta">{statRange(tokens, formatCompactTokenCount)}</p> : null}
        {dollars ? <p className="allowance-api">API Dollars {statRange(dollars, formatApiMoney)}</p> : null}
        {perPercent ? <p className="allowance-api">API Dollars Per Percent {statRange(perPercent, formatApiMoney)}</p> : null}
        {summary.regimeChanged ? (
          <p className="allowance-meta">Rate Changed At A Mid-Period Reset · Baseline Uses Only The Newer Side</p>
        ) : null}
      </section>
      <section className="allowance-cycle-block">
        <h5>Current Cycle</h5>
        {summary.current ? <CurrentCycle current={summary.current} /> : <p className="allowance-reason">No Open Cycle</p>}
      </section>
      <CompletedCycles cycles={summary.cycles} />
      {summary.billing ? (
        <BillingMonths providerId={summary.providerId} billing={summary.billing} onSaved={onBillingSaved} />
      ) : null}
    </article>
  );
}

function CurrentCycle({ current }: { current: NonNullable<AllowanceCycleSummary["current"]> }) {
  return (
    <>
      <p className="allowance-meta">
        {formatDate(current.start)} – {formatDate(current.end)} · {formatCycleLength(current.lengthMs)}
      </p>
      <p className="allowance-figure">
        {current.usedPercent == null ? "—" : formatPercent(current.usedPercent)}
        <span className="allowance-unit"> used</span>
        {current.meterFell ? <> · <span>Meter Fell</span></> : null}
      </p>
      <p className="allowance-meta">
        So Far {formatCompactTokenCount(current.tokens)} tokens
        {current.apiCost == null ? "" : ` · API Dollars ${formatApiMoney(current.apiCost)}`}
      </p>
      <p className="allowance-meta">
        Remaining {current.remainingTokens == null ? "—" : `${formatCompactTokenCount(Math.round(current.remainingTokens))} tokens`}
        {current.remainingApiCost == null ? "" : ` · ${formatApiMoney(current.remainingApiCost)}`}
      </p>
      <p className="allowance-meta">
        Projected End {current.projectedEndPercent == null ? "—" : formatPercent(current.projectedEndPercent)}
        {current.projectionReliable ? null : <> · <span>Unreliable</span></>}
      </p>
    </>
  );
}

function CompletedCycles({ cycles }: { cycles: AllowanceCompletedCycle[] }) {
  if (cycles.length === 0) return null;
  const rows = cycles.map((cycle) => ({
    key: `${cycle.start}:${cycle.end}`,
    fields: completedFields(cycle),
  }));
  return (
    <>
      <div className="table-scroll allowance-cycle-table">
        <table>
          <thead>
            <tr>
              {rows[0]!.fields.map((field) => (
                <th key={field.label}>{field.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                {row.fields.map((field) => (
                  <td key={field.label}>{field.value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="allowance-cycle-cards" aria-label="Completed Cycles">
        {rows.map((row) => (
          <li className="allowance-cycle-card" key={row.key}>
            {row.fields.map((field) => (
              <div key={field.label}>
                <span>{field.label}</span>
                <strong>{field.value}</strong>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

function completedFields(cycle: AllowanceCompletedCycle): Array<{ label: string; value: string }> {
  return [
    { label: "Period", value: `${formatDate(cycle.start)} – ${formatDate(cycle.end)}` },
    { label: "Length", value: formatCycleLength(cycle.lengthMs) },
    { label: "Consumed", value: consumedLabel(cycle) },
    { label: "Tokens", value: formatTokenSpan(cycle.tokensLow, cycle.tokensHigh) },
    { label: "Allowance", value: formatTokenSpan(cycle.allowanceLow, cycle.allowanceHigh) },
    { label: "API Dollars", value: formatMoneySpan(cycle.apiDollarsLow, cycle.apiDollarsHigh) },
    { label: "Reason", value: cycleReasonLabel(cycle.exclusion) },
  ];
}

function consumedLabel(cycle: AllowanceCompletedCycle): string {
  const percent = formatPercent(cycle.consumedPercent);
  return cycle.segments.length > 1 ? `${percent} · ${cycle.segments.length} Segments` : percent;
}

function statRange(stat: AllowanceCycleStat, format: (value: number) => string): string {
  return `${format(stat.median)} median · ${format(stat.min)}–${format(stat.max)} · n ${stat.n}`;
}

function formatCycleLength(lengthMs: number): string {
  const days = Math.round((lengthMs / 86_400_000) * 10) / 10;
  const text = Number.isInteger(days) ? String(days) : days.toFixed(1);
  return `${text} ${days === 1 ? "Day" : "Days"}`;
}

function formatTokenSpan(low: number | null, high: number | null): string {
  return formatSpan(low, high, (value) => formatCompactTokenCount(Math.round(value)));
}

function formatMoneySpan(low: number | null, high: number | null): string {
  return formatSpan(low, high, formatApiMoney);
}

function formatSpan(low: number | null, high: number | null, format: (value: number) => string): string {
  if (low == null && high == null) return "—";
  if (low != null && high != null && low === high) return format(low);
  if (low == null) return `Unknown–${format(high as number)}`;
  if (high == null) return `${format(low)}–Unknown`;
  return `${format(low)}–${format(high)}`;
}

function cycleReasonLabel(reason: AllowanceCycleExclusion | null): string {
  if (reason === "meter-fell") return "Meter Fell";
  if (reason === "shared-log") return "Shared Session Log";
  if (reason === "history-truncated") return "History Truncated";
  if (reason === "no-tokens") return "No Tokens";
  if (reason === "below-min-percent") return "Below 10 Percent";
  if (reason === "edge-uncertain") return "Edge Uncertain";
  if (reason === "observation-gap") return "Observation Gap";
  if (reason === "segment-unmeasured") return "Segment Unmeasured";
  return "Included";
}
