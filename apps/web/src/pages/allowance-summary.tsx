import type { ReactNode } from "react";
import type { AllowanceCycleSummary } from "../lib/api";
import { formatApiMoney, formatDate, formatPercent } from "../lib/format";
import { providerLabel } from "../provider-ui";
import { formatCompactTokenCount } from "./tokens-page";

const MONTH_SOURCE = {
  setting: "Billing Date Set",
  upgrade: "Detected Upgrade",
  calendar: "Calendar Month",
} as const;

export type FieldRow = { key: string; fields: Array<{ label: string; value: ReactNode }> };

// A table on a wide screen and one card per row on a narrow one.
export function FieldRows({ label, rows }: { label: string; rows: FieldRow[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <div className="table-scroll allowance-cycle-table">
        <table aria-label={label}>
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
      <ul className="allowance-cycle-cards" aria-label={label}>
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

export function MonthlySummary({
  summaries,
  names,
}: {
  summaries: AllowanceCycleSummary[];
  names: Map<string, string>;
}) {
  if (summaries.length === 0) return null;
  return (
    <section className="allowance-cycle-block allowance-summary">
      <h4>This Billing Month</h4>
      <FieldRows
        label="This Billing Month"
        rows={summaries.map((summary) => ({
          key: `${summary.providerId}:${summary.windowKey}`,
          fields: monthFields(summary, names.get(summary.providerId)),
        }))}
      />
      <p className="settings-help muted">API value is what these tokens would cost at API list prices.</p>
    </section>
  );
}

function monthFields(summary: AllowanceCycleSummary, name: string | undefined): FieldRow["fields"] {
  const usage = monthUsage(summary);
  const current = summary.current;
  return [
    { label: "Provider", value: providerLabel(summary.providerId, name) },
    { label: "Billing Month", value: usage.month },
    { label: "Tokens", value: noTokenHistory(summary) && usage.tokens !== SHARED_LOG ? "No Local Token History" : usage.tokens },
    { label: "API Value", value: money(usage.apiDollars) },
    { label: "Projected Month End", value: money(usage.projected) },
    {
      label: "Meter Now",
      value: current?.usedPercent == null ? "—" : `${formatPercent(current.usedPercent)} ${summary.windowLabel}`,
    },
  ];
}

const SHARED_LOG = "Shares Another Account's Session Log";

function monthUsage(summary: AllowanceCycleSummary): {
  month: ReactNode;
  tokens: ReactNode;
  apiDollars: number | null;
  projected: number | null;
} {
  if (summary.billing) {
    const month = summary.billing.months.find((item) => item.current);
    if (!month) return { month: "—", tokens: "—", apiDollars: null, projected: null };
    return {
      month: monthCell(month.start, month.end, MONTH_SOURCE[summary.billing.anchorSource]),
      tokens: (
        <>
          <div>{formatCompactTokenCount(month.tokens)}</div>
          {month.tokensFrom ? <div className="allowance-meta">{`From ${formatDate(month.tokensFrom)}`}</div> : null}
        </>
      ),
      apiDollars: month.apiDollars,
      projected: month.projectionReliable ? month.projectedApiDollars : null,
    };
  }
  // A weekly window without billing months shares its session log with another account.
  if (summary.windowKey === "weekly") return { month: "—", tokens: SHARED_LOG, apiDollars: null, projected: null };
  // A monthly window's current cycle is its billing month.
  const current = summary.current;
  if (!current) return { month: "—", tokens: "—", apiDollars: null, projected: null };
  return {
    month: monthCell(current.start, current.end, "Provider Monthly Window"),
    tokens: formatCompactTokenCount(current.tokens),
    apiDollars: current.apiCost,
    projected: current.projectionReliable && current.apiCost != null && current.elapsedFraction > 0
      ? current.apiCost / current.elapsedFraction
      : null,
  };
}

function monthCell(start: string, end: string, source: string) {
  return (
    <>
      <div>{formatDate(start)} – {formatDate(end)}</div>
      <div className="allowance-meta">{source}</div>
    </>
  );
}

function noTokenHistory(summary: AllowanceCycleSummary): boolean {
  return (summary.billing?.months ?? []).every((month) => month.tokens === 0)
    && (summary.current?.tokens ?? 0) === 0
    && summary.cycles.every((cycle) => cycle.tokensHigh === 0);
}

function money(value: number | null): string {
  return value == null ? "—" : formatApiMoney(value);
}
