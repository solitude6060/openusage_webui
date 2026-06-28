import { useMemo } from "react";
import type {
  ProviderId,
  ProviderStatus,
} from "../../../../packages/core/src/types";
import { getProviderStatusLabel, isProviderRefreshable, providerCards } from "../provider-ui";
import { formatDate } from "../lib/format";
import { StatusPill } from "../components/status-pill";

export function ProvidersPage({
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
