import { FormEvent, useState } from "react";
import type { ProviderId } from "../../../../packages/core/src/types";
import { createManualUsage, type HealthResponse } from "../lib/api";
import { toDatetimeLocal, optionalNumber } from "../lib/format";
import { StatusPill } from "../components/status-pill";

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
