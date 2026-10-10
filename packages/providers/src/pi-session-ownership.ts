// Ported from robinebers/openusage bb7de176def23a99bbdcaabe1ac7269f18c738be.
// Copyright (c) 2026 Robin Ebers. MIT license: see repository LICENSE.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderAccount } from "../../core/src/types";
import { expandHome } from "./providers/openusage-plugin-runtime";
import { piAgentDirectory } from "./providers/pi-session-usage";

const reported = new Set<string>();

export function piSessionTokenOwnerIds(
  accounts: ProviderAccount[],
  homeDir: string,
  env: Record<string, string | undefined>,
): Set<string> {
  const owners = new Set<string>();
  const claude = accounts.filter((account) => account.providerId === "claude-code");
  if (claude.length === 0) owners.add("claude-code");
  else warnOnce(`claude|${homeDir}`, "Pi Claude usage is unattributed with configured accounts; usage skipped.");
  const codex = accounts.filter((account) => account.providerId === "codex");
  if (codex.length === 0) owners.add("codex");
  else if (codex.length === 1) owners.add(codex[0]!.id);
  else {
    const agentDir = piAgentDirectory(homeDir, env);
    const auth = readObject(join(agentDir, "auth.json"));
    const entry = auth?.["openai-codex"];
    const identity = isObject(entry) && entry.type === "oauth" && nonempty(entry.access)
      ? nonempty(entry.accountId) : undefined;
    const matches = identity ? codex.filter((account) => {
      const tokens = readObject(join(expandHome(account.homePath, homeDir), "auth.json"))?.tokens;
      return isObject(tokens) && nonempty(tokens.account_id) === identity;
    }) : [];
    const owner = matches.sort((left, right) => left.id.localeCompare(right.id))[0];
    if (owner) owners.add(owner.id);
    else warnOnce(`codex|${agentDir}|${codex.map((account) => account.id).sort().join("|")}`,
      "Pi Codex usage has no matching configured account; usage skipped.");
  }
  return owners;
}

function readObject(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (isObject(value)) return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
  }
  warnOnce(`auth|${path}`, "Pi usage ownership authentication could not be read; account skipped.");
  return null;
}

function warnOnce(key: string, message: string): void {
  if (reported.has(key)) return;
  reported.add(key);
  console.warn(message);
}

function nonempty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
