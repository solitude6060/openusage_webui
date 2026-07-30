import { detectProviderAccounts } from "./account-detect";

/** @deprecated Prefer detectProviderAccounts("codex") */
export interface CodexHomeCandidate {
  homePath: string;
  label: string;
  hasAuth: boolean;
}

/** @deprecated Prefer detectProviderAccounts("codex") */
export function detectCodexHomes(options: {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): CodexHomeCandidate[] {
  return detectProviderAccounts("codex", options).map(({ homePath, label, hasAuth }) => ({
    homePath,
    label,
    hasAuth,
  }));
}
