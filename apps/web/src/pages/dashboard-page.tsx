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
