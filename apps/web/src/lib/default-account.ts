export const ANTIGRAVITY_DEFAULT_LABEL = "Antigravity · Local CLI";
export const ANTIGRAVITY_DEFAULT_HOME = "~";

function canonicalHome(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return trimmed || ANTIGRAVITY_DEFAULT_HOME;
}

function pointsAtDefaultHome(homePath: string, defaultHomes: string[]): boolean {
  const home = canonicalHome(homePath);
  return defaultHomes.some((candidate) => canonicalHome(candidate) === home);
}

export function defaultHomeCandidates(databasePath?: string | null): string[] {
  const homes = [ANTIGRAVITY_DEFAULT_HOME];
  if (!databasePath) return homes;
  const normalized = databasePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const suffix = "/.openusage-webui/openusage.sqlite";
  if (!normalized.endsWith(suffix)) return homes;
  const home = normalized.slice(0, -suffix.length);
  if (home) homes.push(home);
  return homes;
}

export function shouldShowDefaultAccountNotice(
  providerId: string,
  accounts: Array<{ homePath: string; enabled: boolean }>,
  defaultHomes: string[],
): boolean {
  if (providerId !== "antigravity") return false;
  const enabled = accounts.filter((account) => account.enabled);
  if (enabled.length === 0) return false;
  return !enabled.some((account) => pointsAtDefaultHome(account.homePath, defaultHomes));
}

export function initialAccountProviderId(
  capabilities: Array<{ providerId: string }>,
  accounts: Array<{ providerId: string }>,
): string {
  const match = capabilities.find((capability) =>
    accounts.some((account) => account.providerId === capability.providerId),
  );
  return match?.providerId ?? capabilities[0]?.providerId ?? "codex";
}
