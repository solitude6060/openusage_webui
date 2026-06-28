import { useEffect, useMemo, useState } from "react";
import type {
  ProviderStatus,
  UsageRecord,
} from "../../../packages/core/src/types";
import {
  getHealth,
  getProviders,
  getUsageRecords,
  refreshAllProviders,
  refreshProvider,
  setProviderEnabled,
  type HealthResponse,
} from "./lib/api";
import { DashboardPage } from "./pages/dashboard-page";
import { ProvidersPage } from "./pages/providers-page";
import { SessionsPage } from "./pages/sessions-page";
import { SettingsPage } from "./pages/settings-page";

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
  const [, setNowTick] = useState(0);

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

  // Re-render once a minute so live countdowns (reset-credit expiry, window resets) stay
  // fresh and flip to "Expired" on time, without waiting for the next data poll.
  useEffect(() => {
    const id = setInterval(() => setNowTick((tick) => tick + 1), 60_000);
    return () => clearInterval(id);
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

        {/* Float global alerts in a fixed region so showing/hiding them never reflows
            the page below. aria-live lets screen readers announce them. */}
        <div className="app-toasts" aria-live="polite">
          {/* role="alert" on the error makes screen readers announce failures
              immediately (assertive); the polite container handles success notices. */}
          {error ? <div className="alert error" role="alert">{error}</div> : null}
          {notice ? <div className="alert success">{notice}</div> : null}
        </div>

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

function pageFromPath(pathname: string): Page {
  if (pathname === "/") {
    window.history.replaceState(null, "", "/dashboard");
    return "dashboard";
  }
  const match = pages.find((page) => page.path === pathname);
  return match?.id ?? "dashboard";
}
