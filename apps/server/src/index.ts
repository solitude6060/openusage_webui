import { existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import {
  isValidProviderId,
  type ProviderId,
} from "../../../packages/core/src/types";
import {
  getDatabasePath,
  SqliteStorage,
} from "../../../packages/storage/src/index";
import { createManualUsageRecord, getProviders } from "../../../packages/providers/src/index";
import type { UsageProvider } from "../../../packages/providers/src/index";
import {
  asProvidersRef,
  createProviderAccount,
  deleteProviderAccount,
  detectAccountsForProvider,
  listAccountCapabilities,
  rebuildProvidersFromStorage,
  updateProviderAccount,
  type ProvidersRef,
} from "./provider-accounts";

const VERSION = "0.1.0";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 6736;
const ALLOWED_HOSTS_ENV = "OPENUSAGE_WEBUI_ALLOWED_HOSTS";

type RefreshResult =
  | { providerId: ProviderId; ok: true; records: number }
  | { providerId: ProviderId; ok: false; error: string };

export async function startServer(options: {
  host?: string;
  port?: number;
  devFrontendUrl?: string;
  frontendDistPath?: string;
  providers?: UsageProvider[];
} = {}) {
  const host = options.host ?? process.env.OPENUSAGE_WEBUI_HOST ?? DEFAULT_HOST;
  const port = options.port ?? Number(process.env.OPENUSAGE_WEBUI_PORT ?? DEFAULT_PORT);
  const storage = new SqliteStorage();
  await storage.init();
  const providersRef: ProvidersRef = {
    current: options.providers ?? getProviders({
      providerAccounts: await storage.listProviderAccounts(),
    }),
  };
  if (!options.providers) {
    await rebuildProvidersFromStorage(storage, providersRef);
  } else {
    await seedProviderStatus(storage, providersRef.current);
  }
  const handleRequest = createRequestHandler(
    storage,
    { host, port },
    options.devFrontendUrl,
    providersRef,
    options.frontendDistPath,
    options.providers
      ? undefined
      : async () => {
          await rebuildProvidersFromStorage(storage, providersRef);
        },
  );

  const server = Bun.serve({
    hostname: host,
    port,
    idleTimeout: 120,
    fetch: handleRequest,
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

export function createRequestHandler(
  storage: SqliteStorage,
  serverInfo: { host: string; port: number },
  devFrontendUrl?: string,
  providers: UsageProvider[] | ProvidersRef = getProviders(),
  frontendDistPath?: string,
  rebuildProviders?: () => Promise<void>,
): (request: Request) => Promise<Response> {
  const providersRef = asProvidersRef(providers);
  return async (request) => {
    if (!isAllowedHost(request.headers.get("host"), serverInfo, request.url)) {
      return jsonError("FORBIDDEN_HOST", "Host header is not allowed", 403);
    }

    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(
          request,
          url,
          storage,
          serverInfo,
          providersRef,
          rebuildProviders,
        );
      }
      return await serveFrontend(request, url, devFrontendUrl, frontendDistPath);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.code, error.message, error.status);
      }
      const message = error instanceof Error ? error.message : "Unexpected server error";
      return jsonError("INTERNAL_ERROR", message, 500);
    }
  };
}

async function handleApi(
  request: Request,
  url: URL,
  storage: SqliteStorage,
  serverInfo: { host: string; port: number },
  providersRef: ProvidersRef,
  rebuildProviders?: () => Promise<void>,
): Promise<Response> {
  const providers = () => providersRef.current;
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({
      ok: true,
      version: VERSION,
      database: "ok",
      databasePath: getDatabasePath(),
      host: serverInfo.host,
      port: serverInfo.port,
    });
  }

  if (request.method === "GET" && url.pathname === "/api/providers") {
    return json(await storage.listProviderStatus());
  }

  if (request.method === "POST" && url.pathname === "/api/providers/refresh") {
    const results = await refreshProviders(storage, providers());
    return json({ ok: true, results });
  }

  const providerRefreshMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/refresh$/);
  if (request.method === "POST" && providerRefreshMatch) {
    const providerId = parseProviderId(providerRefreshMatch[1]);
    const results = await refreshProviders(storage, providers(), providerId);
    return json({ ok: true, results });
  }

  if (request.method === "GET" && url.pathname === "/api/provider-accounts/capabilities") {
    return json(listAccountCapabilities());
  }

  if (request.method === "GET" && url.pathname === "/api/provider-accounts") {
    const providerId = url.searchParams.get("providerId") || undefined;
    return json(await storage.listProviderAccounts(providerId));
  }

  if (request.method === "POST" && url.pathname === "/api/provider-accounts/detect") {
    try {
      const body = await readJsonObject(request);
      const providerId = typeof body.providerId === "string" ? body.providerId : "";
      return json({
        ok: true,
        providerId,
        candidates: detectAccountsForProvider(providerId),
      });
    } catch (error) {
      throw new HttpError(
        "BAD_REQUEST",
        error instanceof Error ? error.message : "Failed to detect accounts",
        400,
      );
    }
  }

  if (request.method === "POST" && url.pathname === "/api/provider-accounts") {
    try {
      const body = await readJsonObject(request);
      const account = await createProviderAccount(storage, body);
      if (rebuildProviders) await rebuildProviders();
      return json({ ok: true, account }, { status: 201 });
    } catch (error) {
      throw new HttpError(
        "BAD_REQUEST",
        error instanceof Error ? error.message : "Failed to create provider account",
        400,
      );
    }
  }

  const providerAccountMatch = url.pathname.match(/^\/api\/provider-accounts\/([^/]+)$/);
  if (providerAccountMatch && request.method === "PATCH") {
    try {
      const body = await readJsonObject(request);
      const account = await updateProviderAccount(
        storage,
        decodeURIComponent(providerAccountMatch[1]),
        body,
      );
      if (rebuildProviders) await rebuildProviders();
      return json({ ok: true, account });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update provider account";
      throw new HttpError(
        message.includes("Unknown") ? "NOT_FOUND" : "BAD_REQUEST",
        message,
        message.includes("Unknown") ? 404 : 400,
      );
    }
  }

  if (providerAccountMatch && request.method === "DELETE") {
    try {
      await deleteProviderAccount(storage, decodeURIComponent(providerAccountMatch[1]));
      if (rebuildProviders) await rebuildProviders();
      return json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete provider account";
      throw new HttpError(
        message.includes("Unknown") ? "NOT_FOUND" : "BAD_REQUEST",
        message,
        message.includes("Unknown") ? 404 : 400,
      );
    }
  }

  // Compat aliases for the first Codex-only trial API.
  if (request.method === "GET" && url.pathname === "/api/codex/instances") {
    return json(await storage.listProviderAccounts("codex"));
  }
  if (request.method === "POST" && url.pathname === "/api/codex/instances/detect") {
    return json({ ok: true, candidates: detectAccountsForProvider("codex") });
  }
  if (request.method === "POST" && url.pathname === "/api/codex/instances") {
    try {
      const body = await readJsonObject(request);
      const account = await createProviderAccount(storage, { ...body, providerId: "codex" });
      if (rebuildProviders) await rebuildProviders();
      return json({ ok: true, instance: account, account }, { status: 201 });
    } catch (error) {
      throw new HttpError(
        "BAD_REQUEST",
        error instanceof Error ? error.message : "Failed to create Codex instance",
        400,
      );
    }
  }
  const codexInstanceMatch = url.pathname.match(/^\/api\/codex\/instances\/([^/]+)$/);
  if (codexInstanceMatch && request.method === "PATCH") {
    try {
      const body = await readJsonObject(request);
      const account = await updateProviderAccount(
        storage,
        decodeURIComponent(codexInstanceMatch[1]),
        body,
      );
      if (rebuildProviders) await rebuildProviders();
      return json({ ok: true, instance: account, account });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update Codex instance";
      throw new HttpError(
        message.includes("Unknown") ? "NOT_FOUND" : "BAD_REQUEST",
        message,
        message.includes("Unknown") ? 404 : 400,
      );
    }
  }
  if (codexInstanceMatch && request.method === "DELETE") {
    try {
      await deleteProviderAccount(storage, decodeURIComponent(codexInstanceMatch[1]));
      if (rebuildProviders) await rebuildProviders();
      return json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete Codex instance";
      throw new HttpError(
        message.includes("Unknown") ? "NOT_FOUND" : "BAD_REQUEST",
        message,
        message.includes("Unknown") ? 404 : 400,
      );
    }
  }

  const providerEnabledMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/enabled$/);
  if (request.method === "PATCH" && providerEnabledMatch) {
    const providerId = parseProviderId(providerEnabledMatch[1]);
    const body = await readJsonObject(request);
    if (typeof body.enabled !== "boolean") {
      throw new HttpError("BAD_REQUEST", "enabled must be a boolean", 400);
    }
    const existing = (await storage.listProviderStatus()).find((s) => s.providerId === providerId);
    await storage.upsertProviderStatus({
      providerId,
      name: existing?.name ?? providerId,
      enabled: body.enabled,
      detected: existing?.detected ?? false,
      lastRefreshAt: existing?.lastRefreshAt,
      lastError: existing?.lastError,
    });
    const providerAccount = await storage.getProviderAccount(providerId);
    if (providerAccount) {
      await storage.upsertProviderAccount({ ...providerAccount, enabled: body.enabled });
    }
    return json({ ok: true, providerId, enabled: body.enabled });
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
    const body = await readJsonObject(request);
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
    if (providerId === "minimax") {
      throw new HttpError(
        "METHOD_NOT_ALLOWED",
        "MiniMax settings are read-only. Configure MiniMax API keys with environment variables.",
        405,
      );
    }
    const body = await readJsonObject(request);
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

async function seedProviderStatus(
  storage: SqliteStorage,
  providers: UsageProvider[],
): Promise<void> {
  const existing = new Map(
    (await storage.listProviderStatus()).map((status) => [status.providerId, status]),
  );
  for (const provider of providers) {
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
  providers: UsageProvider[],
  providerId?: ProviderId,
): Promise<RefreshResult[]> {
  const refreshableProviders = providers.filter((provider) => !providerId || provider.id === providerId);
  if (providerId && refreshableProviders.length === 0) {
    return [{ providerId, ok: false, error: "Provider is not refreshable yet" }];
  }

  const statusMap = new Map(
    (await storage.listProviderStatus()).map((s) => [s.providerId, s]),
  );

  const results: RefreshResult[] = [];
  for (const provider of refreshableProviders) {
    const existing = statusMap.get(provider.id);
    if (existing && !existing.enabled && !providerId) {
      continue;
    }
    const isEnabled = existing?.enabled ?? true;
    console.log(JSON.stringify({ event: "provider_refresh_started", providerId: provider.id }));
    let detected = false;
    try {
      detected = await provider.detect();
      const records = await provider.refresh();
      await storage.upsertUsageRecords(records);
      await storage.upsertProviderStatus({
        providerId: provider.id,
        name: provider.name,
        enabled: isEnabled,
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
        enabled: isEnabled,
        detected,
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
  frontendDistPath?: string,
): Promise<Response> {
  if (devFrontendUrl) {
    const proxyUrl = new URL(url.pathname + url.search, devFrontendUrl);
    return fetch(proxyUrl, {
      method: request.method,
      headers: proxyHeaders(request.headers, proxyUrl),
      body: request.body,
    });
  }

  const webDist = frontendDistPath ?? join(import.meta.dir, "../../web/dist");
  const indexPath = join(webDist, "index.html");
  if (!isExistingFile(indexPath)) {
    console.log(
      JSON.stringify({
        event: "frontend_build_missing",
        expectedPath: indexPath,
      }),
    );
    throw new HttpError(
      "FRONTEND_BUILD_MISSING",
      "Frontend build is missing. Run bun run build:webui before start:webui.",
      500,
    );
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : safeDecodePath(url.pathname);
  const safePath = normalize(requestedPath)
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(webDist, safePath);
  const target = isExistingFile(filePath) ? filePath : indexPath;
  return new Response(Bun.file(target), {
    headers: {
      "content-type": contentType(target),
    },
  });
}

function parseProviderId(value: string): ProviderId {
  const decoded = decodeURIComponent(value);
  if (!isValidProviderId(decoded)) {
    throw new HttpError("BAD_REQUEST", `Unknown provider: ${decoded}`, 400);
  }
  return decoded;
}

function sanitizeSettings(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError("BAD_REQUEST", "Settings body must be an object", 400);
  }
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, value === undefined ? "" : String(value)]),
  );
}

function proxyHeaders(headers: Headers, target: URL): Headers {
  const proxied = new Headers(headers);
  proxied.set("host", target.host);
  return proxied;
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
  if (pathname.endsWith(".json")) return "application/json";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".ico")) return "image/x-icon";
  if (pathname.endsWith(".woff2")) return "font/woff2";
  if (pathname.endsWith(".woff")) return "font/woff";
  return "text/html";
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError("BAD_REQUEST", "Request body must be a JSON object", 400);
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError("BAD_REQUEST", "Failed to parse JSON", 400);
  }
}

function isAllowedHost(
  hostHeader: string | null,
  serverInfo: { host: string; port: number },
  requestUrl?: string,
): boolean {
  const host = normalizeAllowedHost(hostHeader ?? deriveHostFromUrl(requestUrl), serverInfo.port);
  if (!host) {
    return false;
  }
  const allowed = new Set([
    `127.0.0.1:${serverInfo.port}`,
    `localhost:${serverInfo.port}`,
    `[::1]:${serverInfo.port}`,
  ]);
  if (!isWildcardHost(serverInfo.host)) {
    const bindHost = normalizeAllowedHost(serverInfo.host, serverInfo.port);
    if (bindHost) allowed.add(bindHost);
  }
  for (const value of (process.env[ALLOWED_HOSTS_ENV] ?? "").split(/[,\s]+/)) {
    const allowedHost = normalizeAllowedHost(value, serverInfo.port);
    if (allowedHost) allowed.add(allowedHost);
  }
  return allowed.has(host);
}

function normalizeAllowedHost(value: string | null | undefined, port: number): string | null {
  const host = value?.trim().toLowerCase();
  if (!host) return null;
  if (host.includes("://")) {
    try {
      return new URL(host).host.toLowerCase();
    } catch {
      return null;
    }
  }
  if (host.startsWith("[")) return host.includes("]:") ? host : `${host}:${port}`;
  const colonCount = (host.match(/:/g) ?? []).length;
  if (colonCount === 0) return `${host}:${port}`;
  if (colonCount === 1) return host;
  return `[${host}]:${port}`;
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

function deriveHostFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function safeDecodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    throw new HttpError("BAD_REQUEST", "Request path is malformed", 400);
  }
}

function isExistingFile(pathname: string): boolean {
  return existsSync(pathname) && statSync(pathname).isFile();
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

function jsonError(code: string, message: string, status: number): Response {
  return json(
    {
      ok: false,
      error: { code, message },
    },
    { status },
  );
}

class HttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

if (import.meta.main) {
  // OPENUSAGE_WEBUI_DEV_FRONTEND_URL is an INTERNAL, dev-only var that dev.ts sets to point
  // the API at the Vite dev server. Do NOT set it in production: `bun src/index.ts`
  // (start:webui) must leave it unset so the built dist is served instead of proxying to a
  // Vite server that isn't running.
  await startServer({ devFrontendUrl: process.env.OPENUSAGE_WEBUI_DEV_FRONTEND_URL || undefined });
}
