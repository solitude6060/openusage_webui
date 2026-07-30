import { existsSync } from "node:fs";
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
    const expanded = expandHome(envHome, homeDir);
    if (!candidates.some((candidate) => candidate.homePath === expanded)) {
      candidates.push({ homePath: expanded, label: "Codex · CODEX_HOME" });
    }
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
    const expanded = expandHome(envHome, homeDir);
    if (!candidates.some((candidate) => candidate.homePath === expanded)) {
      candidates.push({ homePath: expanded, label: "Claude · CLAUDE_CONFIG_DIR" });
    }
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
