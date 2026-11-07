import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCodexEventScan } from "../src/codex-event-refresh";
import {
  scanCodexSessionEvents,
  type CodexEventAccount,
  type CodexEventScanInput,
  type CodexEventScanResult,
} from "../../../packages/providers/src/codex-session-events";
import { SqliteStorage } from "../../../packages/storage/src/index";

// Fake ids only. Real account ids never belong in fixtures.
const MAIN_ID = "acct-fake-main-0001";
const FAMILY_ID = "acct-fake-family-0002";
const FROM = "2026-10-01T00:00:00.000Z";
const MAP_KEY = "codex_event_map_key";
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(): { codexHome: string; familyHome: string; sessions: string } {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-incomplete-db-"));
  homeRoot = mkdtempSync(join(tmpdir(), "openusage-codex-incomplete-home-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  const codexHome = join(homeRoot, "codex");
  const familyHome = join(homeRoot, "family");
  const sessions = join(codexHome, "sessions");
  mkdirSync(sessions, { recursive: true });
  mkdirSync(familyHome, { recursive: true });
  symlinkSync(sessions, join(familyHome, "sessions"));
  return { codexHome, familyHome, sessions };
}

function usage(total: number) {
  return { input_tokens: total, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: total };
}

// shaped: a weekly primary window; otherwise a 1-minute window, which has no meter shape.
function line(timestamp: string, total: number, last: number, plan: string, shaped: boolean): string {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: usage(total), last_token_usage: usage(last) },
      rate_limits: {
        plan_type: plan,
        primary: { used_percent: 12, window_minutes: shaped ? 10080 : 1, resets_at: RESETS_AT },
        secondary: null,
      },
    },
  });
}

function meta(creator: string): string {
  return JSON.stringify({ timestamp: "2026-10-09T00:00:00.000Z", type: "session_meta", payload: { creator_account_id: creator } });
}

function quiet(input: CodexEventScanInput): CodexEventScanResult {
  const original = console.error;
  console.error = () => undefined;
  try {
    return scanCodexSessionEvents(input);
  } finally {
    console.error = original;
  }
}

async function save(storage: SqliteStorage, result: CodexEventScanResult): Promise<string> {
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

test("an incomplete rescan does not move an event that only a plan learned from part of the files can assign", async () => {
  const { codexHome, familyHome, sessions } = fixture();
  // a and b are weekly-shaped, so they go to codex:codex and teach its plan names: prolite and pro.
  // c has no shape; only a plan learned uniquely for an account could assign it.
  writeFileSync(join(sessions, "a.jsonl"), `${line("2026-10-09T10:00:00.000Z", 100, 100, "prolite", true)}\n`);
  const blocked = join(sessions, "b.jsonl");
  writeFileSync(blocked, `${line("2026-10-09T11:00:00.000Z", 200, 200, "pro", true)}\n`);
  writeFileSync(join(sessions, "c.jsonl"), `${line("2026-10-09T12:00:00.000Z", 40, 40, "prolite", false)}\n`);
  const storage = new SqliteStorage();
  await storage.init();
  try {
    const accounts: CodexEventAccount[] = [
      { id: "codex:codex", homePath: codexHome, shape: "weekly-primary", planType: null },
      { id: "codex:family", homePath: familyHome, shape: "five-hour-primary", planType: null },
    ];
    const first = quiet({ accounts, cursors: [], storedMapKey: null });
    await save(storage, first);
    // With both plan names seen, c cannot be assigned. An earlier mapping stored it under family.
    await storage.upsertCodexTokenEvents([{
      providerId: "codex:family",
      observedAt: "2026-10-09T12:00:00.000Z",
      tokens: 40,
      input: 40,
      cachedInput: 0,
      output: 0,
      planType: "prolite",
      weeklyUsedPercent: 12,
      weeklyResetsAt: null,
      totalTokens: 40,
    }]);
    expect(await ownedTokens(storage)).toEqual([
      { providerId: "codex:codex", tokens: 300 },
      { providerId: "codex:family", tokens: 40 },
    ]);

    // A key change rescans while b is unreadable: from a alone, codex:codex would learn "prolite".
    const changed = accounts.map((account) => ({ ...account, accountIdHash: "0".repeat(64) }));
    chmodSync(blocked, 0);
    let incomplete: CodexEventScanResult;
    try {
      incomplete = quiet({ accounts: changed, cursors: await storage.listCodexEventCursors(), storedMapKey: await storage.getAppMeta(MAP_KEY) });
    } finally {
      chmodSync(blocked, 0o644);
    }
    expect(incomplete.complete).toBe(false);
    const logs = await save(storage, incomplete);
    // The event left unmapped while the rescan is pending is counted in the log (a count only).
    expect(logs).toContain('{"event":"codex_events_unmapped","count":1}');
    expect(await ownedTokens(storage)).toEqual([
      { providerId: "codex:codex", tokens: 300 },
      { providerId: "codex:family", tokens: 40 },
    ]);

    // The following complete rescan sees both plan names again and leaves c as it was.
    const complete = quiet({ accounts: changed, cursors: await storage.listCodexEventCursors(), storedMapKey: await storage.getAppMeta(MAP_KEY) });
    expect(complete.complete).toBe(true);
    await save(storage, complete);
    expect(await ownedTokens(storage)).toEqual([
      { providerId: "codex:codex", tokens: 300 },
      { providerId: "codex:family", tokens: 40 },
    ]);
  } finally {
    storage.close();
  }
});

test("events appended during a logout with an unreadable file are stored after the login returns the old key", async () => {
  const { codexHome, familyHome, sessions } = fixture();
  const familyFile = join(sessions, "b.jsonl");
  writeFileSync(join(sessions, "a.jsonl"), `${meta(MAIN_ID)}\n${line("2026-10-09T10:00:00.000Z", 100, 100, "plus", true)}\n`);
  writeFileSync(familyFile, `${meta(FAMILY_ID)}\n${line("2026-10-09T11:00:00.000Z", 200, 200, "plus", true)}\n`);
  const storage = new SqliteStorage();
  await storage.init();
  try {
    // Same shape and plan for both, so only the creator hash can assign an event.
    const loggedIn: CodexEventAccount[] = [
      { id: "codex:codex", homePath: codexHome, shape: "weekly-primary", planType: "plus", accountIdHash: sha256(MAIN_ID) },
      { id: "codex:family", homePath: familyHome, shape: "weekly-primary", planType: "plus", accountIdHash: sha256(FAMILY_ID) },
    ];
    await save(storage, quiet({ accounts: loggedIn, cursors: [], storedMapKey: null }));
    const k1 = await storage.getAppMeta(MAP_KEY);
    expect(await ownedTokens(storage)).toEqual([
      { providerId: "codex:codex", tokens: 100 },
      { providerId: "codex:family", tokens: 200 },
    ]);

    // Logout of family, a new family event, and one unreadable file: an incomplete rescan.
    const loggedOut = [loggedIn[0]!, { ...loggedIn[1]!, accountIdHash: null }];
    appendFileSync(familyFile, `${line("2026-10-10T09:00:00.000Z", 260, 60, "plus", true)}\n`);
    const blocked = join(sessions, "x.jsonl");
    writeFileSync(blocked, `${line("2026-10-10T10:00:00.000Z", 5, 5, "plus", true)}\n`);
    chmodSync(blocked, 0);
    let incomplete: CodexEventScanResult;
    try {
      incomplete = quiet({ accounts: loggedOut, cursors: await storage.listCodexEventCursors(), storedMapKey: k1 });
    } finally {
      chmodSync(blocked, 0o644);
    }
    // The unreadable file goes away so the next scan can complete.
    rmSync(blocked, { force: true });
    expect(incomplete.complete).toBe(false);
    await save(storage, incomplete);

    // Logging back in returns the input key to K1; the appended family event is stored.
    const back = quiet({ accounts: loggedIn, cursors: await storage.listCodexEventCursors(), storedMapKey: await storage.getAppMeta(MAP_KEY) });
    expect(back.mapKey).toBe(k1);
    await save(storage, back);
    expect(await ownedTokens(storage)).toEqual([
      { providerId: "codex:codex", tokens: 100 },
      { providerId: "codex:family", tokens: 260 },
    ]);
  } finally {
    storage.close();
  }
});

test("a crash after the replace leaves the map key marked pending", async () => {
  const { codexHome, familyHome, sessions } = fixture();
  writeFileSync(join(sessions, "a.jsonl"), `${meta(MAIN_ID)}\n${line("2026-10-09T10:00:00.000Z", 100, 100, "plus", true)}\n`);
  const storage = new SqliteStorage();
  await storage.init();
  try {
    const accounts: CodexEventAccount[] = [
      { id: "codex:codex", homePath: codexHome, shape: "weekly-primary", planType: "plus", accountIdHash: sha256(MAIN_ID) },
      { id: "codex:family", homePath: familyHome, shape: "weekly-primary", planType: "plus", accountIdHash: sha256(FAMILY_ID) },
    ];
    await save(storage, quiet({ accounts, cursors: [], storedMapKey: null }));
    const k1 = await storage.getAppMeta(MAP_KEY);
    // A complete rescan under a new key; the process dies while saving the cursors.
    const rescan = quiet({
      accounts: accounts.map((account) => ({ ...account, shape: null })),
      cursors: await storage.listCodexEventCursors(),
      storedMapKey: k1,
    });
    expect(rescan.complete).toBe(true);
    storage.saveCodexEventCursors = async () => {
      throw new Error("simulated crash");
    };
    await expect(saveCodexEventScan(storage, rescan)).rejects.toThrow("simulated crash");
    expect(await storage.getAppMeta(MAP_KEY)).toBe("rescan-pending");
  } finally {
    storage.close();
  }
});

test("a rescan that assigns an ambiguous stored identity to a third account adds no row", async () => {
  fixture();
  const storage = new SqliteStorage();
  await storage.init();
  const stored = (providerId: string, tokens: number) => ({
    providerId,
    observedAt: "2026-10-09T12:00:00.000Z",
    tokens,
    input: tokens,
    cachedInput: 0,
    output: 0,
    planType: "plus",
    weeklyUsedPercent: 12,
    weeklyResetsAt: null,
    totalTokens: 1000,
  });
  try {
    // Two different events of two sessions with an equal time and cumulative total.
    await storage.upsertCodexTokenEvents([stored("codex:codex", 100), stored("codex:family", 200)]);
    const ids = ["codex:codex", "codex:family", "codex:third"];
    // The rescan reads one of them and assigns it to a third account.
    const result = (complete: boolean): CodexEventScanResult => ({
      events: [{ ...stored("codex:third", 100) }],
      cursors: [],
      filesRead: 1,
      mapKey: '[["codex:third"]]',
      learnedPlans: [],
      unmapped: 0,
      replaceProviderIds: ids,
      complete,
      readComplete: complete,
    });
    for (const complete of [false, false, true]) {
      await save(storage, result(complete));
      expect(await ownedTokens(storage)).toEqual([
        { providerId: "codex:codex", tokens: 100 },
        { providerId: "codex:family", tokens: 200 },
      ]);
    }
  } finally {
    storage.close();
  }
});
