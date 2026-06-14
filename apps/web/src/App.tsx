import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  ProviderId,
  ProviderStatus,
  UsageRecord,
  UsageSummary,
} from "../../../packages/core/src/types";
import {
  createManualUsage,
  getHealth,
  getProviderSettings,
  getProviders,
  getUsageRecords,
  getUsageSummary,
  refreshAllProviders,
  refreshProvider,
  updateProviderSettings,
  type HealthResponse,
} from "./lib/api";

type Page = "dashboard" | "providers" | "sessions" | "settings";

const pages: Array<{ id: Page; label: string; path: string }> = [
  { id: "dashboard", label: "Dashboard", path: "/dashboard" },
  { id: "providers", label: "Providers", path: "/providers" },
  { id: "sessions", label: "Sessions", path: "/sessions" },
  { id: "settings", label: "Settings", path: "/settings" },
];

const providerLabels: Record<ProviderId, string> = {
  ccusage: "ccusage",
  "claude-code": "Claude Code",
  codex: "Codex",
  "github-copilot": "GitHub Copilot",
  "gemini-cli": "Gemini CLI",
  "google-ai-pro": "Google AI Pro",
  minimax: "MiniMax",
  manual: "Manual",
};

const providerCards: Array<{ providerId: ProviderId; name: string; note?: string }> = [
  { providerId: "ccusage", name: "ccusage" },
  { providerId: "claude-code", name: "Claude Code", note: "via ccusage" },
  { providerId: "codex", name: "Codex", note: "via ccusage" },
  { providerId: "github-copilot", name: "GitHub Copilot", note: "via ccusage" },
  { providerId: "gemini-cli", name: "Gemini CLI / Google AI Pro", note: "via ccusage" },
  { providerId: "minimax", name: "MiniMax" },
  { providerId: "manual", name: "Manual" },
];

export function App() {
  const [page, setPage] = useState<Page>(pageFromPath(window.location.pathname));
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadData() {
    setError(null);
    try {
      const [healthData, providerData, summaryData, recordData] = await Promise.all([
        getHealth(),
        getProviders(),
        getUsageSummary(),
        getUsageRecords({ limit: 100 }),
      ]);
      setHealth(healthData);
      setProviders(providerData);
      setSummary(summaryData);
      setRecords(recordData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load data");
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    function handlePopState() {
      setPage(pageFromPath(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextPage: Page) {
    const target = pages.find((item) => item.id === nextPage);
    if (!target) return;
    window.history.pushState(null, "", target.path);
    setPage(nextPage);
  }

  async function refreshAll() {
    setError(null);
    setNotice(null);
    try {
      const result = await refreshAllProviders();
      const failed = result.results.filter((item) => !item.ok);
      setNotice(
        failed.length > 0
          ? `Refresh Completed With ${failed.length} Provider Error`
          : "Refresh Completed",
      );
      await loadData();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Refresh failed");
    }
  }

  const providerMap = useMemo(
    () => new Map(providers.map((provider) => [provider.providerId, provider])),
    [providers],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Local Usage</p>
          <h1>OpenUsage WebUI</h1>
        </div>
        <nav className="nav-list" aria-label="Primary Navigation">
          {pages.map((item) => (
            <button
              className={item.id === page ? "nav-item active" : "nav-item"}
              key={item.id}
              onClick={() => navigate(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="server-chip">127.0.0.1:6736</div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local Dashboard</p>
            <h2>{pages.find((item) => item.id === page)?.label}</h2>
          </div>
          <button className="primary-button" onClick={refreshAll} type="button">
            Refresh All
          </button>
        </header>

        {error ? <div className="alert error">{error}</div> : null}
        {notice ? <div className="alert success">{notice}</div> : null}

        {page === "dashboard" ? (
          <DashboardPage
            providers={providers}
            providerMap={providerMap}
            summary={summary}
          />
        ) : null}
        {page === "providers" ? (
          <ProvidersPage
            providerMap={providerMap}
            onRefresh={async (providerId) => {
              setError(null);
              setNotice(null);
              try {
                const result = await refreshProvider(providerId);
                const first = result.results[0];
                setNotice(first?.ok ? "Provider Refreshed" : first?.error ?? "Provider Error");
                await loadData();
              } catch (refreshError) {
                setError(refreshError instanceof Error ? refreshError.message : "Refresh failed");
              }
            }}
          />
        ) : null}
        {page === "sessions" ? <SessionsPage records={records} onRecords={setRecords} /> : null}
        {page === "settings" ? (
          <SettingsPage health={health} onCreated={loadData} />
        ) : null}
      </main>
    </div>
  );
}

function DashboardPage({
  providers,
  providerMap,
  summary,
}: {
  providers: ProviderStatus[];
  providerMap: Map<ProviderId, ProviderStatus>;
  summary: UsageSummary | null;
}) {
  const breakdown = summary?.byProvider ?? [];
  return (
    <section className="page-grid">
      <div className="metric-band">
        <Metric label="Today Tokens" value={formatNumber(summary?.today.totalTokens ?? 0)} />
        <Metric label="Today Cost" value={formatMoney(summary?.today.costUsd ?? 0)} />
        <Metric label="Month Tokens" value={formatNumber(summary?.month.totalTokens ?? 0)} />
        <Metric label="Month Cost" value={formatMoney(summary?.month.costUsd ?? 0)} />
      </div>

      <section className="panel">
        <div className="panel-header">
          <h3>Provider Breakdown</h3>
          <span>{providers.length} Providers</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Records</th>
              <th>Tokens</th>
              <th>Estimated Cost</th>
              <th>Last Refresh</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.length === 0 ? (
              <tr>
                <td colSpan={6}>No Usage Records Yet</td>
              </tr>
            ) : (
              breakdown.map((row) => {
                const status = providerMap.get(row.providerId);
                return (
                  <tr key={row.providerId}>
                    <td>{providerLabels[row.providerId]}</td>
                    <td>{row.records}</td>
                    <td>{formatNumber(row.totalTokens)}</td>
                    <td>{formatMoney(row.costUsd)}</td>
                    <td>{formatDate(status?.lastRefreshAt)}</td>
                    <td>{statusLabel(status)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function ProvidersPage({
  providerMap,
  onRefresh,
}: {
  providerMap: Map<ProviderId, ProviderStatus>;
  onRefresh: (providerId: ProviderId) => Promise<void>;
}) {
  return (
    <section className="provider-grid">
      {providerCards.map((provider) => {
        const status = providerMap.get(provider.providerId);
        const refreshable = provider.providerId === "ccusage" || provider.providerId === "manual" || provider.providerId === "minimax";
        return (
          <article className="provider-card" key={provider.providerId}>
            <div>
              <div className="provider-title-row">
                <h3>{provider.name}</h3>
                {provider.note ? <span>{provider.note}</span> : null}
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Detected</dt>
                  <dd>{status?.detected ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt>Enabled</dt>
                  <dd>{status?.enabled === false ? "No" : "Yes"}</dd>
                </div>
                <div>
                  <dt>Last Refresh</dt>
                  <dd>{formatDate(status?.lastRefreshAt)}</dd>
                </div>
                <div>
                  <dt>Last Error</dt>
                  <dd>{status?.lastError ?? "None"}</dd>
                </div>
              </dl>
            </div>
            <button
              className="secondary-button"
              disabled={!refreshable}
              onClick={() => onRefresh(provider.providerId)}
              type="button"
            >
              Refresh
            </button>
          </article>
        );
      })}
    </section>
  );
}

function SessionsPage({
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
            {Object.entries(providerLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
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
              <th>Cost USD</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={9}>No Usage Records Yet</td>
              </tr>
            ) : (
              records.map((record) => (
                <tr key={record.id}>
                  <td>{formatDate(record.startedAt)}</td>
                  <td>{providerLabels[record.providerId]}</td>
                  <td>{record.tool ?? "-"}</td>
                  <td>{record.model ?? "-"}</td>
                  <td>{formatNumber(record.inputTokens ?? 0)}</td>
                  <td>{formatNumber(record.outputTokens ?? 0)}</td>
                  <td>{formatNumber(record.totalTokens ?? 0)}</td>
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

function SettingsPage({
  health,
  onCreated,
}: {
  health: HealthResponse | null;
  onCreated: () => Promise<void>;
}) {
  const [minimax, setMiniMax] = useState({
    plan_type: "",
    monthly_budget_usd: "",
    remaining_quota: "",
    notes: "",
  });
  const [manual, setManual] = useState({
    providerId: "manual" as ProviderId,
    tool: "",
    model: "",
    inputTokens: "",
    outputTokens: "",
    costUsd: "",
    startedAt: toDatetimeLocal(new Date()),
    notes: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProviderSettings("minimax")
      .then((settings) =>
        setMiniMax({
          plan_type: settings.plan_type ?? "",
          monthly_budget_usd: settings.monthly_budget_usd ?? "",
          remaining_quota: settings.remaining_quota ?? "",
          notes: settings.notes ?? "",
        }),
      )
      .catch((settingsError) =>
        setError(settingsError instanceof Error ? settingsError.message : "Settings failed"),
      );
  }, []);

  async function saveMiniMax(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await updateProviderSettings("minimax", minimax);
      setMessage("MiniMax Settings Saved");
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "Settings failed");
    }
  }

  async function saveManual(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await createManualUsage({
        providerId: manual.providerId,
        tool: manual.tool,
        model: manual.model,
        inputTokens: optionalNumber(manual.inputTokens),
        outputTokens: optionalNumber(manual.outputTokens),
        costUsd: optionalNumber(manual.costUsd),
        startedAt: manual.startedAt ? new Date(manual.startedAt).toISOString() : undefined,
        notes: manual.notes,
      });
      setMessage("Manual Usage Saved");
      await onCreated();
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : "Manual usage failed");
    }
  }

  return (
    <section className="settings-grid">
      {error ? <div className="alert error">{error}</div> : null}
      {message ? <div className="alert success">{message}</div> : null}
      <section className="panel">
        <div className="panel-header">
          <h3>Server Settings</h3>
        </div>
        <dl className="detail-list wide">
          <div>
            <dt>Server Bind Host</dt>
            <dd>127.0.0.1</dd>
          </div>
          <div>
            <dt>Port</dt>
            <dd>6736</dd>
          </div>
          <div>
            <dt>Database Path</dt>
            <dd>{health?.databasePath ?? "~/.openusage-webui/openusage.sqlite"}</dd>
          </div>
          <div>
            <dt>Refresh Interval</dt>
            <dd>Manual</dd>
          </div>
          <div>
            <dt>Currency Display</dt>
            <dd>USD</dd>
          </div>
        </dl>
      </section>

      <form className="panel form-panel" onSubmit={saveMiniMax}>
        <div className="panel-header">
          <h3>MiniMax Settings</h3>
        </div>
        <label>
          Plan Type
          <input
            value={minimax.plan_type}
            onChange={(event) => setMiniMax({ ...minimax, plan_type: event.target.value })}
          />
        </label>
        <label>
          Monthly Budget USD
          <input
            inputMode="decimal"
            value={minimax.monthly_budget_usd}
            onChange={(event) =>
              setMiniMax({ ...minimax, monthly_budget_usd: event.target.value })
            }
          />
        </label>
        <label>
          Remaining Quota
          <input
            value={minimax.remaining_quota}
            onChange={(event) => setMiniMax({ ...minimax, remaining_quota: event.target.value })}
          />
        </label>
        <label>
          Notes
          <textarea
            rows={4}
            value={minimax.notes}
            onChange={(event) => setMiniMax({ ...minimax, notes: event.target.value })}
          />
        </label>
        <button className="primary-button" type="submit">
          Save MiniMax
        </button>
      </form>

      <form className="panel form-panel" onSubmit={saveManual}>
        <div className="panel-header">
          <h3>Manual Entry</h3>
        </div>
        <label>
          Provider
          <select
            value={manual.providerId}
            onChange={(event) =>
              setManual({ ...manual, providerId: event.target.value as ProviderId })
            }
          >
            <option value="manual">Manual</option>
            <option value="minimax">MiniMax</option>
          </select>
        </label>
        <label>
          Tool
          <input
            value={manual.tool}
            onChange={(event) => setManual({ ...manual, tool: event.target.value })}
          />
        </label>
        <label>
          Model
          <input
            value={manual.model}
            onChange={(event) => setManual({ ...manual, model: event.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            Input Tokens
            <input
              min="0"
              type="number"
              value={manual.inputTokens}
              onChange={(event) => setManual({ ...manual, inputTokens: event.target.value })}
            />
          </label>
          <label>
            Output Tokens
            <input
              min="0"
              type="number"
              value={manual.outputTokens}
              onChange={(event) => setManual({ ...manual, outputTokens: event.target.value })}
            />
          </label>
        </div>
        <label>
          Cost USD
          <input
            inputMode="decimal"
            value={manual.costUsd}
            onChange={(event) => setManual({ ...manual, costUsd: event.target.value })}
          />
        </label>
        <label>
          Date/Time
          <input
            type="datetime-local"
            value={manual.startedAt}
            onChange={(event) => setManual({ ...manual, startedAt: event.target.value })}
          />
        </label>
        <label>
          Notes
          <textarea
            rows={4}
            value={manual.notes}
            onChange={(event) => setManual({ ...manual, notes: event.target.value })}
          />
        </label>
        <button className="primary-button" type="submit">
          Submit Manual Entry
        </button>
      </form>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function pageFromPath(pathname: string): Page {
  const match = pages.find((page) => page.path === pathname);
  return match?.id ?? "dashboard";
}

function statusLabel(status?: ProviderStatus): string {
  if (!status) return "Not Configured";
  if (status.lastError) return "Error";
  return status.detected ? "Ready" : "Not Detected";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

function formatDate(value?: string): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function toDatetimeLocal(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function optionalNumber(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
