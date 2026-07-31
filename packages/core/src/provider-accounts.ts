/** Base providers that support multiple home/account instances in WebUI. */
export const MULTI_ACCOUNT_PROVIDER_IDS = [
  "codex",
  "claude-code",
  "cursor",
  "antigravity",
] as const;

export type MultiAccountProviderId = (typeof MULTI_ACCOUNT_PROVIDER_IDS)[number];

export interface ProviderAccount {
  id: string;
  providerId: MultiAccountProviderId;
  label: string;
  homePath: string;
  enabled: boolean;
  sortOrder: number;
}

export interface MultiAccountProviderCapability {
  providerId: MultiAccountProviderId;
  name: string;
  homeEnvVar: string;
  homeLabel: string;
}

export const MULTI_ACCOUNT_PROVIDER_CAPABILITIES: MultiAccountProviderCapability[] = [
  {
    providerId: "codex",
    name: "Codex",
    homeEnvVar: "CODEX_HOME",
    homeLabel: "Codex Home",
  },
  {
    providerId: "claude-code",
    name: "Claude Code",
    homeEnvVar: "CLAUDE_CONFIG_DIR",
    homeLabel: "Claude Config Dir",
  },
  {
    providerId: "cursor",
    name: "Cursor",
    homeEnvVar: "OPENUSAGE_CURSOR_CONFIG_DIR",
    homeLabel: "Cursor Config Dir",
  },
  {
    providerId: "antigravity",
    name: "Antigravity",
    homeEnvVar: "OPENUSAGE_ANTIGRAVITY_CLI_HOME / OPENUSAGE_ANTIGRAVITY_CONFIG_DIR",
    homeLabel: "Antigravity CLI Overlay Or IDE Config Dir",
  },
];

const MULTI_ACCOUNT_PROVIDER_ID_SET = new Set<string>(MULTI_ACCOUNT_PROVIDER_IDS);

export function isMultiAccountProviderId(value: string): value is MultiAccountProviderId {
  return MULTI_ACCOUNT_PROVIDER_ID_SET.has(value);
}

/** Account ids look like `codex:local` or `claude-code:family`. */
export function isProviderAccountId(value: string): boolean {
  const match = /^([a-z0-9-]+):([a-z0-9][a-z0-9-]{0,62})$/.exec(value);
  if (!match) return false;
  return isMultiAccountProviderId(match[1]);
}

export function providerIdFromAccountId(accountId: string): MultiAccountProviderId | null {
  const match = /^([a-z0-9-]+):/.exec(accountId);
  if (!match || !isMultiAccountProviderId(match[1])) return null;
  return match[1];
}

export function slugifyAccountLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/^(codex|claude(?:\s*code)?|cursor|antigravity|agy)\s*[\s·\-_:]+\s*/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "home";
}

export function buildProviderAccountId(
  providerId: MultiAccountProviderId,
  label: string,
  existingIds: Iterable<string>,
): string {
  const base = slugifyAccountLabel(label);
  const taken = new Set(existingIds);
  let candidate = `${providerId}:${base}`;
  let suffix = 2;
  while (taken.has(candidate) || candidate === providerId) {
    candidate = `${providerId}:${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/** @deprecated Use ProviderAccount / isProviderAccountId */
export type CodexInstance = ProviderAccount;

/** @deprecated Use isProviderAccountId */
export function isCodexInstanceId(value: string): boolean {
  return isProviderAccountId(value) && value.startsWith("codex:");
}

/** @deprecated Use slugifyAccountLabel */
export function slugifyCodexLabel(label: string): string {
  return slugifyAccountLabel(label);
}

/** @deprecated Use buildProviderAccountId */
export function buildCodexInstanceId(slug: string, existingIds: Iterable<string>): string {
  return buildProviderAccountId("codex", slug, existingIds);
}

export const CODEX_INSTANCE_ID_PATTERN = /^codex:[a-z0-9][a-z0-9-]{0,62}$/;
