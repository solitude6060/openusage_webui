import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCodexEventScan } from "../src/codex-event-refresh";
import {
  scanCodexSessionEvents,
  type CodexEventAccount,
  type CodexEventCursor,
  type CodexEventScanResult,
} from "../../../packages/providers/src/codex-session-events";
import { SqliteStorage } from "../../../packages/storage/src/index";

const FROM = "2026-10-01T00:00:00.000Z";
const RESETS_AT = Math.floor(Date.parse("2026-10-16T00:00:00.000Z") / 1000);
const MAP_KEY = "codex_event_map_key";
const PLAN_KEY = "codex_event_plan_types";

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

test("a Codex rescan that cannot read a session file keeps the stored events until the file can be read", async () => {
  const sessions = openFixture();
  const readable = join(sessions, "readable.jsonl");
  const blocked = join(sessions, "blocked.jsonl");
  writeFileSync(readable, weeklyLine("2026-10-09T12:30:00.000Z", 100));
  writeFileSync(blocked, weeklyLine("2026-10-09T13:30:00.000Z", 200));
  await expectKeptUntilReadable(blocked, 0o644);
});

test("a Codex rescan that cannot list the sessions directory keeps the stored events until the directory can be listed", async () => {
  const sessions = openFixture();
  writeFileSync(join(sessions, "one.jsonl"), weeklyLine("2026-10-09T12:30:00.000Z", 100));
  writeFileSync(join(sessions, "two.jsonl"), weeklyLine("2026-10-09T13:30:00.000Z", 200));
  await expectKeptUntilReadable(sessions, 0o755);
});

test("an empty readable Codex sessions directory still clears stored events on a rescan", async () => {
  const sessions = openFixture();
  const first = join(sessions, "one.jsonl");
  const second = join(sessions, "two.jsonl");
  writeFileSync(first, weeklyLine("2026-10-09T12:30:00.000Z", 100));
  writeFileSync(second, weeklyLine("2026-10-09T13:30:00.000Z", 200));
  const storage = new SqliteStorage();
  await storage.init();
  try {
    const { swapped, storedMapKey, cursors } = await storeInitialScan(storage);
    unlinkSync(first);
    unlinkSync(second);
    const cleared = scanQuietly({
      accounts: swapped,
      cursors,
      storedMapKey,
    });
    await saveCodexEventScan(storage, cleared);
    expect(await ownedTokens(storage)).toEqual([]);
  } finally {
    storage.close();
  }
});

async function expectKeptUntilReadable(lockedPath: string, restoredMode: number): Promise<void> {
  const storage = new SqliteStorage();
  await storage.init();
  let locked = false;
  try {
    const { swapped, storedMapKey, cursors, plans } = await storeInitialScan(storage);
    chmodSync(lockedPath, 0);
    locked = true;
    const errors: string[] = [];
    const blocked = scanQuietly({
      accounts: swapped,
      cursors,
      storedMapKey,
    }, errors);
    await saveCodexEventScan(storage, blocked);
    expect(await ownedTokens(storage)).toEqual([{ providerId: "codex:codex", tokens: 300 }]);
    expect(await storage.getAppMeta(MAP_KEY)).toBe(storedMapKey);
    expect(await storage.getAppMeta(PLAN_KEY)).toBe(plans);
    expect(cursorSnapshot(await storage.listCodexEventCursors())).toEqual(cursorSnapshot(cursors));
    expect(blocked.complete).toBe(false);
    expect(errors.join("\n")).toContain("codex_session_read_failed");

    chmodSync(lockedPath, restoredMode);
    locked = false;
    const storedAfterFailure = await storage.getAppMeta(MAP_KEY);
    const recovered = scanQuietly({
      accounts: swapped,
      cursors: await storage.listCodexEventCursors(),
      storedMapKey: storedAfterFailure,
    });
    await saveCodexEventScan(storage, recovered);
    expect(recovered.complete).toBe(true);
    expect(recovered.filesRead).toBe(2);
    expect(await ownedTokens(storage)).toEqual([{ providerId: "codex:family", tokens: 300 }]);
  } finally {
    if (locked) chmodSync(lockedPath, restoredMode);
    storage.close();
  }
}

function openFixture(): string {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-rescan-db-"));
  homeRoot = mkdtempSync(join(tmpdir(), "openusage-codex-rescan-home-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  const sessions = join(homeRoot, "codex", "sessions");
  mkdirSync(sessions, { recursive: true });
  return sessions;
}

async function storeInitialScan(storage: SqliteStorage): Promise<{
  swapped: CodexEventAccount[];
  storedMapKey: string;
  cursors: CodexEventCursor[];
  plans: string | null;
}> {
  const codexHome = join(homeRoot, "codex");
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
  const first = scanQuietly({ accounts: [weekly, fiveHour], cursors: [], storedMapKey: null });
  await saveCodexEventScan(storage, first);
  expect(await ownedTokens(storage)).toEqual([{ providerId: "codex:codex", tokens: 300 }]);
  const storedMapKey = await storage.getAppMeta(MAP_KEY);
  expect(storedMapKey).toBe(first.mapKey);
  return {
    swapped: [
      { ...weekly, shape: "five-hour-primary" },
      { ...fiveHour, shape: "weekly-primary" },
    ],
    storedMapKey: storedMapKey ?? "",
    cursors: await storage.listCodexEventCursors(),
    plans: await storage.getAppMeta(PLAN_KEY),
  };
}

function scanQuietly(
  input: { accounts: CodexEventAccount[]; cursors: CodexEventCursor[]; storedMapKey: string | null },
  errors?: string[],
): CodexEventScanResult {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors?.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    return scanCodexSessionEvents(input);
  } finally {
    console.error = original;
  }
}

function weeklyLine(timestamp: string, tokens: number): string {
  return `${JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: usage(tokens),
        last_token_usage: usage(tokens),
      },
      rate_limits: {
        plan_type: "prolite",
        primary: { used_percent: 12, window_minutes: 10080, resets_at: RESETS_AT },
        secondary: null,
      },
    },
  })}\n`;
}

function usage(total: number) {
  return {
    input_tokens: total,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: total,
  };
}

async function ownedTokens(storage: SqliteStorage): Promise<Array<{ providerId: string; tokens: number }>> {
  const totals = new Map<string, number>();
  for (const row of await storage.listAllowanceTokenRows(FROM)) {
    if (row.model !== "All Models") continue;
    totals.set(row.providerId, (totals.get(row.providerId) ?? 0) + row.tokens);
  }
  return [...totals.entries()]
    .map(([providerId, tokens]) => ({ providerId, tokens }))
    .sort((left, right) => left.providerId.localeCompare(right.providerId));
}

function cursorSnapshot(cursors: CodexEventCursor[]): CodexEventCursor[] {
  return cursors
    .map((cursor) => ({
      path: cursor.path,
      mtimeMs: cursor.mtimeMs,
      offset: cursor.offset,
      lastTotalTokens: cursor.lastTotalTokens,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
