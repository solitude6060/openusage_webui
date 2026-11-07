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
import { FieldRows, meterPercent, MonthlySummary } from "./allowance-summary";
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
  const [cyclesError, setCyclesError] = useState<string | null>(null);
  const [cyclesLoading, setCyclesLoading] = useState(true);
  const [reloads, setReloads] = useState(0);
  const narrow = useNarrowLayout();
  const names = useMemo(
    () => new Map(providers.map((provider) => [provider.providerId, provider.name])),
    [providers],
  );
  const groups = useMemo(() => groupEstimates(estimates), [estimates]);

  // The monthly summary and the Subscription Period tab share one span=cycles load.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setCyclesLoading(true);
      try {
        const next = await getAllowance("cycles");
        if (!cancelled) {
          setSummaries("summaries" in next ? next.summaries : []);
          setCyclesError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          console.error("Allowance cycles load failed:", loadError);
          setCyclesError(loadError instanceof Error ? loadError.message : "Failed to load allowance");
          setSummaries([]);
        }
      } finally {
        if (!cancelled) setCyclesLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshToken, reloads]);

  useEffect(() => {
    if (range === "cycles") return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const next = await getAllowance(range);
        if (!cancelled) {
          setEstimates("estimates" in next ? next.estimates : []);
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
  }, [range, refreshToken, reloads]);

  const cycles = range === "cycles";
  const shownLoading = cycles ? cyclesLoading : loading;
  const shownError = cycles ? cyclesError : error;

  return (
    <section className="page-grid">
      <section className="panel">
        <div className="panel-header">
          <h3>Allowance</h3>
          <span>{cyclesLoading ? "—" : `${summaries.length} Providers`}</span>
        </div>
        <div className="panel-body">
          {cyclesError ? <div className="alert error">{cyclesError}</div> : null}
          {cyclesLoading ? <div className="loading-indicator">Loading...</div> : null}
          {!cyclesLoading ? <MonthlySummary summaries={summaries} names={names} /> : null}
          <details className="allowance-details">
            <summary>Details</summary>
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
            <div className="allowance-details-body">
              <details className="allowance-explanation" open={!narrow}>
                <summary>How This Is Calculated</summary>
                {range === "cycles" ? (
                  <>
                    <p className="settings-help muted">
                      A subscription period runs from one reset to the next. The baseline is the median of the last four included periods. That median uses only the usage fully inside each period. The lowest, the highest, and how many periods that median used sit beside it, for tokens and for API dollars.
                    </p>
                    <p className="settings-help muted">
                      When the meter falls by 5 points or more while its stated reset stays put, the period was reset in place. Each stretch between resets is measured alone, and each climb is listed on its own, for example 96% + 89%. Allowance and dollars per percent divide only by the climbs of stretches that have tokens or a known API cost. A stretch that climbs 5 points or more with no tokens inside it leaves the period out of the baseline. When dollars per percent on the two sides of a reset differ by more than 30 percent, the baseline keeps only the newer side.
                    </p>
                    <p className="settings-help muted">
                      The current period shows the latest meter reading, the tokens and API dollars fully inside it so far, and what remains of the baseline. The projected end percent is that reading divided by how much of the period has passed; above 100 it reads Runs Out Before Reset At This Pace. Unreliable means the period is less than a day old, the meter fell during this period, or one of the last four periods ended more than an hour before its stated reset.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="settings-help muted">
                      Estimated allowance divides the tokens used while the meter moved by how far that meter moved. API Value applies that same ratio to the API price recorded on those tokens. This Period is the current reset cycle, and Previous Period is the cycle before it. This Month uses this computer's calendar.
                    </p>
                    <p className="settings-help muted">
                      Daily totals cannot be split inside a day. A day boundary counts when the meter readings on both sides are equal, and each end can then be off by one percentage point. Spans that cannot find two such times have no allowance estimate and say why. Token totals below include only fully covered records.
                    </p>
                  </>
                )}
              </details>
              {cycles ? null : error ? <div className="alert error">{error}</div> : null}
              {!cycles && loading ? <div className="loading-indicator">Loading...</div> : null}
              {!shownLoading && !shownError && (cycles ? summaries.length : groups.length) === 0 ? (
                <p className="settings-help muted">No Allowance Estimate In This Range</p>
              ) : null}
              {!cyclesLoading && cycles && summaries.length > 0 ? (
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
              {!loading && !cycles && groups.length > 0 ? (
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
          </details>
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
          ? ` · ${meterPercent(cycle.percentStart)} → ${meterPercent(cycle.percentEnd)}`
          : ""}
      </p>
      {allowance != null && cycle.coarse ? (
        <p className="allowance-meta">
          {`The meter moved too little for a reliable estimate: about ${formatCompactTokenCount(Math.round(allowance))} tokens`}
          {cycle.estimatedApiCost != null ? ` · API Value ${formatApiMoney(cycle.estimatedApiCost)}` : ""}
        </p>
      ) : allowance != null ? (
        <p className="allowance-figure" title={`${formatNumber(Math.round(allowance))} tokens`}>
          {formatCompactTokenCount(Math.round(allowance))}
          <span className="allowance-unit"> tokens</span>
        </p>
      ) : (
        <p className="allowance-reason">{reasonLabel(cycle.reason)}</p>
      )}
      {cycle.estimatedApiCost != null && !cycle.coarse ? (
        <p className="allowance-api">API Value {formatApiMoney(cycle.estimatedApiCost)}</p>
      ) : null}
      <p className="allowance-meta">
        {cycle.tokens > 0 ? `${formatCompactTokenCount(cycle.tokens)} tokens used` : "No tokens in this span"}
        {cycle.apiCost != null ? ` · API Cost ${formatApiMoney(cycle.apiCost)}` : ""}
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

const NOT_USED = "so this span is not used for estimates.";

function reasonLabel(reason: AllowanceEstimate["reason"]): string {
  if (reason === "unaligned") return "Daily usage totals cannot be lined up with the meter readings in this span, so it has no estimate.";
  if (reason === "shared-log") return "This account shares its session log with another account, so its tokens cannot be told apart and this span is not used for estimates.";
  if (reason === "meter-fell") return `The meter dropped before its stated reset time, ${NOT_USED}`;
  if (reason === "no-tokens") return "No token records fall inside this span, so it is not used for estimates.";
  return "The meter did not move in this span, so there is nothing to divide the tokens by.";
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
      <CompletedCycles cycles={summary.cycles} windowKey={summary.windowKey} />
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
        {current.usedPercent == null ? "—" : meterPercent(current.usedPercent)}
        {current.usedPercent != null && current.usedPercent > 100 ? null : <span className="allowance-unit"> used</span>}
      </p>
      {current.meterFell ? (
        <p className="allowance-meta">
          The meter dropped during this cycle before its stated reset time, so the projection is unreliable.
        </p>
      ) : null}
      <p className="allowance-meta">
        So Far {formatCompactTokenCount(current.tokens)} tokens
        {current.apiCost == null ? "" : ` · API Dollars ${formatApiMoney(current.apiCost)}`}
      </p>
      <p className="allowance-meta">
        Remaining {current.remainingTokens == null ? "—" : `${formatCompactTokenCount(Math.round(current.remainingTokens))} tokens`}
        {current.remainingApiCost == null ? "" : ` · ${formatApiMoney(current.remainingApiCost)}`}
      </p>
      <p className="allowance-meta">
        Projected End {projectedEnd(current.projectedEndPercent)}
        {current.projectionReliable ? null : <> · <span>Unreliable</span></>}
      </p>
    </>
  );
}

function CompletedCycles({ cycles, windowKey }: { cycles: AllowanceCompletedCycle[]; windowKey: string }) {
  return (
    <FieldRows
      label="Completed Cycles"
      rows={cycles.map((cycle) => ({ key: `${cycle.start}:${cycle.end}`, fields: completedFields(cycle, windowKey) }))}
    />
  );
}

function completedFields(cycle: AllowanceCompletedCycle, windowKey: string): Array<{ label: string; value: string }> {
  return [
    { label: "Period", value: `${formatDate(cycle.start)} – ${formatDate(cycle.end)}` },
    { label: "Length", value: formatCycleLength(cycle.lengthMs) },
    { label: "Consumed", value: consumedLabel(cycle, windowKey) },
    { label: "Tokens", value: formatTokenSpan(cycle.tokensLow, cycle.tokensHigh) },
    { label: "Allowance", value: formatTokenSpan(cycle.allowanceLow, cycle.allowanceHigh) },
    { label: "API Dollars", value: formatMoneySpan(cycle.apiDollarsLow, cycle.apiDollarsHigh) },
    { label: "Reason", value: cycleReasonLabel(cycle.exclusion) },
  ];
}

// Each segment climbs at most 100 points; their sum can pass 100, so the climbs are listed instead.
function consumedLabel(cycle: AllowanceCompletedCycle, windowKey: string): string {
  if (cycle.segments.length <= 1) return meterPercent(cycle.consumedPercent);
  const climbs = cycle.segments.map((segment) => formatPercent(segment.endPercent - segment.startPercent)).join(" + ");
  return `${climbs} · Meter Reset Mid-${windowKey === "weekly" ? "Week" : "Cycle"}`;
}

function statRange(stat: AllowanceCycleStat, format: (value: number) => string): string {
  return `${format(stat.median)} median · ${format(stat.min)}–${format(stat.max)} · n ${stat.n}`;
}

function projectedEnd(percent: number | null): string {
  if (percent == null) return "—";
  return percent > 100 ? "Runs Out Before Reset At This Pace" : formatPercent(percent);
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
  if (reason === "meter-fell" || reason === "shared-log" || reason === "no-tokens") return reasonLabel(reason);
  if (reason === "history-truncated") return "This span starts before the oldest stored record, so part of its usage is missing and it is not used for estimates.";
  if (reason === "below-min-percent") return `The meter climbed less than 10 points, too little to measure, ${NOT_USED}`;
  if (reason === "edge-uncertain") return "More than a quarter of the usage crosses this span's start or end, so it is not used for estimates.";
  if (reason === "observation-gap") return "No meter reading arrived in the last day before this span ended, so it is not used for estimates.";
  if (reason === "segment-unmeasured") return "Part of this span climbed 5 points or more with no tokens recorded, so it is not used for estimates.";
  return "Included";
}
