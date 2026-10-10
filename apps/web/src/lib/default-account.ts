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

export function disabledDefaultAccount<
  T extends { id: string; providerId: string; homePath: string; enabled: boolean },
>(accounts: ReadonlyArray<T>, defaultHomePath?: string | null): T | null {
  const defaultHomes = [ANTIGRAVITY_DEFAULT_HOME];
  if (typeof defaultHomePath === "string" && defaultHomePath.trim()) {
    defaultHomes.push(defaultHomePath);
  }
  return (
    accounts.find(
      (account) =>
        account.providerId === "antigravity" &&
        account.enabled === false &&
        pointsAtDefaultHome(account.homePath, defaultHomes),
    ) ?? null
  );
}

export function shouldShowDefaultAccountNotice(
  accounts: ReadonlyArray<{ providerId: string; homePath: string; enabled: boolean }>,
  defaultHomePath?: string | null,
): boolean {
  const defaultHomes = [ANTIGRAVITY_DEFAULT_HOME];
  if (typeof defaultHomePath === "string" && defaultHomePath.trim()) {
    defaultHomes.push(defaultHomePath);
  }
  const enabled = accounts.filter(
    (account) => account.providerId === "antigravity" && account.enabled,
  );
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
