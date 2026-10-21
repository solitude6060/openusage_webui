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
const SUMMARY_PROGRESS_LABELS = new Set([
  "Session",
  "Weekly",
  "Usage",
  "Fable",
  "Fable Weekly",
  "Argon Weekly",
  "Claude",
  "Claude Weekly",
  "Credits",
  "Total usage",
  "Auto usage",
  "API usage",
  "Requests",
]);
const SUMMARY_TEXT_LABELS = new Set(["Today", "Included Spend"]);
const SUMMARY_BADGE_LABELS = new Set(["Status", "Account"]);

type DashboardLine = Record<string, unknown>;
type ProviderData = {
  providerId: ProviderId;
  plan?: string;
  lines: DashboardLine[];
  status?: ProviderStatus;
};

function loadCardOrder(): string[] {
  try {
    const raw = localStorage.getItem(CARD_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCardOrder(order: string[]): void {
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

export function dashboardRecordsForProviders(
  records: UsageRecord[],
  providerMap: Map<ProviderId, ProviderStatus>,
): UsageRecord[] {
  const map = new Map<ProviderId, UsageRecord>();
  for (const record of records) {
    if (map.has(record.providerId)) continue;
    if (!isPlainObject(record.raw)) continue;
    const raw = record.raw as Record<string, unknown>;
    if (!Array.isArray(raw.lines) && !isPlainObject(raw.quota)) continue;
    const status = providerMap.get(record.providerId);
    if (!status || status.enabled === false) continue;
    map.set(record.providerId, record);
  }
  return [...map.values()];
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

  if (!summaryLines.some((line) => line.type === "progress")) {
    const firstUsefulIndex = detailLines.findIndex((line) => line.type === "progress");
    if (firstUsefulIndex >= 0) {
      summaryLines.push(detailLines[firstUsefulIndex]);
      detailLines.splice(firstUsefulIndex, 1);
    }
  }

  return { summaryLines, detailLines };
}

export type ProviderCardGroup = { id: string; members: ProviderData[] };

function baseProviderId(providerId: ProviderId): string {
  return providerId.split(":")[0];
}

// Accounts of one provider share a card; a provider with one account keeps its own id.
export function groupProviderCards(items: ProviderData[]): ProviderCardGroup[] {
  const byBase = new Map<string, ProviderData[]>();
  for (const item of items) {
    const base = baseProviderId(item.providerId);
    byBase.set(base, [...(byBase.get(base) ?? []), item]);
  }
  return [...byBase.entries()].map(([base, members]) => ({
    id: members.length > 1 ? base : members[0].providerId,
    members,
  }));
}

function isAccountBadge(line: DashboardLine): boolean {
  return line.type === "badge" && lineLabel(line) === "Account";
}

export function accountHeading({ providerId, lines, status }: ProviderData): string {
  const badge = lines.find(isAccountBadge);
  if (badge && typeof badge.text === "string" && badge.text.trim()) return badge.text.trim();
  const name = status?.name?.trim() || providerId;
  return name.replace(/^[^·]+·\s*/, "");
}

function progressKey(lines: DashboardLine[]): string {
  return JSON.stringify(
    lines
      .filter((line) => line.type === "progress")
      .map((line) => [lineLabel(line), line.used, line.limit])
      .sort(),
  );
}

// Unused windows read 0% everywhere, so a match counts only with real use at the same reset time.
export function sameQuotaAcrossAccounts(members: ProviderData[]): boolean {
  if (members.length < 2) return false;
  const [first, ...rest] = members;
  const key = progressKey(first.lines);
  if (key === "[]" || rest.some((item) => progressKey(item.lines) !== key)) return false;
  return first.lines.some((line) =>
    line.type === "progress"
    && Number(line.used) > 0
    && typeof line.resetsAt === "string"
    && rest.every((item) => item.lines.some((other) =>
      lineLabel(other) === lineLabel(line) && other.resetsAt === line.resetsAt)),
  );
}

function latestRefresh(members: ProviderData[]): string | undefined {
  return members
    .map((item) => item.status?.lastRefreshAt)
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1);
}

function AccountColumn({ member, showPlan }: { member: ProviderData; showPlan: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { summaryLines, detailLines } = useMemo(
    () => splitDashboardLines(member.lines.filter((line) => !isAccountBadge(line))),
    [member.lines],
  );
  const detailId = `${member.providerId}-details`;
  const heading = accountHeading(member);
  return (
    <section className="account-column" aria-label={heading}>
      <div className="account-column-title">
        <strong title={heading}>{heading}</strong>
        {showPlan && member.plan ? <span className="value-chip">{member.plan}</span> : null}
      </div>
      <div className="usage-lines">
        {summaryLines.map((line, i) => (
          <UsageLine key={`${String(line.label)}-${i}`} line={line} />
        ))}
      </div>
      {detailLines.length > 0 ? (
        <>
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
          <div id={detailId} className="usage-detail-lines" hidden={!expanded}>
            {detailLines.map((line, i) => (
              <UsageLine key={`${String(line.label)}-${i}`} line={line} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function AccountGroupCard({ group }: { group: ProviderCardGroup }) {
  const { members } = group;
  const plans = [...new Set(members.map((item) => item.plan).filter(Boolean))];
  const sharedPlan = plans.length === 1 && members.every((item) => item.plan) ? plans[0] : undefined;
  const updated = latestRefresh(members);
  return (
    <SortableCard id={group.id} className="account-group-card">
      <div className="provider-title-row">
        <h3>{providerLabel(baseProviderId(members[0].providerId))}</h3>
        <span className="account-count">{members.length} Accounts</span>
        {sharedPlan ? <span className="value-chip">{sharedPlan}</span> : null}
      </div>
      {sameQuotaAcrossAccounts(members) ? (
        <p className="account-group-note">All accounts report the same usage and reset times.</p>
      ) : null}
      <div className="account-columns">
        {members.map((member) => (
          <AccountColumn key={member.providerId} member={member} showPlan={!sharedPlan} />
        ))}
      </div>
      {updated ? <div className="usage-card-footer">Updated {formatDate(updated)}</div> : null}
    </SortableCard>
  );
}

function ProviderUsageCard({ providerId, plan, lines, status }: ProviderData) {
  const [expanded, setExpanded] = useState(false);
  const { summaryLines, detailLines } = useMemo(() => splitDashboardLines(lines), [lines]);
  const detailId = `${providerId}-details`;
  const isCompact = detailLines.length === 0 && summaryLines.length <= 2;

  return (
    <SortableCard key={providerId} id={providerId} className={isCompact ? "compact" : ""}>
      <div className="provider-title-row">
        <h3>{providerLabel(providerId, status?.name)}</h3>
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
  const latestByProvider = useMemo(
    () => dashboardRecordsForProviders(records, providerMap),
    [records, providerMap],
  );

  const providerDataMap = useMemo(() => {
    const map = new Map<ProviderId, ProviderData>();
    for (const record of latestByProvider) {
      const providerId = record.providerId;
      const status = providerMap.get(providerId);
      if (!status || status.enabled === false) continue;
      const raw = record.raw as Record<string, unknown>;
      const lines = linesFromRaw(raw);
      const plan = typeof raw.plan === "string" ? raw.plan : typeof raw.planName === "string" ? raw.planName : undefined;
      map.set(providerId, { providerId, plan, lines, status });
    }
    return map;
  }, [latestByProvider, providerMap]);

  const cardGroups = useMemo(() => groupProviderCards([...providerDataMap.values()]), [providerDataMap]);
  const groupMap = useMemo(() => new Map(cardGroups.map((group) => [group.id, group])), [cardGroups]);

  const [cardOrder, setCardOrder] = useState<string[]>(() => {
    const saved = loadCardOrder();
    const activeIds = cardGroups.map((group) => group.id);
    if (saved.length > 0) {
      const activeSet = new Set(activeIds);
      const ordered = saved.filter((id) => activeSet.has(id));
      const missing = activeIds.filter((id) => !saved.includes(id));
      return [...ordered, ...missing.sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)))];
    }
    return activeIds.sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)));
  });

  useEffect(() => {
    const activeIds = cardGroups.map((group) => group.id);
    const activeSet = new Set(activeIds);
    setCardOrder((prev) => {
      const ordered = prev.filter((id) => activeSet.has(id));
      const missing = activeIds.filter((id) => !prev.includes(id));
      if (missing.length === 0 && ordered.length === prev.length) return prev;
      return [...ordered, ...missing.sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)))];
    });
  }, [cardGroups]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setCardOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      saveCardOrder(next);
      return next;
    });
  }, []);

  const sortedGroups = useMemo(() => {
    return cardOrder
      .map((id) => groupMap.get(id))
      .filter(Boolean) as ProviderCardGroup[];
  }, [cardOrder, groupMap]);

  return (
    <section className="page-grid">
      {sortedGroups.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={cardOrder} strategy={rectSortingStrategy}>
            <div className="provider-grid dashboard-provider-grid">
              {sortedGroups.map((group) =>
                group.members.length > 1 ? (
                  <AccountGroupCard key={group.id} group={group} />
                ) : (
                  <ProviderUsageCard key={group.id} {...group.members[0]} />
                ),
              )}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <h3>Provider Breakdown</h3>
            <span>{providers.length} Providers</span>
          </div>
          <div className="panel-body">
            <p className="settings-help muted">
              No usage data yet. Click Refresh All to fetch provider data.
            </p>
          </div>
        </section>
      )}
    </section>
  );
}
