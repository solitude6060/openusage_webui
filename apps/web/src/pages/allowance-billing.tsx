import { useState, type FormEvent } from "react";
import { updateProviderSettings, type AllowanceBilling, type AllowanceBillingMonth } from "../lib/api";
import { formatApiMoney, formatDate, formatPercent } from "../lib/format";
import { formatCompactTokenCount } from "./tokens-page";

export function BillingMonths({
  providerId,
  billing,
  onSaved,
}: {
  providerId: string;
  billing: AllowanceBilling;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(() => localInputValue(billing.anchor));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await updateProviderSettings(providerId, { billingAnchor: new Date(value).toISOString() });
      setError(null);
      onSaved();
    } catch (saveError) {
      console.error("Billing date save failed:", saveError);
      setError(saveError instanceof Error ? saveError.message : "Failed to save the billing date");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="allowance-cycle-block">
      <h5>Billing Months</h5>
      {billing.anchorSource === "calendar" ? (
        <p className="settings-help muted">Calendar months; set your billing date</p>
      ) : null}
      {billing.anchorSource === "upgrade" && billing.anchor ? (
        <p className="settings-help muted">
          {`Billing date taken from your upgrade on ${formatDate(billing.anchor)}; earlier months are approximate`}
        </p>
      ) : null}
      <form className="allowance-billing-form" onSubmit={(event) => void save(event)}>
        <label>
          Billing Date
          <input type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <button className="secondary-button" disabled={saving || !value} type="submit">Save</button>
      </form>
      {error ? <div className="alert error">{error}</div> : null}
      {billing.months.length > 0 ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>API Dollars</th>
                <th>Tokens</th>
                <th>Weekly Used</th>
              </tr>
            </thead>
            <tbody>
              {billing.months.map((month) => (
                <tr key={month.start}>
                  <td>{formatDate(month.start)} – {formatDate(month.end)}</td>
                  <td>{dollarsCell(month)}</td>
                  <td>{tokensCell(month)}</td>
                  <td>{weeklyCell(month)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function dollarsCell(month: AllowanceBillingMonth) {
  return (
    <>
      <div>{month.apiDollars == null ? "—" : formatApiMoney(month.apiDollars)}</div>
      {month.projectedApiDollars == null ? null : (
        <div className="allowance-meta">
          {`Projected ${formatApiMoney(month.projectedApiDollars)}${month.projectionReliable ? "" : " · Unreliable"}`}
        </div>
      )}
    </>
  );
}

function tokensCell(month: AllowanceBillingMonth) {
  return (
    <>
      <div>{formatCompactTokenCount(month.tokens)}</div>
      {month.tokensFrom == null ? null : (
        <div className="allowance-meta">{`Token Data From ${formatDate(month.tokensFrom)}`}</div>
      )}
    </>
  );
}

// One line per regime; a percent before a plan change is never added to one after it.
function weeklyCell(month: AllowanceBillingMonth) {
  if (month.weeklyParts.length === 0) return "—";
  return month.weeklyParts.map((part) => (
    <div key={part.from} title={`${formatDate(part.from)} – ${formatDate(part.to)}`}>
      {`${formatPercent(part.consumedPercent)} of ${formatPercent(part.availablePercent)}`}
      {month.weeklyParts.length > 1 ? (
        <span className="allowance-meta">{` · ${formatDate(part.from)} – ${formatDate(part.to)}`}</span>
      ) : null}
    </div>
  ));
}

// A datetime-local input takes the browser's local time, not UTC.
function localInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
