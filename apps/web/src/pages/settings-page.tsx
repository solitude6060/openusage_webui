import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  MultiAccountProviderCapability,
  MultiAccountProviderId,
  ProviderAccount,
  ProviderId,
} from "../../../../packages/core/src/types";
import {
  createManualUsage,
  createProviderAccount,
  deleteProviderAccount,
  detectProviderAccounts,
  listProviderAccountCapabilities,
  listProviderAccounts,
  updateProviderAccount,
  type AccountHomeCandidate,
  type HealthResponse,
} from "../lib/api";
import { toDatetimeLocal, optionalNumber } from "../lib/format";
import { StatusPill } from "../components/status-pill";

export const WEB_AUTO_REFRESH_LABEL = "Every 20 Minutes";

export function SettingsPage({
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
  const [capabilities, setCapabilities] = useState<MultiAccountProviderCapability[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<MultiAccountProviderId>("codex");
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [candidates, setCandidates] = useState<AccountHomeCandidate[]>([]);
  const [draft, setDraft] = useState({ label: "", homePath: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedCapability = useMemo(
    () => capabilities.find((item) => item.providerId === selectedProviderId) ?? null,
    [capabilities, selectedProviderId],
  );

  const visibleAccounts = useMemo(
    () => accounts.filter((account) => account.providerId === selectedProviderId),
    [accounts, selectedProviderId],
  );

  async function reloadAccounts(providerId = selectedProviderId) {
    setAccounts(await listProviderAccounts(providerId));
  }

  useEffect(() => {
    void (async () => {
      try {
        const caps = await listProviderAccountCapabilities();
        setCapabilities(caps);
        if (caps.length > 0 && !caps.some((item) => item.providerId === selectedProviderId)) {
          setSelectedProviderId(caps[0].providerId);
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load provider account capabilities",
        );
      }
    })();
  }, []);

  useEffect(() => {
    setCandidates([]);
    void reloadAccounts(selectedProviderId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to load provider accounts");
    });
  }, [selectedProviderId]);

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

  async function runDetect() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await detectProviderAccounts(selectedProviderId);
      setCandidates(result.candidates);
      setMessage(
        result.candidates.length > 0
          ? `Found ${result.candidates.length} Account Home${result.candidates.length === 1 ? "" : "s"}`
          : "No Account Homes With Auth Found",
      );
    } catch (detectError) {
      setError(detectError instanceof Error ? detectError.message : "Detect failed");
    } finally {
      setBusy(false);
    }
  }

  async function addAccount(label: string, homePath: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await createProviderAccount({
        providerId: selectedProviderId,
        label,
        homePath,
      });
      setDraft({ label: "", homePath: "" });
      setCandidates((prev) => prev.filter((candidate) => candidate.homePath !== homePath));
      await reloadAccounts();
      await onCreated();
      setMessage("Provider Account Added");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Failed to add provider account");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    await addAccount(draft.label, draft.homePath);
  }

  async function toggleAccount(account: ProviderAccount) {
    setBusy(true);
    setError(null);
    try {
      await updateProviderAccount(account.id, { enabled: !account.enabled });
      await reloadAccounts();
      await onCreated();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update account");
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteProviderAccount(id);
      await reloadAccounts();
      await onCreated();
      setMessage("Provider Account Removed");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to remove account");
    } finally {
      setBusy(false);
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
            <dd>{WEB_AUTO_REFRESH_LABEL}</dd>
          </div>
          <div>
            <dt>Currency Display</dt>
            <dd>USD</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Provider Accounts</h3>
          <button className="secondary-button" disabled={busy} onClick={() => void runDetect()} type="button">
            Detect Homes
          </button>
        </div>
        <p className="settings-help">
          Choose a provider, detect signed-in homes, and track more than one account at once. Each
          enabled account becomes its own dashboard card.
        </p>
        <label>
          Provider
          <select
            value={selectedProviderId}
            onChange={(event) =>
              setSelectedProviderId(event.target.value as MultiAccountProviderId)
            }
          >
            {(capabilities.length > 0
              ? capabilities
              : [
                  { providerId: "codex" as const, name: "Codex" },
                  { providerId: "claude-code" as const, name: "Claude Code" },
                  { providerId: "cursor" as const, name: "Cursor" },
                  { providerId: "antigravity" as const, name: "Antigravity" },
                ]
            ).map((capability) => (
              <option key={capability.providerId} value={capability.providerId}>
                {capability.name}
              </option>
            ))}
          </select>
        </label>
        {selectedCapability ? (
          <p className="settings-help muted">
            Homes use {selectedCapability.homeEnvVar} ({selectedCapability.homeLabel}).
          </p>
        ) : null}

        {visibleAccounts.length === 0 ? (
          <p className="settings-help muted">
            No custom accounts yet for this provider. OpenUsage keeps the single default card until
            you add one.
          </p>
        ) : (
          <ul className="settings-list">
            {visibleAccounts.map((account) => (
              <li key={account.id}>
                <div>
                  <strong>{account.label}</strong>
                  <div className="mono-value">{account.homePath}</div>
                  <div className="chip-list">
                    <span className="value-chip">{account.id}</span>
                    <StatusPill tone={account.enabled ? "success" : "muted"}>
                      {account.enabled ? "Enabled" : "Disabled"}
                    </StatusPill>
                  </div>
                </div>
                <div className="button-row">
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void toggleAccount(account)}
                    type="button"
                  >
                    {account.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void removeAccount(account.id)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {candidates.length > 0 ? (
          <div className="settings-subsection">
            <h4>Detected Homes</h4>
            <ul className="settings-list">
              {candidates.map((candidate) => {
                const alreadyAdded = visibleAccounts.some(
                  (account) => account.homePath === candidate.homePath,
                );
                return (
                  <li key={candidate.homePath}>
                    <div>
                      <strong>{candidate.label}</strong>
                      <div className="mono-value">{candidate.homePath}</div>
                    </div>
                    <button
                      className="primary-button"
                      disabled={busy || alreadyAdded}
                      onClick={() => void addAccount(candidate.label, candidate.homePath)}
                      type="button"
                    >
                      {alreadyAdded ? "Added" : "Add"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <form className="form-panel nested-form" onSubmit={(event) => void saveDraft(event)}>
          <h4>Add Manually</h4>
          <label>
            Label
            <input
              placeholder={
                selectedProviderId === "claude-code" ? "Claude · Work" : "Codex · Family"
              }
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              required
            />
          </label>
          <label>
            Home Path
            <input
              placeholder={
                selectedProviderId === "claude-code" ? "~/.claude-work" : "~/.codex-family"
              }
              value={draft.homePath}
              onChange={(event) => setDraft({ ...draft, homePath: event.target.value })}
              required
            />
          </label>
          <button className="primary-button" disabled={busy} type="submit">
            Add Provider Account
          </button>
        </form>
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
