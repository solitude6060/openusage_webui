import type {
  ProviderId,
  ProviderStatus,
  UsageRecord,
  UsageSummary,
} from "../../../../packages/core/src/types";

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
