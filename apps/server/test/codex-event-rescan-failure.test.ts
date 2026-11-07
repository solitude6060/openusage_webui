import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
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

test("a Codex rescan that cannot read a session file moves the readable file's events and stays pending until the file can be read", async () => {
  const sessions = openFixture();
  const readable = join(sessions, "readable.jsonl");
  const blocked = join(sessions, "blocked.jsonl");
  writeFileSync(readable, weeklyLine("2026-10-09T12:30:00.000Z", 100));
  writeFileSync(blocked, weeklyLine("2026-10-09T13:30:00.000Z", 200));
  // The readable file's event moves to its new account; the blocked file's event stays where it was.
  await expectKeptUntilReadable(blocked, 0o644, [
    { providerId: "codex:codex", tokens: 200 },
    { providerId: "codex:family", tokens: 100 },
  ]);
});

test("a Codex rescan that cannot list the sessions directory keeps the stored events until the directory can be listed", async () => {
  const sessions = openFixture();
  writeFileSync(join(sessions, "one.jsonl"), weeklyLine("2026-10-09T12:30:00.000Z", 100));
  writeFileSync(join(sessions, "two.jsonl"), weeklyLine("2026-10-09T13:30:00.000Z", 200));
  await expectKeptUntilReadable(sessions, 0o755, [{ providerId: "codex:codex", tokens: 300 }]);
});

test("an empty readable Codex sessions directory leaves the rescan pending until files return", async () => {
  const sessions = openFixture();
  const first = join(sessions, "one.jsonl");
  const second = join(sessions, "two.jsonl");
  const firstText = weeklyLine("2026-10-09T12:30:00.000Z", 100);
  writeFileSync(first, firstText);
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
    const logs = await saveLogged(storage, cleared);
    expect(logs).toContain("codex_event_rescan_no_events");
    expect(logs).not.toContain("codex_event_rescan_incomplete");
    // No file reproduces a stored event, so every stored event keeps its account.
    expect(await ownedTokens(storage)).toEqual([{ providerId: "codex:codex", tokens: 300 }]);
    // A rescan that finds no event is not used up: the key and cursors stay.
    expect(await storage.getAppMeta(MAP_KEY)).toBe(storedMapKey);
    expect(cursorSnapshot(await storage.listCodexEventCursors())).toEqual(cursorSnapshot(cursors));

    // The file comes back with the size and modified time its cursor recorded.
    writeFileSync(first, firstText);
    const oldCursor = cursors.find((cursor) => cursor.path.endsWith("one.jsonl"))!;
    utimesSync(first, oldCursor.mtimeMs / 1000, oldCursor.mtimeMs / 1000);
    const restored = scanQuietly({
      accounts: swapped,
      cursors: await storage.listCodexEventCursors(),
      storedMapKey: await storage.getAppMeta(MAP_KEY),
    });
    await saveCodexEventScan(storage, restored);
    expect(restored.filesRead).toBe(1);
    expect(await ownedTokens(storage)).toEqual([
      { providerId: "codex:codex", tokens: 200 },
      { providerId: "codex:family", tokens: 100 },
    ]);
  } finally {
    storage.close();
  }
});

test("a rescan with one of two separate sessions directories missing changes nothing", async () => {
  const sessions = openFixture();
  const familySessions = join(homeRoot, "family", "sessions");
  mkdirSync(familySessions, { recursive: true });
  writeFileSync(join(sessions, "a.jsonl"), weeklyLine("2026-10-09T12:30:00.000Z", 100));
  writeFileSync(join(familySessions, "b.jsonl"), plusLine("2026-10-09T13:30:00.000Z", 200));
  const storage = new SqliteStorage();
  await storage.init();
  try {
    const codex: CodexEventAccount = {
      id: "codex:codex", homePath: join(homeRoot, "codex"), shape: "weekly-primary", planType: null,
    };
    const family: CodexEventAccount = {
      id: "codex:family", homePath: join(homeRoot, "family"), shape: null, planType: "plus",
    };
    const first = scanQuietly({ accounts: [codex, family], cursors: [], storedMapKey: null });
    await saveCodexEventScan(storage, first);
    expect(await ownedTokens(storage)).toEqual([
      { providerId: "codex:codex", tokens: 100 },
      { providerId: "codex:family", tokens: 200 },
    ]);
    const storedMapKey = await storage.getAppMeta(MAP_KEY);
    const cursors = await storage.listCodexEventCursors();

    rmSync(familySessions, { recursive: true, force: true });
    const rescan = scanQuietly({
      // A new account id hash changes the key, so this is a rescan.
      accounts: [{ ...codex, accountIdHash: "0".repeat(64) }, family],
      cursors,
      storedMapKey,
    });
    await saveCodexEventScan(storage, rescan);
    expect(rescan.replaceProviderIds).toEqual(["codex:codex", "codex:family"]);
    expect(rescan.complete).toBe(false);
    expect(await ownedTokens(storage)).toEqual([
      { providerId: "codex:codex", tokens: 100 },
      { providerId: "codex:family", tokens: 200 },
    ]);
    expect(await storage.getAppMeta(MAP_KEY)).toBe(storedMapKey);
    expect(cursorSnapshot(await storage.listCodexEventCursors())).toEqual(cursorSnapshot(cursors));
  } finally {
    storage.close();
  }
});

test("a removed home with stored cursors does not stop the other home's new events", async () => {
  const sessions = openFixture();
  const familyHome = join(homeRoot, "family");
  mkdirSync(join(familyHome, "sessions"), { recursive: true });
  writeFileSync(join(sessions, "a.jsonl"), weeklyLine("2026-10-09T12:30:00.000Z", 100));
  writeFileSync(join(familyHome, "sessions", "b.jsonl"), plusLine("2026-10-09T13:30:00.000Z", 200));
  const storage = new SqliteStorage();
  await storage.init();
  try {
    const codex: CodexEventAccount = {
      id: "codex:codex", homePath: join(homeRoot, "codex"), shape: "weekly-primary", planType: null,
    };
    const family: CodexEventAccount = { id: "codex:family", homePath: familyHome, shape: null, planType: "plus" };
    await saveCodexEventScan(storage, scanQuietly({ accounts: [codex, family], cursors: [], storedMapKey: null }));
    const storedMapKey = await storage.getAppMeta(MAP_KEY);

    // The family home is deleted while its account stays configured; its cursors remain.
    rmSync(familyHome, { recursive: true, force: true });
    writeFileSync(join(sessions, "c.jsonl"), weeklyLine("2026-10-10T08:00:00.000Z", 50));
    const rescan = scanQuietly({
      accounts: [{ ...codex, accountIdHash: "0".repeat(64) }, family],
      cursors: await storage.listCodexEventCursors(),
      storedMapKey,
    });
    expect(rescan.complete).toBe(false);
    await saveLogged(storage, rescan);
    expect(await ownedTokens(storage)).toEqual([
      { providerId: "codex:codex", tokens: 150 },
      { providerId: "codex:family", tokens: 200 },
    ]);
    // The key is not saved, so the next refresh tries the full reread again.
    expect(await storage.getAppMeta(MAP_KEY)).toBe(storedMapKey);
  } finally {
    storage.close();
  }
});

test("a file whose first line is too long does not stop the other files' events on a rescan", async () => {
  const sessions = openFixture();
  writeFileSync(join(sessions, "a.jsonl"), weeklyLine("2026-10-09T12:30:00.000Z", 100));
  const storage = new SqliteStorage();
  await storage.init();
  try {
    const codex: CodexEventAccount = {
      id: "codex:codex", homePath: join(homeRoot, "codex"), shape: "weekly-primary", planType: null,
    };
    await saveCodexEventScan(storage, scanQuietly({ accounts: [codex], cursors: [], storedMapKey: null }));
    const storedMapKey = await storage.getAppMeta(MAP_KEY);
    const huge = JSON.stringify({ type: "session_meta", payload: { base_instructions: { text: "x".repeat(4_700_000) } } });
    writeFileSync(join(sessions, "huge.jsonl"), `${huge}\n${weeklyLine("2026-10-10T07:00:00.000Z", 70)}`);
    writeFileSync(join(sessions, "c.jsonl"), weeklyLine("2026-10-10T08:00:00.000Z", 50));
    const rescan = scanQuietly({
      accounts: [{ ...codex, accountIdHash: "0".repeat(64) }],
      cursors: await storage.listCodexEventCursors(),
      storedMapKey,
    });
    expect(rescan.complete).toBe(false);
    await saveLogged(storage, rescan);
    expect(await ownedTokens(storage)).toEqual([{ providerId: "codex:codex", tokens: 150 }]);
    expect(await storage.getAppMeta(MAP_KEY)).toBe(storedMapKey);
  } finally {
    storage.close();
  }
});

async function saveLogged(storage: SqliteStorage, result: CodexEventScanResult): Promise<string> {
  const lines: string[] = [];
  const original = { error: console.error, log: console.log };
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    await saveCodexEventScan(storage, result);
  } finally {
    console.error = original.error;
    console.log = original.log;
  }
  return lines.join("\n");
}

async function expectKeptUntilReadable(
  lockedPath: string,
  restoredMode: number,
  blockedTokens: Array<{ providerId: string; tokens: number }>,
): Promise<void> {
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
    expect(await ownedTokens(storage)).toEqual(blockedTokens);
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

// No meter shape (a 1-minute primary window), so only the recorded plan name can assign it.
function plusLine(timestamp: string, tokens: number): string {
  return `${JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: usage(tokens), last_token_usage: usage(tokens) },
      rate_limits: {
        plan_type: "plus",
        primary: { used_percent: 12, window_minutes: 1, resets_at: RESETS_AT },
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
