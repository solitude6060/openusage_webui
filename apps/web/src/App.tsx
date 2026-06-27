import { useCallback, FormEvent, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  ProviderId,
  ProviderStatus,
  UsageRecord,
} from "../../../packages/core/src/types";
import {
  createManualUsage,
  getHealth,
  getProviders,
  getUsageRecords,
  refreshAllProviders,
  refreshProvider,
  setProviderEnabled,
  type HealthResponse,
} from "./lib/api";
import { badgeToneClassName, getProviderStatusLabel, isProviderRefreshable, providerCards, providerLabel } from "./provider-ui";

type Page = "dashboard" | "providers" | "sessions" | "settings";

const pages: Array<{ id: Page; label: string; path: string }> = [
  { id: "dashboard", label: "Dashboard", path: "/dashboard" },
  { id: "providers", label: "Providers", path: "/providers" },
  { id: "sessions", label: "Sessions", path: "/sessions" },
  { id: "settings", label: "Settings", path: "/settings" },
];

export function App() {
  const [page, setPage] = useState<Page>(pageFromPath(window.location.pathname));
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setError(null);
    try {
      const [healthData, providerData, recordData] = await Promise.all([
        getHealth(),
        getProviders(),
        getUsageRecords({ limit: 100 }),
      ]);
      setHealth(healthData);
      setProviders(providerData);
      setRecords(recordData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

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
        <div className="server-chip">{health ? `${health.host}:${health.port}` : "127.0.0.1:6736"}</div>
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

        {loading ? (
          <div className="loading-indicator">Loading...</div>
        ) : null}

        {!loading && page === "dashboard" ? (
          <DashboardPage
            providers={providers}
            providerMap={providerMap}
            records={records}
          />
        ) : null}
        {!loading && page === "providers" ? (
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
            onToggle={async (providerId, enabled) => {
              setError(null);
              try {
                await setProviderEnabled(providerId, enabled);
                await loadData();
              } catch (toggleError) {
                setError(toggleError instanceof Error ? toggleError.message : "Toggle failed");
              }
            }}
          />
        ) : null}
        {!loading && page === "sessions" ? <SessionsPage records={records} onRecords={setRecords} /> : null}
        {!loading && page === "settings" ? (
          <SettingsPage health={health} onCreated={loadData} />
        ) : null}
      </main>
    </div>
  );
}

const CARD_ORDER_KEY = "openusage-dashboard-card-order";

function loadCardOrder(): ProviderId[] {
  try {
    const raw = localStorage.getItem(CARD_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCardOrder(order: ProviderId[]): void {
  try {
    localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(order));
  } catch { /* quota exceeded — ignore */ }
}

function DashboardPage({
  providers,
  providerMap,
  records,
}: {
  providers: ProviderStatus[];
  providerMap: Map<ProviderId, ProviderStatus>;
  records: UsageRecord[];
}) {
  const latestByProvider = useMemo(() => {
    const map = new Map<ProviderId, UsageRecord>();
    for (const record of records) {
      if (map.has(record.providerId)) continue;
      if (!isPlainObject(record.raw)) continue;
      const raw = record.raw as Record<string, unknown>;
      if (Array.isArray(raw.lines) || isPlainObject(raw.quota)) {
        map.set(record.providerId, record);
      }
    }
    return map;
  }, [records]);

  const providerDataMap = useMemo(() => {
    const map = new Map<ProviderId, { providerId: ProviderId; plan?: string; lines: Array<Record<string, unknown>>; status?: ProviderStatus }>();
    for (const [providerId, record] of latestByProvider.entries()) {
      const raw = record.raw as Record<string, unknown>;
      const lines = linesFromRaw(raw);
      const plan = typeof raw.plan === "string" ? raw.plan : typeof raw.planName === "string" ? raw.planName : undefined;
      map.set(providerId, { providerId, plan, lines, status: providerMap.get(providerId) });
    }
    return map;
  }, [latestByProvider, providerMap]);

  const [cardOrder, setCardOrder] = useState<ProviderId[]>(() => {
    const saved = loadCardOrder();
    const activeIds = [...providerDataMap.keys()];
    if (saved.length > 0) {
      const activeSet = new Set(activeIds);
      const ordered = saved.filter((id) => activeSet.has(id));
      const missing = activeIds.filter((id) => !saved.includes(id));
      return [...ordered, ...missing.sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)))];
    }
    return activeIds.sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)));
  });

  useEffect(() => {
    const activeIds = [...providerDataMap.keys()];
    const activeSet = new Set(activeIds);
    setCardOrder((prev) => {
      const ordered = prev.filter((id) => activeSet.has(id));
      const missing = activeIds.filter((id) => !prev.includes(id));
      if (missing.length === 0 && ordered.length === prev.length) return prev;
      return [...ordered, ...missing.sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)))];
    });
  }, [providerDataMap]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setCardOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as ProviderId);
      const newIndex = prev.indexOf(over.id as ProviderId);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      saveCardOrder(next);
      return next;
    });
  }, []);

  const sortedProviders = useMemo(() => {
    return cardOrder
      .map((id) => providerDataMap.get(id))
      .filter(Boolean) as Array<{ providerId: ProviderId; plan?: string; lines: Array<Record<string, unknown>>; status?: ProviderStatus }>;
  }, [cardOrder, providerDataMap]);

  return (
    <section className="page-grid">
      {sortedProviders.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={cardOrder} strategy={rectSortingStrategy}>
            <div className="provider-grid">
              {sortedProviders.map(({ providerId, plan, lines, status }) => (
                <SortableCard key={providerId} id={providerId}>
                  <div className="provider-title-row">
                    <h3>{providerLabel(providerId)}</h3>
                    {plan ? <span className="value-chip">{plan}</span> : null}
                  </div>
                  <div className="usage-lines">
                    {lines.map((line, i) => (
                      <UsageLine key={`${String(line.label)}-${i}`} line={line} />
                    ))}
                  </div>
                  {status?.lastRefreshAt ? (
                    <div className="usage-card-footer">
                      Updated {formatDate(status.lastRefreshAt)}
                    </div>
                  ) : null}
                </SortableCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <h3>Provider Breakdown</h3>
            <span>{providers.length} Providers</span>
          </div>
          <div style={{ padding: "24px 18px", color: "var(--muted)", fontSize: "0.875rem" }}>
            No usage data yet. Click Refresh All to fetch provider data.
          </div>
        </section>
      )}
    </section>
  );
}

function SortableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: "grab",
  };
  return (
    <article ref={setNodeRef} style={style} className="provider-card usage-card" {...attributes} {...listeners}>
      {children}
    </article>
  );
}

function linesFromRaw(raw: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(raw.lines)) return raw.lines as Array<Record<string, unknown>>;
  if (isPlainObject(raw.quota)) {
    const q = raw.quota as Record<string, unknown>;
    const lines: Array<Record<string, unknown>> = [];
    const format = q.format === "count"
      ? { kind: "count", suffix: typeof q.suffix === "string" ? q.suffix : "prompts" }
      : { kind: "percent" };
    lines.push({
      type: "progress",
      label: "Usage",
      used: Number(q.used) || 0,
      limit: Number(q.limit) || 100,
      format,
      resetsAt: typeof q.resetsAt === "string" ? q.resetsAt : undefined,
    });
    if (typeof raw.planName === "string") {
      lines.push({ type: "text", label: "Plan", value: raw.planName });
    }
    if (typeof raw.region === "string") {
      lines.push({ type: "text", label: "Region", value: raw.region });
    }
    return lines;
  }
  return [];
}

function UsageLine({ line }: { line: Record<string, unknown> }) {
  if (line.type === "progress") {
    const used = Number(line.used) || 0;
    const limit = Number(line.limit) || 100;
    const percent = Math.min(100, Math.round((used / limit) * 100));
    const remaining = Math.max(0, limit - used);
    const format = line.format as Record<string, unknown> | undefined;
    const formatKind = isPlainObject(format) ? String(format.kind ?? "percent") : "percent";
    const suffix = isPlainObject(format) && typeof format.suffix === "string" ? format.suffix : "";
    const resetsAt = typeof line.resetsAt === "string" ? line.resetsAt : undefined;

    let usageText: string;
    if (formatKind === "percent") {
      const usedDisplay = parseFloat(used.toFixed(1));
      const remainingDisplay = parseFloat(remaining.toFixed(1));
      usageText = `${usedDisplay}% used · ${remainingDisplay}% left`;
    } else if (formatKind === "dollars") {
      usageText = `$${used.toFixed(2)} / $${limit.toFixed(2)}`;
    } else {
      usageText = `${formatNumber(used)} / ${formatNumber(limit)} ${suffix}`;
    }

    return (
      <div className="usage-progress">
        <div className="usage-progress-header">
          <span className="usage-progress-label">{String(line.label)}</span>
          <span className="usage-progress-value">{usageText}</span>
        </div>
        <div className="usage-progress-bar">
          <div
            className={`usage-progress-fill${percent >= 90 ? " warning" : ""}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {resetsAt ? (
          <div className="usage-progress-reset">
            Resets {formatRelativeTime(resetsAt)}
          </div>
        ) : null}
      </div>
    );
  }

  if (line.type === "text") {
    return (
      <div className="usage-text-line">
        <span>{String(line.label)}</span>
        <span style={typeof line.color === "string" ? { color: line.color } : undefined}>
          {String(line.value ?? "")}
        </span>
      </div>
    );
  }

  if (line.type === "badge") {
    const tone = typeof line.tone === "string" ? line.tone : undefined;
    const expiresAt = typeof line.expiresAt === "string" ? line.expiresAt : undefined;
    // Reset-credit badges carry an exact expiry timestamp: show the precise date plus a
    // live countdown that stays fresh between refreshes (computed here, not baked).
    if (expiresAt) {
      const expired = tone === "expired" || new Date(expiresAt).getTime() <= Date.now();
      return (
        <div className="usage-credit-expiry">
          <div className="usage-credit-expiry-header">
            <span className="usage-credit-expiry-label">{String(line.label)}</span>
            <span className={badgeToneClassName(tone)}>{expired ? "Expired" : formatRelativeTime(expiresAt)}</span>
          </div>
          <div className="usage-credit-expiry-date">Expires {formatDate(expiresAt)}</div>
        </div>
      );
    }
    return (
      <div className="usage-text-line">
        <span>{String(line.label)}</span>
        <span className={badgeToneClassName(tone)}>{String(line.text ?? "")}</span>
      </div>
    );
  }

  return null;
}

function formatRelativeTime(isoString: string): string {
  const target = new Date(isoString).getTime();
  const now = Date.now();
  const diffMs = target - now;
  if (diffMs <= 0) return "now";
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `in ${days}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `in ${minutes}m`;
  return "in <1m";
}

function ProvidersPage({
  providerMap,
  onRefresh,
  onToggle,
}: {
  providerMap: Map<ProviderId, ProviderStatus>;
  onRefresh: (providerId: ProviderId) => Promise<void>;
  onToggle: (providerId: ProviderId, enabled: boolean) => Promise<void>;
}) {
  const sorted = useMemo(() =>
    [...providerCards].sort((a, b) => {
      const aEnabled = providerMap.get(a.providerId)?.enabled !== false;
      const bEnabled = providerMap.get(b.providerId)?.enabled !== false;
      if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
      return 0;
    }),
    [providerMap],
  );

  return (
    <section className="provider-grid">
      {sorted.map((provider) => {
        const status = providerMap.get(provider.providerId);
        const isEnabled = status?.enabled !== false;
        const refreshable = isProviderRefreshable(provider.providerId);
        return (
          <article
            className={`provider-card${isEnabled ? "" : " disabled-card"}`}
            key={provider.providerId}
          >
            <div>
              <div className="provider-title-row">
                <h3>{provider.name}</h3>
                {provider.note ? <span>{provider.note}</span> : null}
              </div>
              <dl className="detail-list">
                <div>
                  <dt>{getProviderStatusLabel(provider)}</dt>
                  <dd>
                    <StatusPill tone={status?.detected ? "success" : "muted"}>
                      {status?.detected ? "Yes" : "No"}
                    </StatusPill>
                  </dd>
                </div>
                <div>
                  <dt>Enabled</dt>
                  <dd>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => onToggle(provider.providerId, !isEnabled)}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </dd>
                </div>
                <div>
                  <dt>Last Refresh</dt>
                  <dd>{formatDate(status?.lastRefreshAt)}</dd>
                </div>
                <div>
                  <dt>Last Error</dt>
                  <dd className={status?.lastError ? "error-text" : undefined}>
                    {status?.lastError ?? "None"}
                  </dd>
                </div>
              </dl>
            </div>
            <button
              className="secondary-button"
              disabled={!refreshable || !isEnabled}
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

function SettingsPage({
  health,
  onCreated,
}: {
  health: HealthResponse | null;
  onCreated: () => Promise<void>;
}) {
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
            <dd>{health?.host ?? "127.0.0.1"}</dd>
          </div>
          <div>
            <dt>Port</dt>
            <dd>{health?.port ?? 6736}</dd>
          </div>
          <div>
            <dt>Database Path</dt>
            <dd className="mono-value">
              {health?.databasePath ?? "~/.openusage-webui/openusage.sqlite"}
            </dd>
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

      <section className="panel">
        <div className="panel-header">
          <h3>MiniMax Settings</h3>
        </div>
        <dl className="detail-list wide">
          <div>
            <dt>Tracking Method</dt>
            <dd>
              <span className="value-chip">Token Plan Remains API</span>
            </dd>
          </div>
          <div>
            <dt>API Key Source</dt>
            <dd>
              <span className="value-chip">Environment Variables</span>
            </dd>
          </div>
          <div>
            <dt>Accepted Variables</dt>
            <dd className="chip-list">
              <span className="value-chip">MINIMAX_API_KEY</span>
              <span className="value-chip">MINIMAX_API_TOKEN</span>
              <span className="value-chip">MINIMAX_CN_API_KEY</span>
            </dd>
          </div>
          <div>
            <dt>Stored API Key</dt>
            <dd>
              <StatusPill tone="muted">No</StatusPill>
            </dd>
          </div>
        </dl>
      </section>

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

function StatusPill({
  children,
  tone,
}: {
  children: string;
  tone: "success" | "muted";
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function pageFromPath(pathname: string): Page {
  if (pathname === "/") {
    window.history.replaceState(null, "", "/dashboard");
    return "dashboard";
  }
  const match = pages.find((page) => page.path === pathname);
  return match?.id ?? "dashboard";
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

function formatQuota(record: UsageRecord): string {
  if (!isPlainObject(record.raw) || !isPlainObject(record.raw.quota)) {
    return "-";
  }
  const quota = record.raw.quota;
  const used = numberFromUnknown(quota.used);
  const limit = numberFromUnknown(quota.limit);
  if (used === undefined || limit === undefined) {
    return "-";
  }
  const remaining = numberFromUnknown(quota.remaining);
  const suffix = typeof quota.suffix === "string" ? ` ${quota.suffix}` : "";
  const reset = typeof quota.resetsAt === "string" ? ` · Resets ${formatDate(quota.resetsAt)}` : "";
  const remainingText = remaining === undefined ? "" : ` · ${formatNumber(remaining)} Left`;
  return `${formatNumber(used)} / ${formatNumber(limit)}${suffix}${remainingText}${reset}`;
}

function formatDate(value?: string): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function numberFromUnknown(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
