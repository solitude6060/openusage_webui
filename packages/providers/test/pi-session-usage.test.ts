import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { UsageRecord } from "../../core/src/types";
import { OpenUsagePluginProvider } from "../src/providers/openusage-plugin";
import { withIsolatedHome } from "./openusage-plugin-fixture-helpers";

const now = "2026-10-11T12:00:00.000Z";

function line(options: {
  id?: string | null;
  timestamp?: string;
  provider?: string;
  model?: string;
  role?: string;
  type?: string;
  usage?: Record<string, unknown>;
} = {}): string {
  return JSON.stringify({
    type: options.type ?? "message",
    ...(options.id === null ? {} : { id: options.id ?? "m1" }),
    timestamp: options.timestamp ?? "2026-10-10T10:00:00.000Z",
    message: {
      role: options.role ?? "assistant",
      provider: options.provider ?? "openai-codex",
      model: options.model ?? "gpt-6.1-sol",
      content: [{ type: "text", text: "PRIVATE_MESSAGE_FIXTURE" }],
      usage: options.usage ?? { input: 100, output: 50, totalTokens: 150, cost: { total: 0.5 } },
    },
  });
}

function session(home: string, name: string, lines: string[]): void {
  const path = join(home, ".pi/agent/sessions", name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n") + "\n");
}

function provider(home: string, options: Record<string, unknown> = {}): OpenUsagePluginProvider {
  return new OpenUsagePluginProvider({
    providerId: "codex",
    name: "Codex",
    pluginId: "codex",
    homeDir: home,
    env: { HOME: home },
    now: () => now,
    scriptText: `globalThis.__openusage_plugin = { probe() { return { plan: "Plus", lines: [] }; } };`,
    ...options,
  });
}

function tokens(records: UsageRecord[]): UsageRecord[] {
  return records.filter((record) => record.totalTokens !== undefined);
}

describe("Pi session usage", () => {
  test("adds private-content-free Pi Session totals beside native ccusage and keeps stable ids", async () => {
    await withIsolatedHome(async (home) => {
      session(home, "work/a.jsonl", [line()]);
      const plugin = provider(home, {
        scriptText: `globalThis.__openusage_plugin = { probe(ctx) {
          ctx.host.ccusage.query({ provider: "codex" }); return { plan: "Plus", lines: [] };
        } };`,
        ccusageQuery: () => ({ status: "ok", data: { daily: [{ date: "2026-10-10", totalTokens: 25 }] } }),
      });
      const first = tokens(await plugin.refresh());
      const pi = first.find((record) => record.tool === "Pi Session");
      expect(pi).toMatchObject({ providerId: "codex", source: "local-log", model: "gpt-6.1-sol",
        inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.5,
        startedAt: "2026-10-10T00:00:00.000Z" });
      expect(first.find((record) => record.tool === "ccusage")?.totalTokens).toBe(25);
      expect(JSON.stringify(pi)).not.toContain("PRIVATE_MESSAGE_FIXTURE");
      expect(tokens(await plugin.refresh()).map((record) => record.id)).toEqual(first.map((record) => record.id));
    });
  });

  test("drops non-assistant, non-message, malformed, and all providers other than Claude/Codex", async () => {
    await withIsolatedHome(async (home) => {
      session(home, "a.jsonl", [line(), line({ id: "user", role: "user" }), line({ id: "tool", role: "toolResult" }),
        line({ id: "event", type: "event" }), '{"usage":{',
        ...["xai", "cursor", "zai", "zhipu", "google-antigravity", "github-copilot", "nvidia-nim", "openai-codex-2"]
          .map((value) => line({ id: value, provider: value })),
        line({ id: "bad-date", timestamp: "invalid" })]);
      expect(tokens(await provider(home).refresh())).toHaveLength(1);
    });
  });

  test("attributes anthropic and claude-agent-sdk to Claude only", async () => {
    await withIsolatedHome(async (home) => {
      session(home, "a.jsonl", [line({ id: "a", provider: "anthropic", model: " claude-opus-4-8 " }),
        line({ id: "b", provider: "claude-agent-sdk", model: "claude-opus-4-8" }), line()]);
      expect(tokens(await provider(home, { providerId: "claude-code", pluginId: "claude" }).refresh()))
        .toEqual([expect.objectContaining({ providerId: "claude-code", model: "claude-opus-4-8", totalTokens: 300, costUsd: 1 })]);
    });
  });

  test("deduplicates top-level ids globally in path order, keeping missing ids and the first occurrence", async () => {
    await withIsolatedHome(async (home) => {
      session(home, "z/b.jsonl", [line({ model: "other", usage: { totalTokens: 999, cost: { total: 9 } } })]);
      session(home, "a/a.jsonl", [line(), line({ id: null }), line({ id: null })]);
      expect(tokens(await provider(home).refresh())).toEqual([
        expect.objectContaining({ model: "gpt-6.1-sol", totalTokens: 450, costUsd: 1.5 }),
      ]);
    });
  });

  test("uses the exact compact usage marker, reported totals, and split cache writes", async () => {
    await withIsolatedHome(async (home) => {
      session(home, "a.jsonl", [line({ usage: { input: " 100.9 ", output: 50, cacheRead: 20,
        cacheWrite: 1000, cacheWrite1h: 400, totalTokens: 9999, cost: { total: "0.5" } } }),
        line({ id: "spaced" }).replace('"usage":{', '"usage": {')]);
      expect(tokens(await provider(home).refresh())).toEqual([
        expect.objectContaining({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 20,
          cacheCreationTokens: 1000, totalTokens: 9999, costUsd: 0.5 }),
      ]);
    });
  });

  test("positive carried cost wins and zero/missing costs use existing Codex rates", async () => {
    await withIsolatedHome(async (home) => {
      session(home, "a.jsonl", [line({ id: "carried", model: "gpt-6-astra" }),
        line({ id: "zero", usage: { input: 100, output: 50, cacheRead: 20, cacheWrite: 10,
          totalTokens: 180, cost: { total: 0 } } }),
        line({ id: "missing", usage: { input: 100, output: 50, totalTokens: 150 } })]);
      const rows = tokens(await provider(home).refresh());
      expect(rows.find((row) => row.model === "gpt-6-astra")?.costUsd).toBe(0.5);
      expect(rows.find((row) => row.model === "gpt-6.1-sol")?.costUsd).toBeCloseTo(0.001427, 9);
    });
  });

  test.each([undefined, 0, 0.75])("auto-review becomes free at the exact UTC boundary with carried cost %s", async (cost) => {
    await withIsolatedHome(async (home) => {
      const usage = { input: 100, output: 50, totalTokens: 150, ...(cost === undefined ? {} : { cost: { total: cost } }) };
      session(home, "a.jsonl", [
        line({ id: "before", model: "codex-auto-review", timestamp: "2026-10-05T23:59:59.999Z", usage }),
        line({ id: "at", model: "codex-auto-review", timestamp: "2026-10-06T00:00:00.000Z", usage }),
        line({ id: "after", model: "codex-auto-review", timestamp: "2026-10-06T00:00:00.001Z", usage }),
      ]);
      const rows = tokens(await provider(home).refresh());
      const beforeDate = new Date("2026-10-05T23:59:59.999Z");
      const afterDate = new Date("2026-10-06T00:00:00.000Z");
      if (beforeDate.getDate() === afterDate.getDate()) {
        expect(rows).toHaveLength(1);
        expect(rows[0]?.costUsd).toBe(cost && cost > 0 ? cost : undefined);
      } else {
        expect(rows).toHaveLength(2);
        expect(rows.find((row) => row.totalTokens === 300)?.costUsd).toBe(0);
        expect(rows.find((row) => row.totalTokens === 150)?.costUsd).toBe(cost && cost > 0 ? cost : undefined);
      }
      expect(rows.reduce((sum, row) => sum + (row.totalTokens ?? 0), 0)).toBe(450);
    });
  });

  test("retains unpriced tokens with unknown cost, including partial daily prices and Claude zeros", async () => {
    await withIsolatedHome(async (home) => {
      session(home, "a.jsonl", [line({ id: "unknown", model: "mystery", usage: { totalTokens: 100, cost: { total: 0 } } }),
        line({ id: "known", model: "mystery" }),
        line({ id: "claude", provider: "anthropic", model: "claude-opus-4-8", usage: { totalTokens: 200, cost: { total: 0 } } }),
        line({ id: "other-review", provider: "anthropic", model: "codex-auto-review" })]);
      expect(tokens(await provider(home).refresh())).toEqual([
        expect.objectContaining({ model: "mystery", totalTokens: 250 }),
      ]);
      expect(tokens(await provider(home).refresh())[0]?.costUsd).toBeUndefined();
      const claude = tokens(await provider(home, { providerId: "claude-code", pluginId: "claude" }).refresh());
      expect(claude.find((row) => row.model === "claude-opus-4-8")?.costUsd).toBeUndefined();
      expect(claude.find((row) => row.model === "codex-auto-review")?.costUsd).toBe(0.5);
    });
  });

  test("uses local-day buckets and includes the midnight cutoff 30 calendar days ago", async () => {
    await withIsolatedHome(async (home) => {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 30);
      cutoff.setHours(0, 0, 0, 0);
      const localLate = new Date(2026, 9, 10, 23, 59);
      session(home, "a.jsonl", [line({ id: "old", timestamp: new Date(cutoff.getTime() - 1).toISOString() }),
        line({ id: "cutoff", timestamp: cutoff.toISOString() }), line({ id: "late", timestamp: localLate.toISOString() })]);
      const rows = tokens(await provider(home).refresh());
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.startedAt === "2026-10-10T00:00:00.000Z")?.totalTokens).toBe(150);
      expect(rows.reduce((sum, row) => sum + (row.totalTokens ?? 0), 0)).toBe(300);
    });
  });

  test("normalizes upstream ISO timestamps without a zone as UTC and rejects non-ISO dates", async () => {
    await withIsolatedHome(async (home) => {
      session(home, "a.jsonl", [
        line({ id: "naive", timestamp: " 2026-10-10T23:00:00.123456 " }),
        line({ id: "space", timestamp: "2026-10-10 23:00:00.123 UTC" }),
        line({ id: "zoned", timestamp: "2026-10-10T23:00:00.123Z" }),
        line({ id: "non-iso", timestamp: "10/10/2026 23:00:00" }),
      ]);
      const instant = new Date("2026-10-10T23:00:00.123Z");
      const date = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, "0")}-${String(instant.getDate()).padStart(2, "0")}`;
      expect(tokens(await provider(home).refresh())).toEqual([
        expect.objectContaining({ startedAt: `${date}T00:00:00.000Z`, totalTokens: 450, costUsd: 1.5 }),
      ]);
    });
  });

  test.each(["session", "config", "default"])("resolves %s directory precedence with whitespace and tilde expansion", async (choice) => {
    await withIsolatedHome(async (home) => {
      for (const [directory, count] of [[".pi/agent/sessions", 10], ["custom/sessions", 20], ["explicit", 30]] as const) {
        mkdirSync(join(home, directory), { recursive: true });
        writeFileSync(join(home, directory, "a.jsonl"), line({ usage: { totalTokens: count, cost: { total: 1 } } }));
      }
      const env = { HOME: home, PI_CODING_AGENT_DIR: choice === "default" ? " " : " ~/custom/ ",
        PI_CODING_AGENT_SESSION_DIR: choice === "session" ? " ~/explicit " : " " };
      expect(tokens(await provider(home, { env }).refresh())[0]?.totalTokens)
        .toBe(choice === "session" ? 30 : choice === "config" ? 20 : 10);
    });
  });

  test("scans a symlinked sessions root and ignores non-jsonl files", async () => {
    await withIsolatedHome(async (home) => {
      session(home, "a.jsonl", [line()]);
      session(home, "ignored.txt", [line({ id: "ignored" })]);
      symlinkSync(join(home, ".pi/agent/sessions"), join(home, "alias"));
      expect(tokens(await provider(home, { env: { HOME: home, PI_CODING_AGENT_SESSION_DIR: join(home, "alias") } }).refresh()))
        .toHaveLength(1);
    });
  });

  test("preserves the successful snapshot and logs a content-free scanner failure", async () => {
    await withIsolatedHome(async (home) => {
      mkdirSync(join(home, ".pi/agent"), { recursive: true });
      writeFileSync(join(home, ".pi/agent/sessions"), "PRIVATE_SESSION_FIXTURE");
      const log = spyOn(console, "error").mockImplementation(() => {});
      try {
        const records = await provider(home).refresh();
        expect(records).toHaveLength(1);
        expect(records[0]?.model).toBe("Plus");
        expect(log).toHaveBeenCalledWith("Pi session token scan failed.");
        expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_SESSION_FIXTURE");
      } finally { log.mockRestore(); }
    });
  });

  test("passes Pi ownership through the refresh worker", async () => {
    await withIsolatedHome(async (home) => {
      const timestamp = new Date().toISOString();
      session(home, "a.jsonl", [line({ timestamp })]);
      const enabled = provider(home, { now: undefined, recordPiSessionTokens: true });
      const disabled = provider(home, { now: undefined, recordPiSessionTokens: false });
      expect(tokens(await enabled.refresh())).toHaveLength(1);
      expect(tokens(await disabled.refresh())).toEqual([]);
    });
  });
});
