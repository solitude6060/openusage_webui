import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenUsagePluginProvider } from "../src/index";
import type { CodexEventScanInput, CodexEventScanResult } from "../src/codex-session-events";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RESETS_AT = Math.floor(Date.parse("2026-10-16T00:00:00.000Z") / 1000);

test("Codex refresh returns session events for the account with the live meter shape", async () => {
  const root = mkdtempSync(join(tmpdir(), "openusage-codex-refresh-"));
  tempDirs.push(root);
  const codexHome = join(root, "codex");
  mkdirSync(join(codexHome, "sessions"), { recursive: true });
  writeFileSync(join(codexHome, "sessions", "rollout.jsonl"), `${[
    JSON.stringify({
      timestamp: "2026-10-09T12:00:00.000Z",
      type: "session_meta",
      payload: { creator_account_id: "not-an-account", prompt: "do not store this text" },
    }),
    JSON.stringify({
      timestamp: "2026-10-09T12:30:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 80, cached_input_tokens: 10, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 100 },
          last_token_usage: { input_tokens: 80, cached_input_tokens: 10, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 100 },
        },
        rate_limits: {
          plan_type: "prolite",
          primary: { used_percent: 12, window_minutes: 10080, resets_at: RESETS_AT },
          secondary: null,
        },
      },
    }),
  ].join("\n")}\n`);

  const provider = new OpenUsagePluginProvider({
    providerId: "codex:codex",
    name: "Codex",
    pluginId: "codex",
    homeDir: root,
    env: { HOME: root, CODEX_HOME: codexHome },
    scriptText: `
      globalThis.__openusage_plugin = {
        id: "codex",
        probe() {
          return {
            lines: [{
              type: "progress",
              label: "Session",
              used: 12,
              format: { kind: "percent" },
              periodDurationMs: ${WEEK_MS},
              resetsAt: "2026-10-16T00:00:00.000Z",
            }],
          };
        },
      };
    `,
  });
  const scan: CodexEventScanInput = {
    accounts: [
      { id: "codex:codex", homePath: codexHome, shape: null, planType: null },
      { id: "codex:family", homePath: join(root, "missing"), shape: null, planType: null },
    ],
    cursors: [],
    storedMapKey: null,
  };
  const codex = provider as OpenUsagePluginProvider & {
    setCodexEventScan?: (input: CodexEventScanInput) => void;
    takeCodexEventResult?: () => CodexEventScanResult | null;
    codexHomePath?: () => string | null;
  };
  codex.setCodexEventScan?.(scan);
  const records = await provider.refresh();
  expect(records[0]?.tool).toBe("OpenUsage Plugin Snapshot");
  const first = codex.takeCodexEventResult?.();
  expect(first?.events.map((event) => event.providerId)).toEqual(["codex:codex"]);
  expect(JSON.stringify(first ?? {})).not.toContain("do not store");
  expect(JSON.stringify(first ?? {})).not.toContain("not-an-account");
  expect(codex.codexHomePath?.()).toBe(codexHome);

  const recorded = scan.accounts.map((account) => ({
    ...account,
    planType: first?.learnedPlans.find((item) => item.providerId === account.id)?.planType ?? account.planType,
  }));
  codex.setCodexEventScan?.({
    accounts: recorded,
    cursors: first?.cursors ?? [],
    storedMapKey: first?.mapKey ?? null,
  });
  await provider.refresh();
  const second = codex.takeCodexEventResult?.();
  expect(second?.events).toEqual([]);
  expect(second?.filesRead).toBe(0);
});
