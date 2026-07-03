import { useCallback, useEffect, useMemo, useState } from "react";
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
  arrayMove,
} from "@dnd-kit/sortable";
import type {
  ProviderId,
  ProviderStatus,
  UsageRecord,
} from "../../../../packages/core/src/types";
import { providerLabel } from "../provider-ui";
import { formatDate, isPlainObject, linesFromRaw } from "../lib/format";
import { UsageLine } from "../components/usage-line";
import { SortableCard } from "../components/sortable-card";

const CARD_ORDER_KEY = "openusage-dashboard-card-order";
const SUMMARY_PROGRESS_LABELS = new Set(["Session", "Weekly", "Usage", "Fable", "Fable Weekly"]);
const SUMMARY_TEXT_LABELS = new Set(["Today"]);
const SUMMARY_BADGE_LABELS = new Set(["Status"]);

type DashboardLine = Record<string, unknown>;
type ProviderData = {
  providerId: ProviderId;
  plan?: string;
  lines: DashboardLine[];
  status?: ProviderStatus;
};

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

function lineLabel(line: DashboardLine): string {
  return typeof line.label === "string" ? line.label : String(line.label ?? "");
}

function isSummaryLine(line: DashboardLine): boolean {
  const label = lineLabel(line);
  if (line.type === "progress") return SUMMARY_PROGRESS_LABELS.has(label);
  if (line.type === "badge") return SUMMARY_BADGE_LABELS.has(label);
  if (line.type !== "text") return false;
  return SUMMARY_TEXT_LABELS.has(label);
}

export function splitDashboardLines(lines: DashboardLine[]): {
  summaryLines: DashboardLine[];
  detailLines: DashboardLine[];
} {
  if (lines.length <= 3) {
    return { summaryLines: lines, detailLines: [] };
  }

  const summaryLines: DashboardLine[] = [];
  const detailLines: DashboardLine[] = [];

  for (const line of lines) {
    if (isSummaryLine(line)) {
      summaryLines.push(line);
    } else {
      detailLines.push(line);
    }
  }

  if (summaryLines.length === 0) {
    const firstUsefulIndex = detailLines.findIndex((line) => line.type === "progress");
    if (firstUsefulIndex >= 0) {
      summaryLines.push(detailLines[firstUsefulIndex]);
      detailLines.splice(firstUsefulIndex, 1);
    }
  }

  return { summaryLines, detailLines };
}

function ProviderUsageCard({ providerId, plan, lines, status }: ProviderData) {
  const [expanded, setExpanded] = useState(false);
  const { summaryLines, detailLines } = useMemo(() => splitDashboardLines(lines), [lines]);
  const detailId = `${providerId}-details`;
  const isCompact = detailLines.length === 0 && summaryLines.length <= 2;

  return (
    <SortableCard key={providerId} id={providerId} className={isCompact ? "compact" : ""}>
      <div className="provider-title-row">
        <h3>{providerLabel(providerId)}</h3>
        {plan ? <span className="value-chip">{plan}</span> : null}
      </div>
      <div className="usage-card-body">
        <div className="usage-summary-column">
          <div className="usage-lines">
            {summaryLines.map((line, i) => (
              <UsageLine key={`${String(line.label)}-${i}`} line={line} />
            ))}
          </div>
          {detailLines.length > 0 ? (
            <button
              type="button"
              className="details-toggle"
              aria-expanded={expanded}
              aria-controls={detailId}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((value) => !value);
              }}
            >
              {expanded ? "Hide Details" : `Show Details (${detailLines.length})`}
            </button>
          ) : null}
        </div>
        {detailLines.length > 0 ? (
          <div id={detailId} className="usage-detail-lines" hidden={!expanded}>
            {detailLines.map((line, i) => (
              <UsageLine key={`${String(line.label)}-${i}`} line={line} />
            ))}
          </div>
        ) : null}
      </div>
      {status?.lastRefreshAt ? (
        <div className="usage-card-footer">
          Updated {formatDate(status.lastRefreshAt)}
        </div>
      ) : null}
    </SortableCard>
  );
}

export function DashboardPage({
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
    const map = new Map<ProviderId, ProviderData>();
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
      .filter(Boolean) as ProviderData[];
  }, [cardOrder, providerDataMap]);

  return (
    <section className="page-grid">
      {sortedProviders.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={cardOrder} strategy={rectSortingStrategy}>
            <div className="provider-grid dashboard-provider-grid">
              {sortedProviders.map((provider) => (
                <ProviderUsageCard key={provider.providerId} {...provider} />
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
