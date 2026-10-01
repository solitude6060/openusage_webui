import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";

export interface CodexSessionHome {
  id: string;
  homePath: string;
}

interface ResolvedSessionHome extends CodexSessionHome {
  realPath: string;
  symlink: boolean;
}

function resolveSessionHome(account: CodexSessionHome): ResolvedSessionHome | null {
  const sessionsPath = join(account.homePath, "sessions");
  try {
    const stat = lstatSync(sessionsPath);
    return {
      ...account,
      realPath: realpathSync(sessionsPath),
      symlink: stat.isSymbolicLink(),
    };
  } catch {
    return null;
  }
}

function selectOwner(group: ResolvedSessionHome[]): ResolvedSessionHome {
  const directories = group.filter((home) => !home.symlink);
  const pool = directories.length > 0 ? directories : group;
  return [...pool].sort((left, right) => left.id.localeCompare(right.id))[0];
}

function sessionGroups(accounts: CodexSessionHome[]): Map<string, ResolvedSessionHome[]> {
  const groups = new Map<string, ResolvedSessionHome[]>();
  for (const account of accounts) {
    const home = resolveSessionHome(account);
    if (!home) continue;
    const group = groups.get(home.realPath) ?? [];
    group.push(home);
    groups.set(home.realPath, group);
  }
  return groups;
}

export function codexSessionTokenOwnerIds(accounts: CodexSessionHome[]): Set<string> {
  const owners = new Set<string>();
  const grouped = new Set<string>();
  for (const group of sessionGroups(accounts).values()) {
    for (const home of group) grouped.add(home.id);
    owners.add(selectOwner(group).id);
  }
  for (const account of accounts) {
    if (!grouped.has(account.id)) owners.add(account.id);
  }
  return owners;
}

export function codexSharedSessionAccountIds(accounts: CodexSessionHome[]): string[] {
  const ids: string[] = [];
  for (const group of sessionGroups(accounts).values()) {
    if (group.length < 2) continue;
    ids.push(...group.map((home) => home.id));
  }
  return ids.sort((left, right) => left.localeCompare(right));
}

export function codexSessionTokenDuplicateIds(accounts: CodexSessionHome[]): string[] {
  const owners = codexSessionTokenOwnerIds(accounts);
  return accounts
    .filter((account) => resolveSessionHome(account) && !owners.has(account.id))
    .map((account) => account.id)
    .sort((left, right) => left.localeCompare(right));
}
