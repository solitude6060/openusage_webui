import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanCodexSessionEvents, type CodexEventAccount } from "../src/codex-session-events";

// Fake ids only. Real account ids never belong in fixtures.
const MAIN_ID = "acct-fake-main-0001";
const FAMILY_ID = "acct-fake-family-0002";
const OTHER_ID = "acct-fake-other-0003";
const RESETS_AT = Math.floor(Date.parse("2026-10-16T00:00:00.000Z") / 1000);

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Two homes share one real sessions directory, as on the owner's machine.
function sharedHomes(): { sessions: string; codexHome: string; familyHome: string } {
  const root = mkdtempSync(join(tmpdir(), "openusage-codex-attribution-"));
  tempDirs.push(root);
  const codexHome = join(root, "codex");
  const familyHome = join(root, "family");
  const sessions = join(codexHome, "sessions");
  mkdirSync(sessions, { recursive: true });
  mkdirSync(familyHome, { recursive: true });
  symlinkSync(sessions, join(familyHome, "sessions"));
  return { sessions, codexHome, familyHome };
}

function metaLine(creator: string): string {
  return JSON.stringify({
    timestamp: "2026-10-09T12:00:00.000Z",
    type: "session_meta",
    payload: { id: "session-fake", creator_account_id: creator, base_instructions: { text: "x".repeat(70_000) } },
  });
}

function eventLine(options: { timestamp: string; total: number; last: number; plan?: string; shaped?: boolean }): string {
  const shaped = options.shaped ?? true;
  return JSON.stringify({
    timestamp: options.timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: usage(options.total),
        last_token_usage: usage(options.last),
      },
      rate_limits: {
        plan_type: options.plan ?? "plus",
        primary: { used_percent: 10, window_minutes: shaped ? 300 : 1, resets_at: RESETS_AT },
        secondary: shaped ? { used_percent: 20, window_minutes: 10080, resets_at: RESETS_AT } : null,
      },
    },
  });
}

function usage(total: number) {
  return { input_tokens: total, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: total };
}

function file(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

function owners(events: Array<{ providerId: string; tokens: number }>) {
  return events
    .map((event) => ({ providerId: event.providerId, tokens: event.tokens }))
    .sort((left, right) => left.tokens - right.tokens);
}

describe("Codex event attribution by session creator", () => {
  test("two homes with the same plan and shape split events by session creator", () => {
    const { sessions, codexHome, familyHome } = sharedHomes();
    writeFileSync(join(sessions, "a.jsonl"), file(metaLine(MAIN_ID), eventLine({ timestamp: "2026-10-09T12:30:00.000Z", total: 100, last: 100 })));
    writeFileSync(join(sessions, "b.jsonl"), file(metaLine(FAMILY_ID), eventLine({ timestamp: "2026-10-09T12:40:00.000Z", total: 200, last: 200 })));
    const accounts: CodexEventAccount[] = [
      { id: "codex:codex", homePath: codexHome, shape: "five-hour-primary", planType: "plus", accountIdHash: sha256(MAIN_ID) },
      { id: "codex:family", homePath: familyHome, shape: "five-hour-primary", planType: "plus", accountIdHash: sha256(FAMILY_ID) },
    ];
    const result = scanCodexSessionEvents({ accounts, cursors: [], storedMapKey: null });
    expect(owners(result.events)).toEqual([
      { providerId: "codex:codex", tokens: 100 },
      { providerId: "codex:family", tokens: 200 },
    ]);
    expect(result.unmapped).toBe(0);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(MAIN_ID);
    expect(serialized).not.toContain(FAMILY_ID);
  });

  test("a session without a matching creator falls back to the shape and plan rule", () => {
    const { sessions, codexHome, familyHome } = sharedHomes();
    // No session_meta line: the five-hour shape picks codex:codex.
    writeFileSync(join(sessions, "one.jsonl"), file(eventLine({ timestamp: "2026-10-09T12:30:00.000Z", total: 10, last: 10, plan: "prolite" })));
    // Unknown creator and no shape: the recorded plan picks codex:family.
    writeFileSync(join(sessions, "two.jsonl"), file(metaLine(OTHER_ID), eventLine({ timestamp: "2026-10-09T12:40:00.000Z", total: 20, last: 20, shaped: false })));
    // Matching creator wins over the shape rule, and does not teach a plan.
    writeFileSync(join(sessions, "three.jsonl"), file(metaLine(FAMILY_ID), eventLine({ timestamp: "2026-10-09T12:50:00.000Z", total: 30, last: 30 })));
    const accounts: CodexEventAccount[] = [
      { id: "codex:codex", homePath: codexHome, shape: "five-hour-primary", planType: null, accountIdHash: sha256(MAIN_ID) },
      { id: "codex:family", homePath: familyHome, shape: null, planType: "plus", accountIdHash: sha256(FAMILY_ID) },
    ];
    const result = scanCodexSessionEvents({ accounts, cursors: [], storedMapKey: null });
    expect(owners(result.events)).toEqual([
      { providerId: "codex:codex", tokens: 10 },
      { providerId: "codex:family", tokens: 20 },
      { providerId: "codex:family", tokens: 30 },
    ]);
    expect(result.learnedPlans).toEqual([{ providerId: "codex:codex", planType: "prolite" }]);
  });

  test("a changed account id hash rescans the files", () => {
    const { sessions, codexHome, familyHome } = sharedHomes();
    writeFileSync(join(sessions, "a.jsonl"), file(metaLine(MAIN_ID), eventLine({ timestamp: "2026-10-09T12:30:00.000Z", total: 100, last: 100 })));
    const unhashed: CodexEventAccount[] = [
      { id: "codex:codex", homePath: codexHome, shape: "five-hour-primary", planType: "plus" },
      { id: "codex:family", homePath: familyHome, shape: "five-hour-primary", planType: "plus" },
    ];
    const first = scanCodexSessionEvents({ accounts: unhashed, cursors: [], storedMapKey: null });
    expect(first.events).toEqual([]);
    const second = scanCodexSessionEvents({
      accounts: [
        { ...unhashed[0]!, accountIdHash: sha256(MAIN_ID) },
        { ...unhashed[1]!, accountIdHash: sha256(FAMILY_ID) },
      ],
      cursors: first.cursors,
      storedMapKey: first.mapKey,
    });
    expect(second.filesRead).toBe(1);
    expect(second.replaceProviderIds).toEqual(["codex:codex", "codex:family"]);
    expect(owners(second.events)).toEqual([{ providerId: "codex:codex", tokens: 100 }]);
    expect(second.mapKey).not.toContain(MAIN_ID);
  });

  test("an appended slice of an already read file is still assigned by its creator", () => {
    const { sessions, codexHome, familyHome } = sharedHomes();
    const path = join(sessions, "a.jsonl");
    writeFileSync(path, file(metaLine(FAMILY_ID), eventLine({ timestamp: "2026-10-09T12:30:00.000Z", total: 100, last: 100 })));
    const accounts: CodexEventAccount[] = [
      { id: "codex:codex", homePath: codexHome, shape: "five-hour-primary", planType: "plus", accountIdHash: sha256(MAIN_ID) },
      { id: "codex:family", homePath: familyHome, shape: "five-hour-primary", planType: "plus", accountIdHash: sha256(FAMILY_ID) },
    ];
    const first = scanCodexSessionEvents({ accounts, cursors: [], storedMapKey: null });
    appendFileSync(path, file(eventLine({ timestamp: "2026-10-09T12:45:00.000Z", total: 160, last: 60 })));
    const second = scanCodexSessionEvents({ accounts, cursors: first.cursors, storedMapKey: first.mapKey });
    expect(second.replaceProviderIds).toEqual([]);
    expect(owners(second.events)).toEqual([{ providerId: "codex:family", tokens: 60 }]);
  });
});
