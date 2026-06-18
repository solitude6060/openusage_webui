import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import type { ProviderId, UsageRecord } from "../../../core/src/types";
import {
  createBase64Api,
  createFormatApi,
  createJwtApi,
  createLineApi,
  createUtilApi,
  normalizePluginResult,
} from "./openusage-plugin-api";
import {
  decryptAes256Gcm,
  discoverLanguageServer,
  encryptAes256Gcm,
  execSqlite,
  expandHome,
  normalizeHomeDir,
  querySqlite,
  runPluginCcusageQuery,
  runPluginHttpRequest,
  type LanguageServerDiscoveryOptions,
  type PluginCcusageQueryOptions,
  type PluginCcusageQueryResult,
  type PluginCcusageRunner,
  type PluginRequestOptions,
  type PluginRequestResponse,
} from "./openusage-plugin-runtime";
import type { UsageProvider } from "../types";

export {
  discoverLanguageServer,
  discoverLanguageServerFromCommandLines,
  runPluginCcusageQuery,
  runPluginHttpRequest,
  type LanguageServerDiscovery,
  type LanguageServerDiscoveryOptions,
  type PluginCcusageQueryOptions,
  type PluginCcusageQueryResult,
  type PluginCcusageRunner,
  type PluginHttpRunner,
  type PluginRequestOptions,
  type PluginRequestResponse,
} from "./openusage-plugin-runtime";

export interface OpenUsagePluginProviderOptions {
  providerId: ProviderId;
  name: string;
  pluginId?: string;
  scriptPath?: string;
  scriptText?: string;
  env?: Record<string, string | undefined>;
  request?: (opts: PluginRequestOptions) => PluginRequestResponse;
  ccusageQuery?: (opts: PluginCcusageQueryOptions) => PluginCcusageQueryResult;
  ccusageRunner?: PluginCcusageRunner;
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
    this.now = options.now ?? (() => new Date().toISOString());
    this.homeDir = normalizeHomeDir(options.homeDir);
    this.requestImpl = options.request ?? runPluginHttpRequest;
    this.ccusageQueryImpl =
      options.ccusageQuery ??
      ((opts) => runPluginCcusageQuery(opts, this.pluginId, this.homeDir, options.ccusageRunner));
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
              const localToken = this.readLocalKeychainPassword(service, account);
              if (localToken !== null) return localToken;
              const gitHubToken = this.readGitHubToken();
              if (gitHubToken !== null) return gitHubToken;
              throw keychainItemNotFound(service);
            }
            return this.readRequiredLocalKeychainPassword(service, account);
          },
          readGenericPasswordForCurrentUser: (service: string) =>
            this.readRequiredLocalKeychainPassword(service, this.currentKeychainAccount()),
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
        env: { ...process.env, ...this.env, HOME: this.homeDir },
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
    return typeof value === "string" && value.trim() ? value : null;
  }

  private readRequiredLocalKeychainPassword(service: string, account?: string): string {
    const value = this.readLocalKeychainPassword(service, account);
    if (value !== null) return value;
    throw keychainItemNotFound(service);
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

function keychainItemNotFound(service: string): Error {
  return new Error(`Keychain item not found: ${service}`);
}
