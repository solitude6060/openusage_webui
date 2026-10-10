import { describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import type { ProviderAccount } from "../../core/src/types";
import { OpenUsagePluginProvider } from "../src/providers/openusage-plugin";
import { getProviders } from "../src/registry";
import { withIsolatedHome, writeJson } from "./openusage-plugin-fixture-helpers";

function account(home: string, name: string, base: "codex" | "claude-code" = "codex", enabled = true): ProviderAccount {
  return { id: `${base}:${name}`, providerId: base, label: name, homePath: join(home, name), enabled, sortOrder: 0 };
}

function claims(home: string, accounts: ProviderAccount[], env: Record<string, string | undefined> = {}): string[] {
  return getProviders({ providerAccounts: accounts, env: { HOME: home, ...env } })
    .filter((provider) => (provider as OpenUsagePluginProvider & { recordPiSessionTokens: boolean }).recordPiSessionTokens
      && (provider.id.startsWith("codex") || provider.id.startsWith("claude-code")))
    .map((provider) => provider.id);
}

function piLogin(home: string, identity: string, path = ".pi/agent/auth.json"): void {
  writeJson(join(home, path), { "openai-codex": { type: "oauth", access: "PRIVATE_ACCESS_FIXTURE", accountId: identity } });
}

describe("Pi usage account ownership", () => {
  test("default Claude and a single Codex provider claim Pi usage without requiring a Pi login", async () => {
    await withIsolatedHome((home) => {
      expect(claims(home, [])).toEqual(["claude-code", "codex"]);
      expect(claims(home, [account(home, "work")])).toEqual(["claude-code", "codex:work"]);
    });
  });

  test("only the matching Codex account claims usage among several homes", async () => {
    await withIsolatedHome((home) => {
      piLogin(home, "primary");
      writeJson(join(home, "work/auth.json"), { tokens: { account_id: "primary" } });
      writeJson(join(home, "family/auth.json"), { tokens: { account_id: "family" } });
      const accounts = [account(home, "family"), account(home, "work")];
      expect(claims(home, accounts)).toEqual(["claude-code", "codex:work"]);
      piLogin(home, "family");
      expect(claims(home, accounts)).toEqual(["claude-code", "codex:family"]);
    });
  });

  test("Pi config override governs auth, while the session override does not", async () => {
    await withIsolatedHome((home) => {
      piLogin(home, "wrong");
      piLogin(home, "primary", "custom/auth.json");
      writeJson(join(home, "work/auth.json"), { tokens: { account_id: "primary" } });
      writeJson(join(home, "family/auth.json"), { tokens: { account_id: "family" } });
      expect(claims(home, [account(home, "family"), account(home, "work")], {
        PI_CODING_AGENT_DIR: " ~/custom/ ", PI_CODING_AGENT_SESSION_DIR: "~/unrelated-sessions",
      })).toEqual(["claude-code", "codex:work"]);
    });
  });

  test("ignores pool logins and incomplete/non-OAuth base entries", async () => {
    await withIsolatedHome((home) => {
      writeJson(join(home, "work/auth.json"), { tokens: { account_id: "primary" } });
      writeJson(join(home, "family/auth.json"), { tokens: { account_id: "family" } });
      const log = spyOn(console, "warn").mockImplementation(() => {});
      try {
        for (const entry of [undefined, { type: "api_key", accountId: "primary" },
          { type: "oauth", accountId: "primary" }, { type: "oauth", access: "", accountId: "primary" }]) {
          writeJson(join(home, ".pi/agent/auth.json"), {
            "openai-codex": entry, "openai-codex-2": { type: "oauth", access: "PRIVATE_ACCESS_FIXTURE", accountId: "primary" },
          });
          expect(claims(home, [account(home, "work"), account(home, "family")])).toEqual(["claude-code"]);
        }
        expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_ACCESS_FIXTURE");
      } finally { log.mockRestore(); }
    });
  });

  test("no matching account produces no Codex owner and logs once", async () => {
    await withIsolatedHome((home) => {
      piLogin(home, "unmatched");
      const accounts = [account(home, "work"), account(home, "family")];
      const log = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(claims(home, accounts)).toEqual(["claude-code"]);
        expect(claims(home, accounts)).toEqual(["claude-code"]);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith("Pi Codex usage has no matching configured account; usage skipped.");
        expect(JSON.stringify(log.mock.calls)).not.toContain("unmatched");
      } finally { log.mockRestore(); }
    });
  });

  test("configured Claude homes do not receive unattributed usage and log once", async () => {
    await withIsolatedHome((home) => {
      const accounts = [account(home, "work", "claude-code"), account(home, "family", "claude-code")];
      const log = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(claims(home, accounts)).toEqual(["codex"]);
        expect(claims(home, accounts)).toEqual(["codex"]);
        expect(log).toHaveBeenCalledTimes(1);
        expect(claims(home, [accounts[0]!])).toEqual(["codex"]);
      } finally { log.mockRestore(); }
    });
  });

  test("does not reassign usage from a disabled matching account", async () => {
    await withIsolatedHome((home) => {
      piLogin(home, "primary");
      writeJson(join(home, "work/auth.json"), { tokens: { account_id: "primary" } });
      writeJson(join(home, "family/auth.json"), { tokens: { account_id: "family" } });
      expect(claims(home, [account(home, "work", "codex", false), account(home, "family")])).toEqual(["claude-code"]);
      expect(claims(home, [account(home, "work", "claude-code", false)])).toEqual(["codex"]);
    });
  });

  test("selects one owner deterministically when duplicate homes have the same identity", async () => {
    await withIsolatedHome((home) => {
      piLogin(home, "primary");
      writeJson(join(home, "work/auth.json"), { tokens: { account_id: "primary" } });
      writeJson(join(home, "family/auth.json"), { tokens: { account_id: "primary" } });
      expect(claims(home, [account(home, "work"), account(home, "family")])).toEqual(["claude-code", "codex:family"]);
    });
  });
});
