import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseCcusageJsonPayload } from "./ccusage-parser";

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

export type PluginCcusageRunner = (
  command: "bunx" | "npx",
  args: string[],
  env: Record<string, string | undefined>,
) => {
  exitCode: number;
  stdout: string | Uint8Array;
  stderr: string | Uint8Array;
};

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
  homeDir = resolveHomeDir(),
  commandRunner?: PluginCcusageRunner,
): PluginCcusageQueryResult {
  const provider = resolvePluginCcusageProvider(opts.provider, pluginId);
  const args = [provider, "daily", "--json"];
  if (opts.since) args.push("--since", opts.since);
  if (opts.until) args.push("--until", opts.until);

  let sawRunnableCommand = false;
  for (const runner of ["bunx", "npx"] as const) {
    const env = ccusageEnvForProvider(provider, opts.homePath ?? opts.claudePath, homeDir);
    let proc: ReturnType<typeof Bun.spawnSync> | ReturnType<PluginCcusageRunner>;
    try {
      proc = commandRunner
        ? commandRunner(runner, ["ccusage", ...args], env)
        : Bun.spawnSync([runner, "ccusage", ...args], {
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
      parseCcusageJsonPayload(outputToString(proc.stdout)),
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
  homeDir = resolveHomeDir(),
): Record<string, string | undefined> {
  const env = { ...process.env, HOME: homeDir };
  if (!homePath) return env;
  if (provider === "codex") {
    env.CODEX_HOME = expandHome(homePath, homeDir);
  } else {
    env.CLAUDE_CONFIG_DIR = expandHome(homePath, homeDir);
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

function outputToString(output: string | Uint8Array): string {
  return typeof output === "string" ? output : Buffer.from(output).toString("utf8");
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

export function querySqlite(databasePath: string, sql: string, homeDir = resolveHomeDir()): string {
  rejectSqliteDotCommand(sql);
  const db = new Database(expandHome(databasePath, homeDir), { readonly: true, create: false });
  try {
    return JSON.stringify(db.query(sql).all());
  } finally {
    db.close();
  }
}

export function execSqlite(databasePath: string, sql: string, homeDir = resolveHomeDir()): void {
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

export function encryptAes256Gcm(plaintext: string, keyB64: string): string {
  const key = Buffer.from(String(keyB64).trim(), "base64");
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptAes256Gcm(envelope: string, keyB64: string): string {
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

export function expandHome(path: string, homeDir = resolveHomeDir()): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return join(homeDir, path.slice(2));
  return path;
}

export function resolveHomeDir(): string {
  const home = process.env.HOME;
  return typeof home === "string" && home.trim() ? home : homedir();
}

export function normalizeHomeDir(homeDir: string | undefined): string {
  return typeof homeDir === "string" && homeDir.trim() ? homeDir.trim() : resolveHomeDir();
}
