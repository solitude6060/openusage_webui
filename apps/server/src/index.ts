import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import type { ProviderId, ProviderStatus } from "../../../packages/core/src/types";
import {
  getDatabasePath,
  SqliteStorage,
} from "../../../packages/storage/src/index";
import { createManualUsageRecord, getProviders } from "../../../packages/providers/src/index";

const VERSION = "0.1.0";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 6736;
const PROVIDER_IDS = new Set<ProviderId>([
  "ccusage",
  "claude-code",
  "codex",
  "github-copilot",
  "gemini-cli",
  "google-ai-pro",
  "minimax",
  "manual",
]);

type RefreshResult =
  | { providerId: ProviderId; ok: true; records: number }
  | { providerId: ProviderId; ok: false; error: string };

export async function startServer(options: {
  host?: string;
  port?: number;
  devFrontendUrl?: string;
} = {}) {
  const host = options.host ?? process.env.OPENUSAGE_WEBUI_HOST ?? DEFAULT_HOST;
  const port = options.port ?? Number(process.env.OPENUSAGE_WEBUI_PORT ?? DEFAULT_PORT);
  const storage = new SqliteStorage();
  await storage.init();
  await seedProviderStatus(storage);

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(request) {
      const url = new URL(request.url);
      try {
        if (url.pathname.startsWith("/api/")) {
          return await handleApi(request, url, storage);
        }
        return await serveFrontend(request, url, options.devFrontendUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected server error";
        return json(
          {
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message,
            },
          },
          { status: 500 },
        );
      }
    },
  });

  console.log(
    JSON.stringify({
      event: "server_started",
      host,
      port,
      databasePath: getDatabasePath(),
    }),
  );
  return server;
}

async function handleApi(
  request: Request,
  url: URL,
  storage: SqliteStorage,
): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({
      ok: true,
      version: VERSION,
      database: "ok",
      databasePath: getDatabasePath(),
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
    });
  }

  if (request.method === "GET" && url.pathname === "/api/providers") {
    return json(await storage.listProviderStatus());
  }

  if (request.method === "POST" && url.pathname === "/api/providers/refresh") {
    const results = await refreshProviders(storage);
    return json({ ok: true, results });
  }

  const providerRefreshMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/refresh$/);
  if (request.method === "POST" && providerRefreshMatch) {
    const providerId = parseProviderId(providerRefreshMatch[1]);
    const results = await refreshProviders(storage, providerId);
    return json({ ok: true, results });
  }

  if (request.method === "GET" && url.pathname === "/api/usage/summary") {
    return json(await storage.getUsageSummary());
  }

  if (request.method === "GET" && url.pathname === "/api/usage/records") {
    const providerId = url.searchParams.get("providerId") || undefined;
    return json(
      await storage.listUsageRecords({
        providerId: providerId ? parseProviderId(providerId) : undefined,
        from: url.searchParams.get("from") || undefined,
        to: url.searchParams.get("to") || undefined,
        limit: Number(url.searchParams.get("limit") ?? 100),
      }),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/manual/usage") {
    const body = await request.json();
    const record = createManualUsageRecord({
      providerId: body.providerId ? parseProviderId(body.providerId) : "manual",
      tool: stringOrUndefined(body.tool),
      model: stringOrUndefined(body.model),
      inputTokens: numberOrUndefined(body.inputTokens),
      outputTokens: numberOrUndefined(body.outputTokens),
      costUsd: numberOrUndefined(body.costUsd),
      startedAt: stringOrUndefined(body.startedAt),
      notes: stringOrUndefined(body.notes),
    });
    await storage.upsertUsageRecords([record]);
    return json({ ok: true, record }, { status: 201 });
  }

  const settingsMatch = url.pathname.match(/^\/api\/settings\/([^/]+)$/);
  if (settingsMatch && request.method === "GET") {
    return json(await storage.getProviderSettings(parseProviderId(settingsMatch[1])));
  }
  if (settingsMatch && request.method === "PUT") {
    const providerId = parseProviderId(settingsMatch[1]);
    const body = await request.json();
    await storage.updateProviderSettings(providerId, sanitizeSettings(body));
    return json(await storage.getProviderSettings(providerId));
  }

  return json(
    {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Endpoint not found",
      },
    },
    { status: 404 },
  );
}

async function seedProviderStatus(storage: SqliteStorage): Promise<void> {
  const existing = new Map(
    (await storage.listProviderStatus()).map((status) => [status.providerId, status]),
  );
  for (const provider of getProviders()) {
    if (existing.has(provider.id)) {
      continue;
    }
    const detected = await provider.detect();
    await storage.upsertProviderStatus({
      providerId: provider.id,
      name: provider.name,
      enabled: true,
      detected,
    });
  }
}

async function refreshProviders(
  storage: SqliteStorage,
  providerId?: ProviderId,
): Promise<RefreshResult[]> {
  const providers = getProviders().filter((provider) => !providerId || provider.id === providerId);
  if (providerId && providers.length === 0) {
    return [{ providerId, ok: false, error: "Provider is not refreshable yet" }];
  }

  const results: RefreshResult[] = [];
  for (const provider of providers) {
    console.log(JSON.stringify({ event: "provider_refresh_started", providerId: provider.id }));
    try {
      const detected = await provider.detect();
      const records = await provider.refresh();
      await storage.upsertUsageRecords(records);
      await storage.upsertProviderStatus({
        providerId: provider.id,
        name: provider.name,
        enabled: true,
        detected,
        lastRefreshAt: new Date().toISOString(),
      });
      results.push({ providerId: provider.id, ok: true, records: records.length });
      console.log(
        JSON.stringify({
          event: "provider_refresh_completed",
          providerId: provider.id,
          records: records.length,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider refresh failed";
      await storage.upsertProviderStatus({
        providerId: provider.id,
        name: provider.name,
        enabled: true,
        detected: false,
        lastRefreshAt: new Date().toISOString(),
        lastError: message,
      });
      results.push({ providerId: provider.id, ok: false, error: message });
      console.log(
        JSON.stringify({
          event: "provider_refresh_completed",
          providerId: provider.id,
          error: message,
        }),
      );
    }
  }
  return results;
}

async function serveFrontend(
  request: Request,
  url: URL,
  devFrontendUrl?: string,
): Promise<Response> {
  if (devFrontendUrl) {
    const proxyUrl = new URL(url.pathname + url.search, devFrontendUrl);
    return fetch(proxyUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
  }

  const webDist = join(import.meta.dir, "../../web/dist");
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(webDist, safePath);
  const target = existsSync(filePath) ? filePath : join(webDist, "index.html");
  return new Response(Bun.file(target), {
    headers: {
      "content-type": contentType(target),
    },
  });
}

function parseProviderId(value: string): ProviderId {
  if (!PROVIDER_IDS.has(value as ProviderId)) {
    throw new Error(`Unknown provider: ${value}`);
  }
  return value as ProviderId;
}

function sanitizeSettings(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Settings body must be an object");
  }
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, value === undefined ? "" : String(value)]),
  );
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function contentType(pathname: string): string {
  if (pathname.endsWith(".js")) return "text/javascript";
  if (pathname.endsWith(".css")) return "text/css";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  return "text/html";
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...(init.headers ?? {}),
    },
  });
}

if (import.meta.main) {
  await startServer();
}
