import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  isMultiAccountProviderId,
  MULTI_ACCOUNT_PROVIDER_CAPABILITIES,
  type MultiAccountProviderId,
} from "../../core/src/types";
import { querySqlite } from "./providers/openusage-plugin-runtime";

const ANTIGRAVITY_OAUTH_TOKEN_KEY = "antigravityUnifiedStateSync.oauthToken";

export interface AccountHomeCandidate {
  providerId: MultiAccountProviderId;
  homePath: string;
  label: string;
  hasAuth: boolean;
  /** Signed-in account, when the home records it (Antigravity only). */
  email?: string;
}

function expandHome(path: string, homeDir = homedir()): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return join(homeDir, path.slice(2));
  return path;
}

function pushUnique(
  candidates: Array<{ homePath: string; label: string }>,
  homePath: string,
  label: string,
): void {
  if (!candidates.some((candidate) => candidate.homePath === homePath)) {
    candidates.push({ homePath, label });
  }
}

function detectCodexHomes(options: {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): AccountHomeCandidate[] {
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  const candidates: Array<{ homePath: string; label: string }> = [
    { homePath: join(homeDir, ".codex"), label: "Codex · Local" },
    { homePath: join(homeDir, ".config", "codex"), label: "Codex · Config" },
  ];

  const envHome = env.CODEX_HOME?.trim();
  if (envHome) {
    pushUnique(candidates, expandHome(envHome, homeDir), "Codex · CODEX_HOME");
  }

  return candidates
    .map((candidate) => ({
      providerId: "codex" as const,
      ...candidate,
      hasAuth: existsSync(join(candidate.homePath, "auth.json")),
    }))
    .filter((candidate) => candidate.hasAuth);
}

function detectClaudeHomes(options: {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): AccountHomeCandidate[] {
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  const candidates: Array<{ homePath: string; label: string }> = [
    { homePath: join(homeDir, ".claude"), label: "Claude · Local" },
  ];

  const envHome = env.CLAUDE_CONFIG_DIR?.trim();
  if (envHome) {
    pushUnique(candidates, expandHome(envHome, homeDir), "Claude · CLAUDE_CONFIG_DIR");
  }

  return candidates
    .map((candidate) => ({
      providerId: "claude-code" as const,
      ...candidate,
      hasAuth:
        existsSync(join(candidate.homePath, ".credentials.json")) ||
        existsSync(join(candidate.homePath, "credentials.json")),
    }))
    .filter((candidate) => candidate.hasAuth);
}

function cursorStateDb(configDir: string): string {
  return join(configDir, "User", "globalStorage", "state.vscdb");
}

function antigravityStateHasOAuth(configDir: string): boolean {
  const dbPath = cursorStateDb(configDir);
  if (!existsSync(dbPath)) return false;
  try {
    const parsed = JSON.parse(querySqlite(
      dbPath,
      `SELECT value FROM ItemTable WHERE key = '${ANTIGRAVITY_OAUTH_TOKEN_KEY}' LIMIT 1`,
    )) as unknown;
    return Array.isArray(parsed) && parsed.some((row) => {
      if (!row || typeof row !== "object") return false;
      const value = (row as { value?: unknown }).value;
      return typeof value === "string" && value.length > 0;
    });
  } catch (error) {
    console.warn(
      `[openusage] failed to read Antigravity IDE oauth key: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

function antigravityCliEmail(homePath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(antigravityCliOauthPath(homePath), "utf8")) as { id_token?: unknown };
    if (typeof parsed.id_token !== "string") return undefined;
    const payload = JSON.parse(Buffer.from(parsed.id_token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload?.email === "string" && payload.email ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

function antigravityIdeEmail(configDir: string): string | undefined {
  try {
    const rows = JSON.parse(querySqlite(
      cursorStateDb(configDir),
      "SELECT value FROM ItemTable WHERE key = 'antigravityAuthStatus' LIMIT 1",
    )) as Array<{ value?: unknown }>;
    const value = rows[0]?.value;
    const email = typeof value === "string" ? (JSON.parse(value) as { email?: unknown }).email : undefined;
    return typeof email === "string" && email ? email : undefined;
  } catch {
    return undefined;
  }
}

function detectCursorHomes(options: {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): AccountHomeCandidate[] {
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  const candidates: Array<{ homePath: string; label: string }> = [
    { homePath: join(homeDir, ".config", "Cursor"), label: "Cursor · Local" },
    {
      homePath: join(homeDir, "Library", "Application Support", "Cursor"),
      label: "Cursor · Application Support",
    },
  ];

  const envHome = env.OPENUSAGE_CURSOR_CONFIG_DIR?.trim();
  if (envHome) {
    pushUnique(candidates, expandHome(envHome, homeDir), "Cursor · Config Dir");
  }

  return candidates
    .map((candidate) => ({
      providerId: "cursor" as const,
      ...candidate,
      hasAuth: existsSync(cursorStateDb(candidate.homePath)),
    }))
    .filter((candidate) => candidate.hasAuth);
}

export function antigravityCliOauthPath(homePath: string): string {
  return join(homePath, ".gemini", "antigravity-cli", "antigravity-oauth-token");
}

export function looksLikeAntigravityCliHome(homePath: string): boolean {
  if (existsSync(antigravityCliOauthPath(homePath))) return true;
  const normalized = homePath.replace(/\\/g, "/");
  if (normalized.includes("/.agy-homes/") || normalized.endsWith("/.agy-homes")) return true;
  if (normalized.includes("/User/globalStorage")) return false;
  if (/\/Antigravity(\s+IDE)?\/?$/i.test(normalized)) return false;
  if (normalized.includes("Application Support/Antigravity")) return false;
  return true;
}

function antigravityDetectLabel(baseLabel: string): string {
  return baseLabel;
}

function detectAntigravityHomes(options: {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): AccountHomeCandidate[] {
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  const candidates: Array<{ homePath: string; label: string }> = [
    {
      homePath: join(homeDir, ".config", "Antigravity"),
      label: "Antigravity · Local",
    },
    {
      homePath: join(homeDir, ".config", "Antigravity IDE"),
      label: "Antigravity · IDE Local",
    },
    {
      homePath: join(homeDir, "Library", "Application Support", "Antigravity"),
      label: "Antigravity · Application Support",
    },
    {
      homePath: join(homeDir, "Library", "Application Support", "Antigravity IDE"),
      label: "Antigravity · IDE Application Support",
    },
    // Default `agy` (no wrapper) stores oauth under the real HOME.
    { homePath: homeDir, label: "Antigravity · Local CLI" },
  ];

  const agyHomesRoot = join(homeDir, ".agy-homes");
  if (existsSync(agyHomesRoot)) {
    try {
      for (const entry of readdirSync(agyHomesRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const profileHome = join(agyHomesRoot, entry.name);
        pushUnique(candidates, profileHome, `Antigravity · ${entry.name}`);
      }
    } catch (error) {
      console.warn(
        `[openusage] failed to read Antigravity CLI homes under ${agyHomesRoot}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (const envName of [
    "OPENUSAGE_ANTIGRAVITY_CLI_HOME",
    "OPENUSAGE_ANTIGRAVITY_CONFIG_DIR",
  ] as const) {
    const envHome = env[envName]?.trim();
    if (!envHome) continue;
    pushUnique(
      candidates,
      expandHome(envHome, homeDir),
      `Antigravity · ${envName}`,
    );
  }

  return candidates
    .map((candidate) => {
      const isCli = looksLikeAntigravityCliHome(candidate.homePath);
      const hasAuth = isCli
        ? existsSync(antigravityCliOauthPath(candidate.homePath))
        : antigravityStateHasOAuth(candidate.homePath);
      const email = !hasAuth
        ? undefined
        : isCli ? antigravityCliEmail(candidate.homePath) : antigravityIdeEmail(candidate.homePath);
      return {
        providerId: "antigravity" as const,
        homePath: candidate.homePath,
        label: antigravityDetectLabel(candidate.label),
        hasAuth,
        ...(email ? { email } : {}),
      };
    })
    .filter((candidate) => candidate.hasAuth);
}

/** @deprecated Prefer detectProviderAccounts("codex") */
export function detectCodexHomesLegacy(
  options: { homeDir?: string; env?: NodeJS.ProcessEnv } = {},
): Array<{ homePath: string; label: string; hasAuth: boolean }> {
  return detectCodexHomes(options).map(({ homePath, label, hasAuth }) => ({
    homePath,
    label,
    hasAuth,
  }));
}

export function listMultiAccountCapabilities() {
  return MULTI_ACCOUNT_PROVIDER_CAPABILITIES;
}

export function detectProviderAccounts(
  providerId: string,
  options: { homeDir?: string; env?: NodeJS.ProcessEnv } = {},
): AccountHomeCandidate[] {
  if (!isMultiAccountProviderId(providerId)) {
    throw new Error(`Provider does not support multiple accounts: ${providerId}`);
  }
  if (providerId === "codex") return detectCodexHomes(options);
  if (providerId === "claude-code") return detectClaudeHomes(options);
  if (providerId === "cursor") return detectCursorHomes(options);
  if (providerId === "antigravity") return detectAntigravityHomes(options);
  return [];
}

export function homeEnvForProvider(providerId: MultiAccountProviderId): string {
  const capability = MULTI_ACCOUNT_PROVIDER_CAPABILITIES.find(
    (item) => item.providerId === providerId,
  );
  if (!capability) {
    throw new Error(`Missing home env mapping for ${providerId}`);
  }
  return capability.homeEnvVar;
}

/** Inject the env vars a plugin expects for a configured account home. */
export function applyProviderHomeEnv(
  providerEnv: NodeJS.ProcessEnv,
  providerId: MultiAccountProviderId,
  homePath: string,
): void {
  if (providerId === "antigravity") {
    if (looksLikeAntigravityCliHome(homePath)) {
      providerEnv.OPENUSAGE_ANTIGRAVITY_CLI_HOME = homePath;
      delete providerEnv.OPENUSAGE_ANTIGRAVITY_CONFIG_DIR;
    } else {
      providerEnv.OPENUSAGE_ANTIGRAVITY_CONFIG_DIR = homePath;
      delete providerEnv.OPENUSAGE_ANTIGRAVITY_CLI_HOME;
    }
    return;
  }
  if (providerId === "cursor") {
    providerEnv.OPENUSAGE_CURSOR_CONFIG_DIR = homePath;
    // Account homePath is a config root; an ambient STATE_DB must not override it.
    delete providerEnv.OPENUSAGE_CURSOR_STATE_DB;
    return;
  }
  providerEnv[homeEnvForProvider(providerId)] = homePath;
}
