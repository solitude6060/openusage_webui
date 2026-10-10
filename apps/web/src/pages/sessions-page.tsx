import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ProviderStatus, UsageRecord } from "../../../../packages/core/src/types";
import { getUsageRecords } from "../lib/api";
import { shouldApplySessionLoad } from "../lib/session-load";
import { listProviderCards, providerLabel } from "../provider-ui";
import {
  clampUsageLimit,
  emptySessionMessage,
  formatDate,
  formatOptionalMoney,
  formatOptionalNumber,
  formatQuota,
} from "../lib/format";

type SessionFilters = {
  providerId: string;
  from: string;
  to: string;
  limit: string;
};

function usageQuery(filters: SessionFilters) {
  return {
    providerId: filters.providerId,
    from: filters.from ? new Date(filters.from).toISOString() : undefined,
    to: filters.to ? new Date(filters.to).toISOString() : undefined,
    limit: clampUsageLimit(filters.limit),
  };
}

function sessionFiltersActive(filters: SessionFilters): boolean {
  if (filters.providerId || filters.from || filters.to) return true;
  const limit = filters.limit.trim();
  return limit !== "" && limit !== "100";
}

export function SessionsPage({
  providers,
  refreshToken,
}: {
  providers: ProviderStatus[];
  refreshToken: number;
}) {
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [filters, setFilters] = useState<SessionFilters>({
    providerId: "",
    from: "",
    to: "",
    limit: "100",
  });
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const loadRequestId = useRef(0);
  const [loadedFilters, setLoadedFilters] = useState(filters);
  const [error, setError] = useState<string | null>(null);
  const providerOptions = useMemo(() => listProviderCards(providers), [providers]);
  const providerNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const status of providers) {
      map.set(status.providerId, status.name);
    }
    return map;
  }, [providers]);

  async function load(next: SessionFilters) {
    const requestId = ++loadRequestId.current;
    setError(null);
    setLoadedFilters(next);
    try {
      const nextRecords = await getUsageRecords(usageQuery(next));
      if (!shouldApplySessionLoad(requestId, loadRequestId.current)) return;
      setRecords(nextRecords);
    } catch (filterError) {
      if (!shouldApplySessionLoad(requestId, loadRequestId.current)) return;
      setError(filterError instanceof Error ? filterError.message : "Filter failed");
    }
  }

  useEffect(() => {
    void load(filtersRef.current);
  }, [refreshToken]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await load(filters);
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
            {providerOptions.map((card) => (
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
        <div className="table-scroll session-table">
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
                  <td className="table-empty-cell" colSpan={10}>
                    {emptySessionMessage(sessionFiltersActive(loadedFilters))}
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id}>
                    <td>{formatDate(record.startedAt)}</td>
                    <td>{providerLabel(record.providerId, providerNames.get(record.providerId))}</td>
                    <td>{record.tool ?? "-"}</td>
                    <td>{record.model ?? "-"}</td>
                    <td>{formatOptionalNumber(record.inputTokens)}</td>
                    <td>{formatOptionalNumber(record.outputTokens)}</td>
                    <td>{formatOptionalNumber(record.totalTokens)}</td>
                    <td>{formatQuota(record)}</td>
                    <td>{formatOptionalMoney(record.costUsd)}</td>
                    <td>{record.source}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <ul className="session-cards" aria-label="Session Records">
          {records.length === 0 ? (
            <li className="session-card session-card-empty">
              {emptySessionMessage(sessionFiltersActive(loadedFilters))}
            </li>
          ) : (
            records.map((record) => (
              <li className="session-card" key={record.id}>
                <div>
                  <span>Started At</span>
                  <strong>{formatDate(record.startedAt)}</strong>
                </div>
                <div>
                  <span>Provider</span>
                  <strong>{providerLabel(record.providerId, providerNames.get(record.providerId))}</strong>
                </div>
                <div>
                  <span>Tool</span>
                  <strong>{record.tool ?? "-"}</strong>
                </div>
                <div>
                  <span>Model</span>
                  <strong>{record.model ?? "-"}</strong>
                </div>
                <div>
                  <span>Tokens</span>
                  <strong>{formatOptionalNumber(record.totalTokens)}</strong>
                </div>
                <div>
                  <span>Cost</span>
                  <strong>{formatOptionalMoney(record.costUsd)}</strong>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </section>
  );
}
