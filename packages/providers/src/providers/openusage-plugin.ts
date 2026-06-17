import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import type { ProviderId, UsageRecord } from "../../../core/src/types";
import { parseCcusageJsonPayload } from "./ccusage-parser";
import type { UsageProvider } from "../types";

export interface PluginRequestOptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  bodyText?: string;
  timeoutMs?: number;
  dangerouslyIgnoreTls?: boolean;
}

export interface PluginRequestResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
}

export interface PluginCcusageQueryOptions {
  provider?: "claude" | "codex";
  since?: string;
  until?: string;
  homePath?: string;
  claudePath?: string;
}

export type PluginCcusageQueryResult =
  | { status: "ok"; data: { daily: Array<Record<string, unknown>> } }
  | { status: "no_runner" | "runner_failed"; data: null };

export interface LanguageServerDiscoveryOptions {
  processName?: string;
  markers?: string[];
  csrfFlag?: string;
  portFlag?: string | null;
}

export interface LanguageServerDiscovery {
  csrf: string;
  extensionPort?: number;
  ports: number[];
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
  ccusageQuery?: (opts: PluginCcusageQueryOptions) => PluginCcusageQueryResult;
  now?: () => string;
  pluginDataDir?: string;
  homeDir?: string;
}

interface LoadedPlugin {
  id?: string;
  probe?: (ctx: Record<string, unknown>) => unknown;
}

type LocalKeychainStore = Record<string, string>;

export class OpenUsagePluginProvider implements UsageProvider {
  readonly id: ProviderId;
  readonly name: string;
  private readonly pluginId?: string;
  private readonly scriptPath?: string;
  private readonly scriptText?: string;
  private readonly env: Record<string, string | undefined>;
  private readonly requestImpl?: (opts: PluginRequestOptions) => PluginRequestResponse;
  private readonly ccusageQueryImpl: (opts: PluginCcusageQueryOptions) => PluginCcusageQueryResult;
  private readonly now: () => string;
  private readonly pluginDataDir: string;
  private readonly homeDir: string;

  constructor(options: OpenUsagePluginProviderOptions) {
    this.id = options.providerId;
    this.name = options.name;
    this.pluginId = options.pluginId;
    this.scriptPath = options.scriptPath;
    this.scriptText = options.scriptText;
    this.env = options.env ?? process.env;
    this.requestImpl = options.request ?? runPluginHttpRequest;
    this.ccusageQueryImpl = options.ccusageQuery ?? ((opts) => runPluginCcusageQuery(opts, this.pluginId));
    this.now = options.now ?? (() => new Date().toISOString());
    this.homeDir = options.homeDir ?? resolveHomeDir();
    this.pluginDataDir = options.pluginDataDir ?? join(this.homeDir, ".openusage-webui", "plugins", this.id);
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
      result = await plugin.probe(this.createContext());
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
        appDataDir: join(this.homeDir, ".openusage-webui"),
        pluginDataDir: this.pluginDataDir,
      },
      host: {
        fs: {
          exists: (path: string) => existsSync(expandHome(path, this.homeDir)),
          readText: (path: string) => readFileSync(expandHome(path, this.homeDir), "utf8"),
          writeText: (path: string, text: string) => {
            const target = expandHome(path, this.homeDir);
            mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
            writeFileSync(target, text, { mode: 0o600 });
            chmodSync(target, 0o600);
          },
          listDir: (path: string) => {
            const base = expandHome(path, this.homeDir);
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
          readGenericPassword: (service: string, account?: string) => {
            if (service === "gh:github.com") {
              return this.readGitHubToken();
            }
            return this.readLocalKeychainPassword(service, account);
          },
          readGenericPasswordForCurrentUser: (service: string) =>
            this.readLocalKeychainPassword(service, this.currentKeychainAccount()),
          writeGenericPassword: (service: string, password: unknown, account?: string) =>
            this.writeLocalKeychainPassword(service, account, password),
          writeGenericPasswordForCurrentUser: (service: string, password: unknown) =>
            this.writeLocalKeychainPassword(service, this.currentKeychainAccount(), password),
          deleteGenericPassword: (service: string, account?: string) =>
            this.deleteLocalKeychainPassword(service, account),
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
          query: (databasePath: string, sql: string) => querySqlite(databasePath, sql, this.homeDir),
          exec: (databasePath: string, sql: string) => execSqlite(databasePath, sql, this.homeDir),
        },
        ls: {
          discover: (opts: LanguageServerDiscoveryOptions) => discoverLanguageServer(opts ?? {}),
        },
        ccusage: {
          query: (opts: PluginCcusageQueryOptions) => this.ccusageQueryImpl(opts ?? {}),
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

  private readLocalKeychainPassword(service: string, account?: string): string | null {
    const store = this.readLocalKeychainStore();
    const value = store[localKeychainKey(service, account)];
    return typeof value === "string" ? value : null;
  }

  private writeLocalKeychainPassword(service: string, account: string | undefined, password: unknown): void {
    if (typeof password !== "string") {
      throw new Error("Keychain password must be a string.");
    }
    const store = this.readLocalKeychainStore();
    store[localKeychainKey(service, account)] = password;
    this.writeLocalKeychainStore(store);
  }

  private deleteLocalKeychainPassword(service: string, account?: string): void {
    const store = this.readLocalKeychainStore();
    delete store[localKeychainKey(service, account)];
    this.writeLocalKeychainStore(store);
  }

  private currentKeychainAccount(): string {
    const value = this.env.USER || this.env.LOGNAME || process.env.USER || process.env.LOGNAME;
    return typeof value === "string" && value.trim() ? value.trim() : "current-user";
  }

  private keychainStorePath(): string {
    return join(this.pluginDataDir, "keychain.json");
  }

  private readLocalKeychainStore(): LocalKeychainStore {
    const path = this.keychainStorePath();
    if (!existsSync(path)) return {};
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const store: LocalKeychainStore = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") store[key] = value;
      }
      return store;
    } catch {
      return {};
    }
  }

  private writeLocalKeychainStore(store: LocalKeychainStore): void {
    mkdirSync(this.pluginDataDir, { recursive: true, mode: 0o700 });
    writeFileSync(this.keychainStorePath(), JSON.stringify(store), { mode: 0o600 });
    chmodSync(this.keychainStorePath(), 0o600);
  }
}

function localKeychainKey(service: string, account?: string): string {
  return `${service}\u0000${account ?? ""}`;
}

export function discoverLanguageServer(
  opts: LanguageServerDiscoveryOptions,
): LanguageServerDiscovery | null {
  return discoverLanguageServerFromCommandLines(readLinuxProcCommandLines(), opts);
}

export function discoverLanguageServerFromCommandLines(
  commandLines: string[][],
  opts: LanguageServerDiscoveryOptions,
): LanguageServerDiscovery | null {
  const processName = opts.processName?.trim();
  const markers = (opts.markers ?? []).map((marker) => marker.trim()).filter(Boolean);
  const csrfFlag = opts.csrfFlag?.trim();
  const portFlag = opts.portFlag?.trim();

  for (const argv of commandLines) {
    if (!argvMatchesDiscovery(argv, processName, markers)) {
      continue;
    }
    const port = portFlag ? readFlagPort(argv, portFlag) : null;
    if (port === null) {
      continue;
    }
    return {
      csrf: csrfFlag ? readFlagValue(argv, csrfFlag) ?? "" : "",
      extensionPort: port,
      ports: [port],
    };
  }

  return null;
}

function readLinuxProcCommandLines(): string[][] {
  if (process.platform !== "linux") return [];
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return [];
  }

  const commandLines: string[][] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const text = readFileSync(`/proc/${entry}/cmdline`, "utf8");
      const argv = text.split("\0").filter(Boolean);
      if (argv.length > 0) commandLines.push(argv);
    } catch {
      continue;
    }
  }
  return commandLines;
}

function argvMatchesDiscovery(argv: string[], processName: string | undefined, markers: string[]): boolean {
  const joined = argv.join(" ").toLowerCase();
  if (processName) {
    const processMatch = argv.some((arg) => basename(arg).toLowerCase().includes(processName.toLowerCase()));
    if (!processMatch) return false;
  }
  if (markers.length === 0) return true;
  return markers.some((marker) => joined.includes(marker.toLowerCase()));
}

function readFlagPort(argv: string[], flag: string): number | null {
  const value = readFlagValue(argv, flag);
  if (!value) return null;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function readFlagValue(argv: string[], flag: string): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === flag) {
      const value = argv[index + 1];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    }
    const prefix = `${flag}=`;
    if (typeof arg === "string" && arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length).trim();
      return value || null;
    }
  }
  return null;
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

export function runPluginCcusageQuery(
  opts: PluginCcusageQueryOptions,
  pluginId?: string,
): PluginCcusageQueryResult {
  const provider = resolvePluginCcusageProvider(opts.provider, pluginId);
  const args = [provider, "daily", "--json"];
  if (opts.since) args.push("--since", opts.since);
  if (opts.until) args.push("--until", opts.until);

  let sawRunnableCommand = false;
  for (const runner of ["bunx", "npx"] as const) {
    const env = ccusageEnvForProvider(provider, opts.homePath ?? opts.claudePath);
    let proc: ReturnType<typeof Bun.spawnSync>;
    try {
      proc = Bun.spawnSync([runner, "ccusage", ...args], {
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch {
      continue;
    }
    sawRunnableCommand = true;
    if (proc.exitCode !== 0) {
      continue;
    }
    const daily = dailyRowsFromCcusagePayload(
      parseCcusageJsonPayload(Buffer.from(proc.stdout).toString("utf8")),
    );
    if (daily) {
      return { status: "ok", data: { daily } };
    }
  }

  return { status: sawRunnableCommand ? "runner_failed" : "no_runner", data: null };
}

function resolvePluginCcusageProvider(
  provider: PluginCcusageQueryOptions["provider"],
  pluginId?: string,
): "claude" | "codex" {
  if (provider === "codex" || pluginId === "codex") return "codex";
  return "claude";
}

function ccusageEnvForProvider(
  provider: "claude" | "codex",
  homePath?: string,
): Record<string, string | undefined> {
  if (!homePath) return process.env;
  const env = { ...process.env };
  if (provider === "codex") {
    env.CODEX_HOME = expandHome(homePath);
  } else {
    env.CLAUDE_CONFIG_DIR = expandHome(homePath);
  }
  return env;
}

function dailyRowsFromCcusagePayload(value: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) {
    return null;
  }
  if (Array.isArray(value.daily)) {
    return value.daily.filter(isRecord);
  }
  if (isRecord(value.data)) {
    return dailyRowsFromCcusagePayload(value.data);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  if (opts.dangerouslyIgnoreTls && isLoopbackUrl(opts.url)) {
    lines.push("insecure");
  }
  for (const [key, value] of Object.entries(opts.headers ?? {})) {
    lines.push(`header = "${curlQuote(`${key}: ${value}`)}"`);
  }
  if (opts.bodyText !== undefined) {
    lines.push(`data-raw = "${curlQuote(opts.bodyText)}"`);
  }
  return `${lines.join("\n")}\n`;
}

function isLoopbackUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function parseCurlIncludeOutput(output: string): PluginRequestResponse {
  const statusMatches = [...output.matchAll(/^HTTP\/\d(?:\.\d)?\s+\d+/gm)];
  const finalStatus = statusMatches.at(-1);
  if (!finalStatus || finalStatus.index === undefined) {
    throw new Error("Plugin HTTP response was malformed.");
  }

  const finalResponse = output.slice(finalStatus.index);
  const separatorMatch = finalResponse.match(/\r?\n\r?\n/);
  const headerBlock = separatorMatch
    ? finalResponse.slice(0, separatorMatch.index)
    : finalResponse;
  const bodyText = separatorMatch
    ? finalResponse.slice((separatorMatch.index ?? 0) + separatorMatch[0].length)
    : "";

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

function querySqlite(databasePath: string, sql: string, homeDir = resolveHomeDir()): string {
  rejectSqliteDotCommand(sql);
  const db = new Database(expandHome(databasePath, homeDir), { readonly: true, create: false });
  try {
    return JSON.stringify(db.query(sql).all());
  } finally {
    db.close();
  }
}

function execSqlite(databasePath: string, sql: string, homeDir = resolveHomeDir()): void {
  rejectSqliteDotCommand(sql);
  const target = expandHome(databasePath, homeDir);
  if (!existsSync(target)) {
    throw new Error("SQLite database does not exist.");
  }
  const db = new Database(target);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

function rejectSqliteDotCommand(sql: string): void {
  if (String(sql).trimStart().startsWith(".")) {
    throw new Error("SQLite dot-commands are not supported.");
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

function expandHome(path: string, homeDir = resolveHomeDir()): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return join(homeDir, path.slice(2));
  return path;
}

function resolveHomeDir(): string {
  const home = process.env.HOME;
  return typeof home === "string" && home.trim() ? home : homedir();
}
