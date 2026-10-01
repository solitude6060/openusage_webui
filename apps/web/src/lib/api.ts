import type {
  MultiAccountProviderCapability,
  MultiAccountProviderId,
  ProviderAccount,
  ProviderId,
  ProviderStatus,
  TokenUsageBreakdown,
  UsageRecord,
  UsageSummary,
} from "../../../../packages/core/src/types";

export type { ProviderAccount, MultiAccountProviderCapability, MultiAccountProviderId, TokenUsageBreakdown };

export interface AccountHomeCandidate {
  providerId: MultiAccountProviderId;
  homePath: string;
  label: string;
  hasAuth: boolean;
}

export interface ManualUsageInput {
  providerId: ProviderId;
  tool?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  startedAt?: string;
  notes?: string;
}

export interface HealthResponse {
  ok: true;
  version: string;
  database: "ok";
  databasePath: string;
  host: string;
  port: number;
}

export interface ProviderRefreshResult {
  providerId: ProviderId;
  ok: boolean;
  records?: number;
  error?: string;
}

export async function getHealth(): Promise<HealthResponse> {
  return request("/api/health");
}

export async function getProviders(): Promise<ProviderStatus[]> {
  return request("/api/providers");
}

export async function refreshAllProviders(): Promise<{
  ok: true;
  results: ProviderRefreshResult[];
}> {
  return request("/api/providers/refresh", { method: "POST" });
}

export async function refreshProvider(providerId: string): Promise<{
  ok: true;
  results: ProviderRefreshResult[];
}> {
  return request(`/api/providers/${encodeURIComponent(providerId)}/refresh`, { method: "POST" });
}

export async function getUsageSummary(): Promise<UsageSummary> {
  return request("/api/usage/summary");
}

export async function getTokenUsage(params: {
  from?: string;
  to?: string;
} = {}): Promise<TokenUsageBreakdown> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  return request(`/api/usage/tokens${search.size ? `?${search}` : ""}`);
}

export async function getUsageRecords(params: {
  providerId?: string;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<UsageRecord[]> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  return request(`/api/usage/records${search.size ? `?${search}` : ""}`);
}

export interface QuotaWindowView {
  providerId: string;
  windowKey: string;
  windowLabel: string;
  present: boolean;
  usedPercent: number | null;
  resetsAt: string | null;
  periodMs: number | null;
  tokensInWindow: number | null;
  limitValue: number | null;
  limitUnit: "usd" | "tokens" | "requests" | null;
  usedValue: number | null;
  impliedAllowance: number | null;
  models: Array<{ model: string; tokens: number }>;
  previous: {
    usedPercent: number | null;
    impliedAllowance: number | null;
    resetsAt: string | null;
  } | null;
}

export interface QuotaDashboard {
  windows: QuotaWindowView[];
  failures: Array<{ providerId: string; failedAt: string; message: string }>;
}

export async function getQuotaDashboard(): Promise<QuotaDashboard> {
  return request("/api/usage/quotas");
}

export type AllowanceRange = "1" | "3" | "5" | "7" | "30" | "month" | "period" | "previous";

export interface AllowanceEstimate {
  providerId: string;
  windowKey: string;
  windowLabel: string;
  from: string;
  to: string;
  resetsAt: string | null;
  percentStart: number | null;
  percentEnd: number | null;
  tokens: number;
  estimatedAllowance: number | null;
  apiCost: number | null;
  estimatedApiCost: number | null;
  coarse: boolean;
  statedLimit: number | null;
  statedLimitUnit: "usd" | "tokens" | "requests" | null;
  models: Array<{ model: string; tokens: number }>;
  reason: "ok" | "shared-log" | "no-movement" | "meter-fell" | "no-tokens" | "unaligned";
}

export async function getAllowance(range: AllowanceRange): Promise<{
  span: string;
  days?: number;
  estimates: AllowanceEstimate[];
}> {
  const named = range === "month" || range === "period" || range === "previous";
  return request(`/api/usage/allowance?${named ? `span=${range}` : `days=${range}`}`);
}

export async function createManualUsage(input: ManualUsageInput): Promise<{
  ok: true;
  record: UsageRecord;
}> {
  return request("/api/manual/usage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function setProviderEnabled(providerId: string, enabled: boolean): Promise<{
  ok: true;
  providerId: string;
  enabled: boolean;
}> {
  return request(`/api/providers/${encodeURIComponent(providerId)}/enabled`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export async function listProviderAccountCapabilities(): Promise<MultiAccountProviderCapability[]> {
  return request("/api/provider-accounts/capabilities");
}

export async function listProviderAccounts(providerId?: string): Promise<ProviderAccount[]> {
  const search = providerId ? `?providerId=${encodeURIComponent(providerId)}` : "";
  return request(`/api/provider-accounts${search}`);
}

export async function detectProviderAccounts(providerId: string): Promise<{
  ok: true;
  providerId: string;
  candidates: AccountHomeCandidate[];
}> {
  return request("/api/provider-accounts/detect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId }),
  });
}

export async function createProviderAccount(input: {
  providerId: string;
  label: string;
  homePath: string;
  enabled?: boolean;
}): Promise<{ ok: true; account: ProviderAccount }> {
  return request("/api/provider-accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateProviderAccount(
  id: string,
  input: Partial<{ label: string; homePath: string; enabled: boolean; sortOrder: number }>,
): Promise<{ ok: true; account: ProviderAccount }> {
  return request(`/api/provider-accounts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteProviderAccount(id: string): Promise<{ ok: true }> {
  return request(`/api/provider-accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      body?.error?.message ?? body?.error ?? `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}
