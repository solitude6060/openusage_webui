import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexSessionScanRoots,
  meterShapeFromObservations,
  scanCodexSessionEvents,
  type CodexEventAccount,
} from "../src/codex-session-events";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "openusage-codex-events-"));
  tempDirs.push(dir);
  return dir;
}

function usage(total: number, input = total, cached = 0, output = 0) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: total,
  };
}

function tokenLine(options: {
  timestamp: string;
  plan: string;
  total: number;
  last: number;
  primaryMinutes: number;
  primaryPercent: number;
  resetsAt: number;
  secondary?: { minutes: number; percent: number; resetsAt: number } | null;
}): string {
  return JSON.stringify({
    timestamp: options.timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: usage(options.total, options.total, 10, 5),
        last_token_usage: usage(options.last, options.last, 4, 1),
      },
      rate_limits: {
        plan_type: options.plan,
        primary: {
          used_percent: options.primaryPercent,
          window_minutes: options.primaryMinutes,
          resets_at: options.resetsAt,
        },
        secondary: options.secondary
          ? {
              used_percent: options.secondary.percent,
              window_minutes: options.secondary.minutes,
              resets_at: options.secondary.resetsAt,
            }
          : null,
      },
    },
  });
}

const WEEKLY_RESET = Math.floor(Date.parse("2026-10-16T00:00:00.000Z") / 1000);

describe("Codex session event scan", () => {
  test("maps both plan shapes, skips an unchanged total, and reads a symlink once", () => {
    const root = tempRoot();
    const codexHome = join(root, "codex");
    const familyHome = join(root, "family");
    const sessionDir = join(codexHome, "sessions", "2026", "10");
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(familyHome, { recursive: true });
    symlinkSync(join(codexHome, "sessions"), join(familyHome, "sessions"));
    const file = join(sessionDir, "rollout.jsonl");
    const lines = [
      JSON.stringify({
        timestamp: "2026-10-09T12:00:00.000Z",
        type: "session_meta",
        payload: { creator_account_id: "not-an-account", prompt: "do not store this text" },
      }),
      tokenLine({
        timestamp: "2026-10-09T12:30:00.000Z",
        plan: "prolite",
        total: 100,
        last: 100,
        primaryMinutes: 10080,
        primaryPercent: 12,
        resetsAt: WEEKLY_RESET,
        secondary: null,
      }),
      tokenLine({
        timestamp: "2026-10-09T12:31:00.000Z",
        plan: "prolite",
        total: 100,
        last: 999,
        primaryMinutes: 10080,
        primaryPercent: 12,
        resetsAt: WEEKLY_RESET,
        secondary: null,
      }),
      tokenLine({
        timestamp: "2026-10-09T12:40:00.000Z",
        plan: "plus",
        total: 40,
        last: 40,
        primaryMinutes: 300,
        primaryPercent: 80,
        resetsAt: WEEKLY_RESET - 3600,
        secondary: { minutes: 10080, percent: 4, resetsAt: WEEKLY_RESET },
      }),
    ];
    writeFileSync(file, `${lines.join("\n")}\n`);

    const accounts: CodexEventAccount[] = [
      { id: "codex:codex", homePath: codexHome, shape: "weekly-primary", planType: null },
      { id: "codex:family", homePath: familyHome, shape: "five-hour-primary", planType: null },
    ];
    expect(codexSessionScanRoots(accounts)).toHaveLength(1);

    const first = scanCodexSessionEvents({ accounts, cursors: [], storedMapKey: null });
    expect(first.filesRead).toBe(1);
    expect(first.unmapped).toBe(0);
    expect(first.events.map((event) => ({
      providerId: event.providerId,
      tokens: event.tokens,
      planType: event.planType,
      weeklyUsedPercent: event.weeklyUsedPercent,
      totalTokens: event.totalTokens,
    }))).toEqual([
      {
        providerId: "codex:codex",
        tokens: 100,
        planType: "prolite",
        weeklyUsedPercent: 12,
        totalTokens: 100,
      },
      {
        providerId: "codex:family",
        tokens: 40,
        planType: "plus",
        weeklyUsedPercent: 4,
        totalTokens: 40,
      },
    ]);
    expect(JSON.stringify(first)).not.toContain("not-an-account");
    expect(JSON.stringify(first)).not.toContain("do not store");
    expect(first.events[0]?.weeklyResetsAt).toBe("2026-10-16T00:00:00.000Z");
    expect(first.learnedPlans.map((item) => item.planType).sort()).toEqual(["plus", "prolite"]);

    const recorded = accounts.map((account) => ({
      ...account,
      planType: first.learnedPlans.find((item) => item.providerId === account.id)?.planType ?? null,
    }));
    const second = scanCodexSessionEvents({
      accounts: recorded,
      cursors: first.cursors,
      storedMapKey: first.mapKey,
    });
    expect(second.events).toEqual([]);
    expect(second.filesRead).toBe(0);

    appendFileSync(file, `${tokenLine({
      timestamp: "2026-10-09T13:00:00.000Z",
      plan: "prolite",
      total: 150,
      last: 50,
      primaryMinutes: 10080,
      primaryPercent: 18,
      resetsAt: WEEKLY_RESET,
      secondary: null,
    })}\n`);
    const third = scanCodexSessionEvents({
      accounts: recorded,
      cursors: second.cursors,
      storedMapKey: second.mapKey,
    });
    expect(third.events.map((event) => ({ providerId: event.providerId, tokens: event.tokens, totalTokens: event.totalTokens }))).toEqual([
      { providerId: "codex:codex", tokens: 50, totalTokens: 150 },
    ]);
  });

  test("uses a recorded plan when the quota shape is missing", () => {
    const root = tempRoot();
    const home = join(root, "codex");
    mkdirSync(join(home, "sessions"), { recursive: true });
    writeFileSync(join(home, "sessions", "one.jsonl"), `${tokenLine({
      timestamp: "2026-10-09T12:30:00.000Z",
      plan: "plus",
      total: 40,
      last: 40,
      primaryMinutes: 300,
      primaryPercent: 10,
      resetsAt: WEEKLY_RESET,
      secondary: { minutes: 10080, percent: 3, resetsAt: WEEKLY_RESET },
    })}\n`);
    const result = scanCodexSessionEvents({
      accounts: [
        { id: "codex:codex", homePath: home, shape: null, planType: "prolite" },
        { id: "codex:family", homePath: join(root, "missing"), shape: null, planType: "plus" },
      ],
      cursors: [],
      storedMapKey: null,
    });
    expect(result.events.map((event) => event.providerId)).toEqual(["codex:family"]);
  });
});

describe("meter shape from quota observations", () => {
  test("a 7-day session is weekly-primary and a 5-hour session plus weekly is the other account", () => {
    expect(meterShapeFromObservations([
      {
        windowKey: "session",
        periodMs: 7 * 24 * 60 * 60 * 1000,
        present: true,
        observedAt: "2026-10-09T00:00:00.000Z",
        resetsAt: "2026-10-16T00:00:00.000Z",
      },
    ])).toBe("weekly-primary");
    expect(meterShapeFromObservations([
      {
        windowKey: "session",
        periodMs: 5 * 60 * 60 * 1000,
        present: true,
        observedAt: "2026-10-09T12:00:00.000Z",
        resetsAt: "2026-10-09T17:00:00.000Z",
      },
      {
        windowKey: "weekly",
        periodMs: 7 * 24 * 60 * 60 * 1000,
        present: true,
        observedAt: "2026-10-09T12:00:00.000Z",
        resetsAt: "2026-10-16T00:00:00.000Z",
      },
    ])).toBe("five-hour-primary");
    expect(meterShapeFromObservations([
      {
        windowKey: "session",
        periodMs: 5 * 60 * 60 * 1000,
        present: true,
        observedAt: "2026-10-09T00:00:00.000Z",
        resetsAt: "2026-10-16T00:00:00.000Z",
      },
    ])).toBe("weekly-primary");
  });
});
