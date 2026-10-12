import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestHandler } from "../src/index";
import { SqliteStorage } from "../../../packages/storage/src/index";
import { OpenUsagePluginProvider } from "../../../packages/providers/src/index";

let dataDir = "";
let homeRoot = "";
let previousDataDir: string | undefined;

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (homeRoot) rmSync(homeRoot, { recursive: true, force: true });
});

const RESETS_AT = Math.floor(Date.parse("2026-10-16T00:00:00.000Z") / 1000);

function tokenLine(timestamp: string, total: number, last: number): string {
  const usage = (tokens: number) => ({
    input_tokens: tokens,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: tokens,
  });
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: usage(total), last_token_usage: usage(last) },
      rate_limits: {
        plan_type: "prolite",
        primary: { used_percent: 12, window_minutes: 10080, resets_at: RESETS_AT },
        secondary: null,
      },
    },
  });
}

test("Codex refresh stores session events and a later refresh keeps the new rows", async () => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-refresh-db-"));
  homeRoot = mkdtempSync(join(tmpdir(), "openusage-codex-refresh-home-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;

  const codexHome = join(homeRoot, "codex");
  const familyHome = join(homeRoot, "family");
  const sessionFile = join(codexHome, "sessions", "rollout.jsonl");
  mkdirSync(join(codexHome, "sessions"), { recursive: true });
  mkdirSync(familyHome, { recursive: true });
  symlinkSync(join(codexHome, "sessions"), join(familyHome, "sessions"));
  writeFileSync(sessionFile, `${tokenLine("2026-10-09T12:30:00.000Z", 100, 100)}\n`);

  const storage = new SqliteStorage();
  await storage.init();
  await storage.upsertProviderAccount({
    id: "codex:codex", providerId: "codex", label: "Codex", homePath: codexHome, enabled: true, sortOrder: 0,
  });
  await storage.upsertProviderAccount({
    id: "codex:family", providerId: "codex", label: "Codex Family", homePath: familyHome, enabled: false, sortOrder: 1,
  });
  const times = ["2026-10-09T12:00:00.000Z", "2026-10-09T13:10:00.000Z"];
  const provider = new OpenUsagePluginProvider({
    providerId: "codex:codex",
    name: "Codex",
    pluginId: "codex",
    homeDir: homeRoot,
    env: { HOME: homeRoot, CODEX_HOME: codexHome },
    now: () => times.shift() ?? "2026-10-09T13:10:00.000Z",
    scriptText: `
      globalThis.__openusage_plugin = {
        id: "codex",
        probe(ctx) {
          if (ctx.nowIso !== "2026-10-09T12:00:00.000Z") return { lines: [] };
          return { lines: [{
            type: "progress",
            label: "Session",
            used: 12,
            format: { kind: "percent" },
            periodDurationMs: ${7 * 24 * 60 * 60 * 1000},
            resetsAt: "2026-10-16T00:00:00.000Z",
          }] };
        },
      };
    `,
  });
  const handle = createRequestHandler(storage, { host: "127.0.0.1", port: 6736 }, undefined, [provider]);
  const refresh = () => handle(new Request(
    "http://127.0.0.1:6736/api/providers/codex%3Acodex/refresh",
    { method: "POST" },
  ));

  expect((await refresh()).status).toBe(200);
  expect(await allowanceHours(storage)).toEqual([
    { providerId: "codex:codex", startedAt: "2026-10-09T12:00:00.000Z", tokens: 100 },
  ]);

  appendFileSync(sessionFile, `${tokenLine("2026-10-09T13:00:00.000Z", 150, 50)}\n`);
  expect((await refresh()).status).toBe(200);
  expect(await allowanceHours(storage)).toEqual([
    { providerId: "codex:codex", startedAt: "2026-10-09T12:00:00.000Z", tokens: 100 },
    { providerId: "codex:codex", startedAt: "2026-10-09T13:00:00.000Z", tokens: 50 },
  ]);
  storage.close();
});

async function allowanceHours(storage: SqliteStorage) {
  const rows = await storage.listAllowanceTokenRows("2026-10-01T00:00:00.000Z");
  return rows
    .filter((row) => row.model === "All Models")
    .map((row) => ({ providerId: row.providerId, startedAt: row.startedAt, tokens: row.tokens }))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}
