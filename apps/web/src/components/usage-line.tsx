import { useMemo, useState } from "react";
import { resetCreditExpiryView, plainBadgeText } from "../provider-ui";
import { formatDate, formatNumber, formatRelativeTime, isPlainObject } from "../lib/format";

type ChartPoint = {
  label: string;
  value: number;
  valueLabel?: string;
};

function normalizeChartPoints(raw: unknown): ChartPoint[] {
  if (!Array.isArray(raw)) return [];
  const points: ChartPoint[] = [];
  for (const point of raw) {
    if (!isPlainObject(point)) continue;
    const value = Number(point.value);
    if (!Number.isFinite(value) || value < 0) continue;
    points.push({
      label: typeof point.label === "string" ? point.label : "",
      value,
      valueLabel: typeof point.valueLabel === "string" ? point.valueLabel : undefined,
    });
  }
  return points;
}

function UsageBarChart({
  label,
  points,
  note,
  color,
}: {
  label: string;
  points: ChartPoint[];
  note?: string;
  color?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const maxValue = Math.max(1, ...points.map((point) => point.value));
  const active = activeIndex != null ? points[activeIndex] : null;
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), points[0]);
  const readout = active
    ? `${active.label} · ${active.valueLabel ?? formatNumber(active.value)}`
    : `peak ${peak.label} · ${peak.valueLabel ?? formatNumber(peak.value)}`;

  return (
    <div className="usage-barchart">
      <div className="usage-barchart-header">
        <span className="usage-barchart-label">{label}</span>
        <span className="usage-barchart-readout">{readout}</span>
      </div>
      <div className="usage-barchart-bars" aria-label={label}>
        {points.map((point, index) => {
          const ratio = point.value / maxValue;
          const height =
            point.value > 0 ? Math.max(8, Math.round(ratio * 100)) : 4;
          return (
            <button
              key={`${point.label}-${index}`}
              type="button"
              className={`usage-barchart-bar${activeIndex != null && activeIndex !== index ? " dimmed" : ""}`}
              style={{ height: `${height}%`, backgroundColor: color || undefined }}
              title={`${point.label}: ${point.valueLabel ?? formatNumber(point.value)}`}
              aria-label={`${point.label}: ${point.valueLabel ?? formatNumber(point.value)}`}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              onBlur={() => setActiveIndex(null)}
            />
          );
        })}
      </div>
      <div className="usage-barchart-axis">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
      {note ? <div className="usage-barchart-note">{note}</div> : null}
    </div>
  );
}

export function UsageLine({ line }: { line: Record<string, unknown> }) {
  const chartPoints = useMemo(
    () => (line.type === "barChart" ? normalizeChartPoints(line.points) : []),
    [line],
  );

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
    const label = String(line.label);
    return (
      <div className="usage-text-line">
        <span>{label}</span>
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

  if (line.type === "barChart") {
    if (chartPoints.length === 0) return null;
    return (
      <UsageBarChart
        label={String(line.label ?? "Usage Trend")}
        points={chartPoints}
        note={typeof line.note === "string" ? line.note : undefined}
        color={typeof line.color === "string" ? line.color : undefined}
      />
    );
  }

  return null;
}
