import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import {
  buildProviderAccountId,
  isMultiAccountProviderId,
  isProviderAccountId,
  type MultiAccountProviderId,
  type ProviderAccount,
} from "../../../packages/core/src/types";
import {
  detectProviderAccounts,
  getProviders,
  listMultiAccountCapabilities,
  type UsageProvider,
} from "../../../packages/providers/src/index";
import type { SqliteStorage } from "../../../packages/storage/src/index";

export type ProvidersRef = {
  current: UsageProvider[];
};

export function asProvidersRef(providers: UsageProvider[] | ProvidersRef): ProvidersRef {
  return Array.isArray(providers) ? { current: providers } : providers;
}

export async function rebuildProvidersFromStorage(
  storage: SqliteStorage,
  providersRef: ProvidersRef,
): Promise<void> {
  const accounts = await storage.listProviderAccounts();
  providersRef.current = getProviders({ providerAccounts: accounts });
  await syncProviderStatus(storage, providersRef.current, accounts);
}

export async function syncProviderStatus(
  storage: SqliteStorage,
  providers: UsageProvider[],
  accounts: ProviderAccount[],
): Promise<void> {
  const desiredIds = new Set(providers.map((provider) => provider.id));
  const existing = await storage.listProviderStatus();
  const existingMap = new Map(existing.map((status) => [status.providerId, status]));

  for (const status of existing) {
    const isAccountSlot =
      isProviderAccountId(status.providerId) ||
      isMultiAccountProviderId(status.providerId);
    if (isAccountSlot && !desiredIds.has(status.providerId)) {
      await storage.deleteProviderStatus(status.providerId);
    }
  }

  for (const provider of providers) {
    const previous = existingMap.get(provider.id);
    const account = accounts.find((item) => item.id === provider.id);
    if (!previous) {
      const detected = await provider.detect();
      await storage.upsertProviderStatus({
        providerId: provider.id,
        name: provider.name,
        enabled: account?.enabled ?? true,
        detected,
      });
      continue;
    }
    if (previous.name !== provider.name) {
      await storage.upsertProviderStatus({
        ...previous,
        name: provider.name,
      });
    }
  }
}

export function normalizeHomePath(homePath: string, homeDir = homedir()): string {
  const trimmed = homePath.trim();
  if (!trimmed) {
    throw new Error("homePath is required");
  }
  if (trimmed === "~") return homeDir;
  if (trimmed.startsWith("~/")) return resolve(homeDir, trimmed.slice(2));
  if (isAbsolute(trimmed)) return trimmed;
  return resolve(homeDir, trimmed);
}

export async function createProviderAccount(
  storage: SqliteStorage,
  body: {
    providerId?: unknown;
    label?: unknown;
    homePath?: unknown;
    enabled?: unknown;
  },
): Promise<ProviderAccount> {
  const providerIdRaw = typeof body.providerId === "string" ? body.providerId.trim() : "";
  if (!isMultiAccountProviderId(providerIdRaw)) {
    throw new Error("providerId must be a multi-account provider");
  }
  const providerId = providerIdRaw as MultiAccountProviderId;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const homePathRaw = typeof body.homePath === "string" ? body.homePath.trim() : "";
  if (!label) throw new Error("label is required");
  if (!homePathRaw) throw new Error("homePath is required");

  const homePath = normalizeHomePath(homePathRaw);
  const existing = await storage.listProviderAccounts(providerId);
  if (
    existing.some((account) => normalizeHomePath(account.homePath) === homePath)
  ) {
    throw new Error("An account with this home path already exists for this provider");
  }

  const id = buildProviderAccountId(
    providerId,
    label,
    existing.map((account) => account.id),
  );
  const account: ProviderAccount = {
    id,
    providerId,
    label,
    homePath,
    enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    sortOrder: existing.length === 0 ? 0 : Math.max(...existing.map((item) => item.sortOrder)) + 1,
  };
  await storage.upsertProviderAccount(account);
  return account;
}

export async function updateProviderAccount(
  storage: SqliteStorage,
  id: string,
  body: { label?: unknown; homePath?: unknown; enabled?: unknown; sortOrder?: unknown },
): Promise<ProviderAccount> {
  if (!isProviderAccountId(id)) {
    throw new Error("Unknown provider account");
  }
  const existing = await storage.getProviderAccount(id);
  if (!existing) {
    throw new Error("Unknown provider account");
  }

  const next: ProviderAccount = {
    ...existing,
    label:
      typeof body.label === "string" && body.label.trim()
        ? body.label.trim()
        : existing.label,
    homePath:
      typeof body.homePath === "string" && body.homePath.trim()
        ? normalizeHomePath(body.homePath)
        : existing.homePath,
    enabled: typeof body.enabled === "boolean" ? body.enabled : existing.enabled,
    sortOrder:
      typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
        ? body.sortOrder
        : existing.sortOrder,
  };

  const others = (await storage.listProviderAccounts(existing.providerId)).filter(
    (account) => account.id !== id,
  );
  if (others.some((account) => normalizeHomePath(account.homePath) === next.homePath)) {
    throw new Error("An account with this home path already exists for this provider");
  }

  await storage.upsertProviderAccount(next);
  const status = (await storage.listProviderStatus()).find((item) => item.providerId === id);
  if (status) {
    await storage.upsertProviderStatus({
      ...status,
      name: next.label,
      enabled: next.enabled,
    });
  }
  return next;
}

export async function deleteProviderAccount(storage: SqliteStorage, id: string): Promise<void> {
  if (!isProviderAccountId(id)) {
    throw new Error("Unknown provider account");
  }
  const existing = await storage.getProviderAccount(id);
  if (!existing) {
    throw new Error("Unknown provider account");
  }
  await storage.deleteProviderAccount(id);
  await storage.deleteProviderStatus(id);
  await storage.deleteUsageRecordsForProvider(id);
}

export function assertCodexCompatAccountId(id: string): void {
  if (!isProviderAccountId(id) || !id.startsWith("codex:")) {
    throw new Error("Unknown Codex instance");
  }
}

export function listAccountCapabilities() {
  return listMultiAccountCapabilities();
}

export function detectAccountsForProvider(providerId: string) {
  return detectProviderAccounts(providerId);
}
