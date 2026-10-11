import type { SqliteStorage } from "../../../packages/storage/src/index";
import { OpenUsagePluginProvider } from "../../../packages/providers/src/index";
import {
  meterShapeFromObservations,
  type CodexEventScanResult,
  type CodexMeterShape,
  type CodexShapeObservation,
} from "../../../packages/providers/src/codex-session-events";

const PLAN_TYPES_KEY = "codex_event_plan_types";
const MAP_KEY = "codex_event_map_key";

export async function attachCodexEventScan(
  storage: SqliteStorage,
  provider: OpenUsagePluginProvider,
): Promise<void> {
  const fallbackHome = provider.codexHomePath();
  if (!fallbackHome) {
    provider.setCodexEventScan(null);
    return;
  }
  const accounts = await storage.listProviderAccounts("codex");
  const plans = readPlanTypes(await storage.getAppMeta(PLAN_TYPES_KEY));
  const observations = await storage.listLatestQuotaObservations();
  const homes = accounts.length > 0
    ? accounts.map((account) => ({ id: account.id, homePath: account.homePath }))
    : [{ id: provider.id, homePath: fallbackHome }];
  provider.setCodexEventScan({
    accounts: homes.map((account) => ({
      id: account.id,
      homePath: account.homePath,
      shape: shapeFor(observations, account.id),
      planType: plans[account.id] ?? null,
    })),
    cursors: await storage.listCodexEventCursors(),
    storedMapKey: await storage.getAppMeta(MAP_KEY),
  });
}

export async function saveCodexEventScan(
  storage: SqliteStorage,
  result: CodexEventScanResult,
): Promise<void> {
  if (result.replaceProviderIds.length > 0) {
    await storage.replaceCodexTokenEvents(result.replaceProviderIds, result.events);
  } else {
    await storage.upsertCodexTokenEvents(result.events);
  }
  await storage.saveCodexEventCursors(result.cursors);
  if (result.learnedPlans.length > 0) {
    const plans = readPlanTypes(await storage.getAppMeta(PLAN_TYPES_KEY));
    for (const plan of result.learnedPlans) plans[plan.providerId] = plan.planType;
    await storage.setAppMeta(PLAN_TYPES_KEY, JSON.stringify(plans));
  }
  await storage.setAppMeta(MAP_KEY, result.mapKey);
  if (result.unmapped > 0) {
    console.error(JSON.stringify({ event: "codex_events_unmapped", count: result.unmapped }));
  }
}

function shapeFor(
  observations: Awaited<ReturnType<SqliteStorage["listLatestQuotaObservations"]>>,
  providerId: string,
): CodexMeterShape | null {
  const rows: CodexShapeObservation[] = observations
    .filter((row) => row.providerId === providerId)
    .map((row) => ({
      windowKey: row.windowKey,
      periodMs: row.periodMs,
      present: row.present,
      observedAt: row.observedAt,
      resetsAt: row.resetsAt,
    }));
  return meterShapeFromObservations(rows);
}

function readPlanTypes(raw: string | null): Record<string, string> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("codex_event_plan_types is not an object.");
  }
  const plans: Record<string, string> = {};
  for (const [id, plan] of Object.entries(parsed)) {
    if (typeof plan === "string" && plan.trim()) plans[id] = plan;
  }
  return plans;
}
