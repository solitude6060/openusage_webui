import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachCodexEventScan, saveCodexEventScan } from "../src/codex-event-refresh";
import {
  scanCodexSessionEvents,
  type CodexEventAccount,
  type CodexEventCursor,
  type CodexEventScanInput,
} from "../../../packages/providers/src/codex-session-events";
import type { OpenUsagePluginProvider } from "../../../packages/providers/src/index";
import { SqliteStorage } from "../../../packages/storage/src/index";

// Fake ids only. Real account ids never belong in fixtures.
const MAIN_ID = "acct-fake-main-0001";
const FAMILY_ID = "acct-fake-family-0002";
const SECRET = "fake-access-token-do-not-store";
const FROM = "2026-08-01T00:00:00.000Z";
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
  dataDir = mkdtempSync(join(tmpdir(), "openusage-codex-retention-db-"));
  homeRoot = mkdtempSync(join(tmpdir(), "openusage-codex-retention-home-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  const codexHome = join(homeRoot, "codex");
  const familyHome = join(homeRoot, "family");
  const sessions = join(codexHome, "sessions");
  mkdirSync(sessions, { recursive: true });
  mkdirSync(familyHome, { recursive: true });
  symlinkSync(sessions, join(familyHome, "sessions"));
  return { codexHome, familyHome, sessions };
}

function stored(observedAt: string, tokens: number, providerId = "codex:family") {
  return {
    providerId,
    observedAt,
    tokens,
    input: tokens,
    cachedInput: 0,
    output: 0,
    planType: "plus",
    weeklyUsedPercent: 10,
    weeklyResetsAt: null,
    totalTokens: tokens,
  };
}

function sessionFile(creator: string, timestamp: string, total: number): string {
  const meta = JSON.stringify({ timestamp, type: "session_meta", payload: { creator_account_id: creator } });
  const event = JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { input_tokens: total, total_tokens: total },
        last_token_usage: { input_tokens: total, total_tokens: total },
      },
      rate_limits: {
        plan_type: "plus",
        primary: { used_percent: 10, window_minutes: 300, resets_at: RESETS_AT },
        secondary: { used_percent: 20, window_minutes: 10080, resets_at: RESETS_AT },
      },
    },
  });
  return `${meta}\n${event}\n`;
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

test("a rescan keeps stored events older than the earliest rescanned event", async () => {
  const { codexHome, familyHome, sessions } = fixture();
  writeFileSync(join(sessions, "a.jsonl"), sessionFile(MAIN_ID, "2026-10-09T12:30:00.000Z", 100));
  const storage = new SqliteStorage();
  await storage.init();
  try {
    // A September event whose file is gone, and the October event the file still holds.
    await storage.upsertCodexTokenEvents([
      stored("2026-09-01T08:00:00.000Z", 500),
      stored("2026-10-09T12:30:00.000Z", 100),
    ]);
    const accounts: CodexEventAccount[] = [
      { id: "codex:codex", homePath: codexHome, shape: "five-hour-primary", planType: "plus", accountIdHash: sha256(MAIN_ID) },
      { id: "codex:family", homePath: familyHome, shape: "five-hour-primary", planType: "plus", accountIdHash: sha256(FAMILY_ID) },
    ];
    const result = scanCodexSessionEvents({ accounts, cursors: [], storedMapKey: "older-key" });
    expect(result.replaceProviderIds).toEqual(["codex:codex", "codex:family"]);
    expect((result as { replaceFrom?: string | null }).replaceFrom).toBe("2026-10-09T12:30:00.000Z");
    await saveCodexEventScan(storage, result);
    expect(await ownedTokens(storage)).toEqual([
      { providerId: "codex:codex", tokens: 100 },
      { providerId: "codex:family", tokens: 500 },
    ]);
    expect(await storage.getAppMeta("codex_event_map_key")).not.toContain(MAIN_ID);
  } finally {
    storage.close();
  }
});

test("each Codex account in the scan input carries the SHA-256 of its auth.json account id only", async () => {
  const { codexHome, familyHome } = fixture();
  writeFileSync(join(codexHome, "auth.json"), JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: { account_id: MAIN_ID, access_token: SECRET, refresh_token: SECRET, id_token: SECRET },
  }));
  const storage = new SqliteStorage();
  await storage.init();
  try {
    await storage.upsertProviderAccount({
      id: "codex:codex", providerId: "codex", label: "Codex", homePath: codexHome, enabled: true, sortOrder: 0,
    });
    await storage.upsertProviderAccount({
      id: "codex:family", providerId: "codex", label: "Family", homePath: familyHome, enabled: true, sortOrder: 1,
    });
    let captured: CodexEventScanInput | null = null;
    const provider = {
      id: "codex:codex",
      codexHomePath: () => codexHome,
      setCodexEventScan: (input: CodexEventScanInput | null) => {
        captured = input;
      },
    } as unknown as OpenUsagePluginProvider;
    await attachCodexEventScan(storage, provider);
    const input = captured as CodexEventScanInput | null;
    expect(input?.accounts.map((account) => [account.id, account.accountIdHash ?? null])).toEqual([
      ["codex:codex", sha256(MAIN_ID)],
      ["codex:family", null],
    ]);
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain(MAIN_ID);
    expect(serialized).not.toContain(SECRET);
  } finally {
    storage.close();
  }
});

test("an auth.json that cannot be parsed leaves events, cursors and the mapping key unchanged", async () => {
  const { codexHome, familyHome, sessions } = fixture();
  writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ tokens: { account_id: MAIN_ID } }));
  writeFileSync(join(familyHome, "auth.json"), JSON.stringify({ tokens: { account_id: FAMILY_ID } }));
  writeFileSync(join(sessions, "a.jsonl"), sessionFile(FAMILY_ID, "2026-10-09T12:30:00.000Z", 100));
  const storage = new SqliteStorage();
  await storage.init();
  const errors: string[] = [];
  const original = console.error;
  try {
    await storage.upsertProviderAccount({
      id: "codex:codex", providerId: "codex", label: "Codex", homePath: codexHome, enabled: true, sortOrder: 0,
    });
    await storage.upsertProviderAccount({
      id: "codex:family", providerId: "codex", label: "Family", homePath: familyHome, enabled: true, sortOrder: 1,
    });
    let captured: CodexEventScanInput | null = null;
    const provider = {
      id: "codex:codex",
      codexHomePath: () => codexHome,
      setCodexEventScan: (input: CodexEventScanInput | null) => {
        captured = input;
      },
    } as unknown as OpenUsagePluginProvider;
    const refresh = async () => {
      captured = null;
      await attachCodexEventScan(storage, provider);
      const input = captured as CodexEventScanInput | null;
      if (input) await saveCodexEventScan(storage, scanCodexSessionEvents(input));
    };
    await refresh();
    expect(await ownedTokens(storage)).toEqual([{ providerId: "codex:family", tokens: 100 }]);
    const mapKey = await storage.getAppMeta("codex_event_map_key");
    const cursors = cursorSnapshot(await storage.listCodexEventCursors());

    // A truncated write, as when Codex rewrites auth.json during a token refresh.
    writeFileSync(join(familyHome, "auth.json"), `{"tokens": {"account_id": "${FAMILY_ID.slice(0, 8)}`);
    console.error = (...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(" "));
    };
    await refresh();
    console.error = original;
    expect(await ownedTokens(storage)).toEqual([{ providerId: "codex:family", tokens: 100 }]);
    expect(await storage.getAppMeta("codex_event_map_key")).toBe(mapKey);
    expect(cursorSnapshot(await storage.listCodexEventCursors())).toEqual(cursors);
    expect(errors.join("\n")).toContain("codex_account_id_unreadable");
    expect(errors.join("\n")).not.toContain(FAMILY_ID.slice(0, 8));
  } finally {
    console.error = original;
    storage.close();
  }
});

function cursorSnapshot(cursors: CodexEventCursor[]): CodexEventCursor[] {
  return cursors
    .map((cursor) => ({ ...cursor }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
