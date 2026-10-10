import type { FormEvent } from "react";
import type { ProviderId } from "../../../../packages/core/src/types";

export interface ManualEntryDraft {
  providerId: ProviderId;
  tool: string;
  model: string;
  inputTokens: string;
  outputTokens: string;
  costUsd: string;
  startedAt: string;
  notes: string;
}

export function ManualEntryForm({
  manual,
  onChange,
  onSubmit,
}: {
  manual: ManualEntryDraft;
  onChange: (next: ManualEntryDraft) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="panel form-panel" onSubmit={onSubmit}>
      <div className="panel-header">
        <h3>Manual Entry</h3>
      </div>
      <label>
        Provider
        <select
          value={manual.providerId}
          onChange={(event) =>
            onChange({ ...manual, providerId: event.target.value as ProviderId })
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
          onChange={(event) => onChange({ ...manual, tool: event.target.value })}
        />
      </label>
      <label>
        Model
        <input
          value={manual.model}
          onChange={(event) => onChange({ ...manual, model: event.target.value })}
        />
      </label>
      <div className="form-row">
        <label>
          Input Tokens
          <input
            min="0"
            type="number"
            value={manual.inputTokens}
            onChange={(event) => onChange({ ...manual, inputTokens: event.target.value })}
          />
        </label>
        <label>
          Output Tokens
          <input
            min="0"
            type="number"
            value={manual.outputTokens}
            onChange={(event) => onChange({ ...manual, outputTokens: event.target.value })}
          />
        </label>
      </div>
      <label>
        Cost USD
        <input
          inputMode="decimal"
          value={manual.costUsd}
          onChange={(event) => onChange({ ...manual, costUsd: event.target.value })}
        />
      </label>
      <label>
        Date/Time
        <input
          type="datetime-local"
          value={manual.startedAt}
          onChange={(event) => onChange({ ...manual, startedAt: event.target.value })}
        />
      </label>
      <label>
        Notes
        <textarea
          rows={4}
          value={manual.notes}
          onChange={(event) => onChange({ ...manual, notes: event.target.value })}
        />
      </label>
      <button className="primary-button" type="submit">
        Submit Manual Entry
      </button>
    </form>
  );
}
