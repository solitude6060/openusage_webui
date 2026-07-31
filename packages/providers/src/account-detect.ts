import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  isMultiAccountProviderId,
  MULTI_ACCOUNT_PROVIDER_CAPABILITIES,
  type MultiAccountProviderId,
} from "../../core/src/types";

export interface AccountHomeCandidate {
  providerId: MultiAccountProviderId;
  homePath: string;
  label: string;
  hasAuth: boolean;
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
  return normalized.includes("/.agy-homes/") || normalized.endsWith("/.agy-homes");
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
        : existsSync(cursorStateDb(candidate.homePath));
      return {
        providerId: "antigravity" as const,
        homePath: candidate.homePath,
        label: candidate.label,
        hasAuth,
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
