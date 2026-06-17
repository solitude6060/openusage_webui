import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import type { ProviderId, UsageRecord } from "../../../core/src/types";
import type { UsageProvider } from "../types";

export interface PluginRequestOptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  bodyText?: string;
  timeoutMs?: number;
}

export interface PluginRequestResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
}

export type PluginHttpRunner = (
  args: string[],
  stdin: string,
) => {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export interface OpenUsagePluginProviderOptions {
  providerId: ProviderId;
  name: string;
  pluginId?: string;
  scriptPath?: string;
  scriptText?: string;
  env?: Record<string, string | undefined>;
  request?: (opts: PluginRequestOptions) => PluginRequestResponse;
  now?: () => string;
  pluginDataDir?: string;
}

interface LoadedPlugin {
  id?: string;
  probe?: (ctx: Record<string, unknown>) => unknown;
}

export class OpenUsagePluginProvider implements UsageProvider {
  readonly id: ProviderId;
  readonly name: string;
  private readonly pluginId?: string;
  private readonly scriptPath?: string;
  private readonly scriptText?: string;
  private readonly env: Record<string, string | undefined>;
  private readonly requestImpl?: (opts: PluginRequestOptions) => PluginRequestResponse;
  private readonly now: () => string;
  private readonly pluginDataDir: string;

  constructor(options: OpenUsagePluginProviderOptions) {
    this.id = options.providerId;
    this.name = options.name;
    this.pluginId = options.pluginId;
    this.scriptPath = options.scriptPath;
    this.scriptText = options.scriptText;
    this.env = options.env ?? process.env;
    this.requestImpl = options.request ?? runPluginHttpRequest;
    this.now = options.now ?? (() => new Date().toISOString());
    this.pluginDataDir = options.pluginDataDir ?? join(homedir(), ".openusage-webui", "plugins", this.id);
  }

  async detect(): Promise<boolean> {
    try {
      const plugin = this.loadPlugin();
      return typeof plugin.probe === "function";
    } catch {
      return false;
    }
  }

  async refresh(): Promise<UsageRecord[]> {
    const plugin = this.loadPlugin();
    if (typeof plugin.probe !== "function") {
      throw new Error("OpenUsage plugin does not export probe(ctx).");
    }

    let result: unknown;
    try {
      result = plugin.probe(this.createContext());
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }

    const snapshot = normalizePluginResult(result);
    const startedAt = this.now();
    const raw = {
      pluginId: plugin.id ?? this.pluginId ?? this.id,
      plan: snapshot.plan,
      lines: snapshot.lines,
    };

    return [
      {
        id: createHash("sha256")
          .update([this.id, startedAt, JSON.stringify(raw)].join("|"))
          .digest("hex"),
        providerId: this.id,
        tool: "OpenUsage Plugin Snapshot",
        model: snapshot.plan ?? undefined,
        startedAt,
        source: "api",
        raw,
      },
    ];
  }

  private loadPlugin(): LoadedPlugin {
    const script = this.scriptText ?? (this.scriptPath ? readFileSync(this.scriptPath, "utf8") : null);
    if (!script) {
      throw new Error("OpenUsage plugin script is missing.");
    }

    const sandbox: Record<string, unknown> = {};
    sandbox.globalThis = sandbox;
    runInNewContext(script, sandbox, {
      timeout: 1_000,
      displayErrors: true,
    });

    const plugin = sandbox.__openusage_plugin;
    if (!plugin || typeof plugin !== "object") {
      throw new Error("OpenUsage plugin did not register globalThis.__openusage_plugin.");
    }
    return plugin as LoadedPlugin;
  }

  private createContext(): Record<string, unknown> {
    const filesBase = dirname(this.pluginDataDir);
    return {
      nowIso: this.now(),
      app: {
        version: "0.1.0",
        platform: process.platform,
        appDataDir: join(homedir(), ".openusage-webui"),
        pluginDataDir: this.pluginDataDir,
      },
      host: {
        fs: {
          exists: (path: string) => existsSync(expandHome(path)),
          readText: (path: string) => readFileSync(expandHome(path), "utf8"),
          writeText: (path: string, text: string) => {
            const target = expandHome(path);
            mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
            writeFileSync(target, text, { mode: 0o600 });
          },
          listDir: (path: string) => {
            const base = expandHome(path);
            if (!existsSync(base)) return [];
            return readdirSync(base).sort();
          },
        },
        env: {
          get: (name: string) => {
            const value = this.env[name];
            return typeof value === "string" && value.trim() ? value : null;
          },
        },
        keychain: {
          readGenericPassword: (service: string) => {
            if (service === "gh:github.com") {
              return this.readGitHubToken();
            }
            return null;
          },
          readGenericPasswordForCurrentUser: () => null,
          writeGenericPassword: () => undefined,
          writeGenericPasswordForCurrentUser: () => undefined,
          deleteGenericPassword: () => undefined,
        },
        crypto: {
          sha256Hex: (text: string) => createHash("sha256").update(String(text)).digest("hex"),
          encryptAes256Gcm: encryptAes256Gcm,
          decryptAes256Gcm: decryptAes256Gcm,
        },
        http: {
          request: (opts: PluginRequestOptions) => {
            if (!this.requestImpl) {
              throw new Error("OpenUsage plugin HTTP host is not configured for this provider.");
            }
            return this.requestImpl(opts);
          },
        },
        sqlite: {
          query: (databasePath: string, sql: string) => querySqlite(databasePath, sql),
        },
        ls: {
          discover: () => null,
        },
        ccusage: {
          query: () => ({ status: "no_runner", data: null }),
        },
        log: {
          trace: () => undefined,
          debug: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
      line: createLineApi(),
      fmt: createFormatApi(),
      base64: createBase64Api(),
      jwt: createJwtApi(),
      util: createUtilApi((opts) => {
        if (!this.requestImpl) {
          throw new Error("OpenUsage plugin HTTP host is not configured for this provider.");
        }
        return this.requestImpl(opts);
      }),
      __openusageFilesBase: filesBase,
    };
  }

  private readGitHubToken(): string | null {
    const envToken = this.env.GH_TOKEN || this.env.GITHUB_TOKEN;
    if (typeof envToken === "string" && envToken.trim()) {
      return envToken.trim();
    }

    try {
      const proc = Bun.spawnSync(["gh", "auth", "token"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      if (proc.exitCode !== 0) {
        return null;
      }
      const token = Buffer.from(proc.stdout).toString("utf8").trim();
      return token || null;
    } catch {
      return null;
    }
  }
}

export function runPluginHttpRequest(
  opts: PluginRequestOptions,
  runner: PluginHttpRunner = runCurlConfig,
): PluginRequestResponse {
  const config = buildCurlConfig(opts);
  const result = runner(["curl", "--config", "-"], config);
  if (result.exitCode !== 0) {
    throw new Error("Plugin HTTP request failed. Check your connection.");
  }
  return parseCurlIncludeOutput(result.stdout);
}

function runCurlConfig(args: string[], stdin: string): ReturnType<PluginHttpRunner> {
  const proc = Bun.spawnSync(args, {
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: Buffer.from(proc.stdout).toString("utf8"),
    stderr: Buffer.from(proc.stderr).toString("utf8"),
  };
}

function buildCurlConfig(opts: PluginRequestOptions): string {
  const method = opts.method ?? "GET";
  const timeoutSeconds = Math.max(1, Math.ceil((opts.timeoutMs ?? 10_000) / 1000));
  const lines = [
    "silent",
    "show-error",
    "include",
    "location",
    `max-time = "${timeoutSeconds}"`,
    `request = "${curlQuote(method)}"`,
    `url = "${curlQuote(opts.url)}"`,
  ];
  for (const [key, value] of Object.entries(opts.headers ?? {})) {
    lines.push(`header = "${curlQuote(`${key}: ${value}`)}"`);
  }
  if (opts.bodyText !== undefined) {
    lines.push(`data-raw = "${curlQuote(opts.bodyText)}"`);
  }
  return `${lines.join("\n")}\n`;
}

function parseCurlIncludeOutput(output: string): PluginRequestResponse {
  const parts = output.split(/\r?\n\r?\n/);
  const bodyText = parts.pop() ?? "";
  const headerBlock = [...parts].reverse().find((part) => /^HTTP\/\d(?:\.\d)?\s+\d+/.test(part.trim()));
  if (!headerBlock) {
    throw new Error("Plugin HTTP response was malformed.");
  }

  const [statusLine, ...headerLines] = headerBlock.split(/\r?\n/);
  const status = Number(statusLine?.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1]);
  if (!Number.isInteger(status)) {
    throw new Error("Plugin HTTP response status was malformed.");
  }

  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[key] = value;
  }

  return { status, headers, bodyText };
}

function curlQuote(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function querySqlite(databasePath: string, sql: string): string {
  const db = new Database(expandHome(databasePath), { readonly: true, create: false });
  try {
    return JSON.stringify(db.query(sql).all());
  } finally {
    db.close();
  }
}

function encryptAes256Gcm(plaintext: string, keyB64: string): string {
  const key = Buffer.from(String(keyB64).trim(), "base64");
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

function decryptAes256Gcm(envelope: string, keyB64: string): string {
  const parts = String(envelope).trim().split(":");
  if (parts.length !== 3) {
    throw new Error("invalid AES-GCM envelope");
  }
  const key = Buffer.from(String(keyB64).trim(), "base64");
  const iv = Buffer.from(parts[0] ?? "", "base64");
  const tag = Buffer.from(parts[1] ?? "", "base64");
  const ciphertext = Buffer.from(parts[2] ?? "", "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function normalizePluginResult(result: unknown): { plan: string | null; lines: unknown[] } {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("OpenUsage plugin returned invalid usage data.");
  }
  const value = result as Record<string, unknown>;
  return {
    plan: typeof value.plan === "string" && value.plan.trim() ? value.plan : null,
    lines: Array.isArray(value.lines) ? JSON.parse(JSON.stringify(value.lines)) : [],
  };
}

function createLineApi(): Record<string, unknown> {
  return {
    text: (opts: Record<string, unknown>) => copyKnown(opts, ["type", "label", "value", "color", "subtitle"], "text"),
    progress: (opts: Record<string, unknown>) =>
      copyKnown(
        opts,
        ["type", "label", "used", "limit", "format", "resetsAt", "periodDurationMs", "color"],
        "progress",
      ),
    badge: (opts: Record<string, unknown>) => copyKnown(opts, ["type", "label", "text", "color", "subtitle"], "badge"),
    barChart: (opts: Record<string, unknown>) => copyKnown(opts, ["type", "label", "points", "note", "color"], "barChart"),
  };
}

function copyKnown(source: Record<string, unknown>, keys: string[], type: string): Record<string, unknown> {
  const out: Record<string, unknown> = { type };
  for (const key of keys) {
    if (key === "type") continue;
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function createFormatApi(): Record<string, unknown> {
  return {
    planLabel: (value: unknown) =>
      String(value || "")
        .trim()
        .replace(/(^|\s)([a-z])/g, (_match, space, letter) => space + String(letter).toUpperCase()),
    dollars: (cents: unknown) => Math.round((Number(cents) / 100) * 100) / 100,
    resetIn: (secondsUntil: unknown) => {
      const seconds = Number(secondsUntil);
      if (!Number.isFinite(seconds) || seconds < 0) return null;
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      if (days > 0) return `${days}d ${hours % 24}h`;
      if (hours > 0) return `${hours}h ${minutes % 60}m`;
      if (minutes > 0) return `${minutes}m`;
      return "<1m";
    },
  };
}

function createBase64Api(): Record<string, unknown> {
  return {
    decode: (value: string) => Buffer.from(normalizeBase64(value), "base64").toString("utf8"),
    encode: (value: string) => Buffer.from(String(value), "utf8").toString("base64"),
  };
}

function createJwtApi(): Record<string, unknown> {
  return {
    decodePayload: (token: string) => {
      try {
        const [, payload] = String(token).split(".");
        if (!payload) return null;
        return JSON.parse(Buffer.from(normalizeBase64(payload), "base64").toString("utf8"));
      } catch {
        return null;
      }
    },
  };
}

function createUtilApi(request: (opts: PluginRequestOptions) => PluginRequestResponse): Record<string, unknown> {
  const safeJsonParse = (text: unknown) => {
    try {
      return { ok: true, value: JSON.parse(String(text ?? "")) };
    } catch {
      return { ok: false };
    }
  };
  return {
    tryParseJson: (text: unknown) => {
      try {
        return JSON.parse(String(text ?? ""));
      } catch {
        return null;
      }
    },
    safeJsonParse,
    request,
    requestJson: (opts: PluginRequestOptions) => {
      const resp = request(opts);
      const parsed = safeJsonParse(resp.bodyText);
      return { resp, json: parsed.ok ? parsed.value : null };
    },
    isAuthStatus: (status: unknown) => status === 401 || status === 403,
    retryOnceOnAuth: (opts: { request: (token?: string) => PluginRequestResponse; refresh: () => string | null }) => {
      let resp = opts.request();
      if (resp.status === 401 || resp.status === 403) {
        const token = opts.refresh();
        if (token) resp = opts.request(token);
      }
      return resp;
    },
    parseDateMs: (value: unknown) => {
      const parsed = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(String(value));
      return Number.isFinite(parsed) ? parsed : null;
    },
    toIso: (value: unknown) => {
      if (value === null || value === undefined) return null;
      const ms = typeof value === "number" && Math.abs(value) < 1e10 ? value * 1000 : Number(value);
      const date = Number.isFinite(ms) ? new Date(ms) : new Date(String(value));
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    },
    needsRefreshByExpiry: (opts: { nowMs?: number; expiresAtMs?: number; bufferMs?: number }) => {
      const nowMs = Number(opts?.nowMs);
      const expiresAtMs = Number(opts?.expiresAtMs);
      const bufferMs = Number(opts?.bufferMs ?? 0);
      return !Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs) || nowMs + bufferMs >= expiresAtMs;
    },
  };
}

function normalizeBase64(value: string): string {
  let text = String(value).replace(/-/g, "+").replace(/_/g, "/");
  while (text.length % 4) text += "=";
  return text;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}
