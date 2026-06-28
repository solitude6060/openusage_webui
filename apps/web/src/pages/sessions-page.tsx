import { FormEvent, useState } from "react";
import type { UsageRecord } from "../../../../packages/core/src/types";
import { getUsageRecords } from "../lib/api";
import { providerCards, providerLabel } from "../provider-ui";
import { formatDate, formatMoney, formatNumber, formatQuota } from "../lib/format";

export function SessionsPage({
  records,
  onRecords,
}: {
  records: UsageRecord[];
  onRecords: (records: UsageRecord[]) => void;
}) {
  const [filters, setFilters] = useState({
    providerId: "",
    from: "",
    to: "",
    limit: "100",
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      onRecords(
        await getUsageRecords({
          providerId: filters.providerId,
          from: filters.from ? new Date(filters.from).toISOString() : undefined,
          to: filters.to ? new Date(filters.to).toISOString() : undefined,
          limit: Number(filters.limit),
        }),
      );
    } catch (filterError) {
      setError(filterError instanceof Error ? filterError.message : "Filter failed");
    }
  }

  return (
    <section className="page-grid">
      <form className="filter-bar" onSubmit={submit}>
        <label>
          Provider
          <select
            value={filters.providerId}
            onChange={(event) => setFilters({ ...filters, providerId: event.target.value })}
          >
            <option value="">All</option>
            {providerCards.map((card) => (
              <option key={card.providerId} value={card.providerId}>
                {card.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="datetime-local"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="datetime-local"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </label>
        <label>
          Limit
          <input
            min="1"
            max="1000"
            type="number"
            value={filters.limit}
            onChange={(event) => setFilters({ ...filters, limit: event.target.value })}
          />
        </label>
        <button className="primary-button" type="submit">
          Apply
        </button>
      </form>
      {error ? <div className="alert error">{error}</div> : null}
      <section className="panel">
        <div className="panel-header">
          <h3>Usage Records</h3>
          <span>{records.length} Rows</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Started At</th>
              <th>Provider</th>
              <th>Tool</th>
              <th>Model</th>
              <th>Input Tokens</th>
              <th>Output Tokens</th>
              <th>Total Tokens</th>
              <th>Quota</th>
              <th>Cost USD</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={10}>No Usage Records Yet</td>
              </tr>
            ) : (
              records.map((record) => (
                <tr key={record.id}>
                  <td>{formatDate(record.startedAt)}</td>
                  <td>{providerLabel(record.providerId)}</td>
                  <td>{record.tool ?? "-"}</td>
                  <td>{record.model ?? "-"}</td>
                  <td>{formatNumber(record.inputTokens ?? 0)}</td>
                  <td>{formatNumber(record.outputTokens ?? 0)}</td>
                  <td>{formatNumber(record.totalTokens ?? 0)}</td>
                  <td>{formatQuota(record)}</td>
                  <td>{formatMoney(record.costUsd ?? 0)}</td>
                  <td>{record.source}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}
