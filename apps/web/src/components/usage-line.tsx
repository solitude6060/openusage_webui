import { resetCreditExpiryView, plainBadgeText } from "../provider-ui";
import { formatDate, formatNumber, formatRelativeTime, isPlainObject } from "../lib/format";

export function UsageLine({ line }: { line: Record<string, unknown> }) {
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
    // live countdown (kept fresh by the dashboard's minute tick). resetCreditExpiryView
    // validates the timestamp first so an invalid value never reaches Intl (which throws),
    // and returns the effective tone class so a lapsed credit looks expired, not urgent.
    const view = expiresAt ? resetCreditExpiryView(expiresAt, tone, Date.now()) : null;
    if (expiresAt && view && view.valid) {
      return (
        <div className="usage-credit-expiry">
          <div className="usage-credit-expiry-header">
            <span className="usage-credit-expiry-label">{String(line.label)}</span>
            <span className={view.toneClass}>{view.expired ? "Expired" : formatRelativeTime(expiresAt)}</span>
          </div>
          <div className="usage-credit-expiry-date">Expires {formatDate(expiresAt)}</div>
        </div>
      );
    }
    // Plain badge (no expiry): render the chip only when there's text, so a fieldless
    // badge degrades to just its label instead of an empty pill. Urgency tone only applies
    // to the stacked expiry layout above, so the plain chip stays a neutral value-chip.
    const badgeText = plainBadgeText(line.text);
    return (
      <div className="usage-text-line">
        <span>{String(line.label)}</span>
        {badgeText !== null ? <span className="value-chip">{badgeText}</span> : null}
      </div>
    );
  }

  return null;
}
