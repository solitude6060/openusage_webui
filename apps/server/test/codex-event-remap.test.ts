import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCodexEventScan } from "../src/codex-event-refresh";
import {
  scanCodexSessionEvents,
  type CodexEventAccount,
} from "../../../packages/providers/src/codex-session-events";
import { SqliteStorage } from "../../../packages/storage/src/index";

const FROM = "2026-10-01T00:00:00.000Z";
const RESETS_AT = Math.floor(Date.parse("2026-10-16T00:00:00.000Z") / 1000);

let dataDir = "";
let homeRoot = "";
let previousDataDir: string | undefined;

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.OPENUSAGE_WEBUI_DIR;
  else process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (homeRoot) rmSync(homeRoot, { recursive: true, force: true });
  dataDir = "";
  homeRoot = "";
});

test("a Codex shape swap keeps the event on the new account only", async () => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-remap-db-"));
  homeRoot = mkdtempSync(join(tmpdir(), "openusage-codex-remap-home-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  const codexHome = join(homeRoot, "codex");
  mkdirSync(join(codexHome, "sessions"), { recursive: true });
  writeFileSync(join(codexHome, "sessions", "rollout.jsonl"), `${JSON.stringify({
    timestamp: "2026-10-09T12:30:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 100,
        },
        last_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 100,
        },
      },
      rate_limits: {
        plan_type: "prolite",
        primary: { used_percent: 12, window_minutes: 10080, resets_at: RESETS_AT },
        secondary: null,
      },
    },
  })}\n`);

  const storage = new SqliteStorage();
  await storage.init();
  const weekly: CodexEventAccount = {
    id: "codex:codex",
    homePath: codexHome,
    shape: "weekly-primary",
    planType: null,
  };
  const fiveHour: CodexEventAccount = {
    id: "codex:family",
    homePath: join(homeRoot, "family"),
    shape: "five-hour-primary",
    planType: null,
  };
  const first = scanCodexSessionEvents({ accounts: [weekly, fiveHour], cursors: [], storedMapKey: null });
  await saveCodexEventScan(storage, first);
  const second = scanCodexSessionEvents({
    accounts: [
      { ...weekly, shape: "five-hour-primary" },
      { ...fiveHour, shape: "weekly-primary" },
    ],
    cursors: first.cursors,
    storedMapKey: first.mapKey,
  });
  await saveCodexEventScan(storage, second);

  expect(await eventRows(storage)).toEqual([{ providerId: "codex:family", tokens: 100 }]);

  const third = scanCodexSessionEvents({
    accounts: [
      { ...weekly, shape: null },
      { ...fiveHour, shape: null },
    ],
    cursors: second.cursors,
    storedMapKey: second.mapKey,
  });
  await saveCodexEventScan(storage, third);
  expect(await eventRows(storage)).toEqual([]);
  storage.close();
});

async function eventRows(storage: SqliteStorage): Promise<Array<{ providerId: string; tokens: number }>> {
  const rows = await storage.listAllowanceTokenRows(FROM);
  return rows
    .filter((row) => row.model === "All Models")
    .map((row) => ({ providerId: row.providerId, tokens: row.tokens }))
    .sort((left, right) => left.providerId.localeCompare(right.providerId));
}
