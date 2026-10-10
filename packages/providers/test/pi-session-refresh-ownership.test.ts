import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import type { ProviderAccount } from "../../core/src/types";
import { OpenUsagePluginProvider } from "../src/providers/openusage-plugin";
import { getProviders, resolveBundledPluginScriptPath } from "../src/registry";
import { withIsolatedHome, writeJson } from "./openusage-plugin-fixture-helpers";

const script = `globalThis.__openusage_plugin = { probe() { return { lines: [] }; } };`;

function fixture(home: string): ProviderAccount[] {
  writeJson(join(home, ".pi/agent/sessions/a.jsonl"), {
    type: "message", id: "one", timestamp: new Date().toISOString(),
    message: { role: "assistant", provider: "openai-codex", model: "gpt-6.1-sol",
      usage: { totalTokens: 100, cost: { total: 1 } } },
  });
  return ["work", "family"].map((name, index) => ({ id: `codex:${name}`, providerId: "codex",
    label: name, homePath: join(home, name), enabled: true, sortOrder: index }));
}

function login(home: string, identity: string): void {
  writeJson(join(home, ".pi/agent/auth.json"), {
    "openai-codex": { type: "oauth", access: "PRIVATE_ACCESS_FIXTURE", accountId: identity },
  });
}

function homes(home: string, work: string, family: string): void {
  writeJson(join(home, "work/auth.json"), { tokens: { account_id: work } });
  writeJson(join(home, "family/auth.json"), { tokens: { account_id: family } });
}

describe("Pi ownership on reused providers", () => {
  test.each(["Pi login", "Codex homes", "previously unmatched login"])("refresh rechecks %s", async (change) => {
    await withIsolatedHome(async (home) => {
      const accounts = fixture(home);
      homes(home, "primary", "family");
      login(home, change === "previously unmatched login" ? "unmatched" : "primary");
      const providers = getProviders({ providerAccounts: accounts, env: { HOME: home } })
        .filter((provider) => provider.id.startsWith("codex:")) as OpenUsagePluginProvider[];
      const read = fs.readFileSync;
      const stub = spyOn(fs, "readFileSync").mockImplementation(((path: fs.PathOrFileDescriptor, ...args: unknown[]) =>
        String(path) === resolveBundledPluginScriptPath("codex") ? script : Reflect.apply(read, fs, [path, ...args])) as typeof read);
      const warning = spyOn(console, "warn").mockImplementation(() => {});
      const owners = async () => {
        const records = (await Promise.all(providers.map((provider) => provider.refreshInThread()))).flat();
        return records.filter((record) => record.tool === "Pi Session")
          .map((record) => [record.providerId, record.totalTokens]);
      };
      try {
        expect(await owners()).toEqual(change === "previously unmatched login" ? [] : [["codex:work", 100]]);
        if (change === "Codex homes") homes(home, "other", "primary");
        else login(home, "family");
        expect(await owners()).toEqual([["codex:family", 100]]);
        expect(JSON.stringify(warning.mock.calls)).not.toContain("PRIVATE_ACCESS_FIXTURE");
      } finally {
        stub.mockRestore();
        warning.mockRestore();
      }
    });
  });

  test("refresh worker rechecks login on the same provider instances", async () => {
    await withIsolatedHome(async (home) => {
      const accounts = fixture(home);
      homes(home, "primary", "family");
      login(home, "primary");
      const providers = accounts.map((account) => new OpenUsagePluginProvider({
        providerId: account.id, name: account.label, pluginId: "codex", scriptText: script,
        homeDir: home, env: { HOME: home }, piSessionAccounts: accounts,
      }));
      const owners = async () => (await Promise.all(providers.map((provider) => provider.refresh()))).flat()
        .filter((record) => record.tool === "Pi Session").map((record) => record.providerId);
      expect(await owners()).toEqual(["codex:work"]);
      login(home, "family");
      expect(await owners()).toEqual(["codex:family"]);
    });
  });
});
