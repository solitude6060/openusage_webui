import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OpenUsagePluginProvider } from "../src/index";
import {
  aggregateGrokSessionRecords,
  parseGrokSessionFile,
  scanGrokSessionUsage,
} from "../src/providers/grok-session-usage";
import { withIsolatedHome } from "./openusage-plugin-fixture-helpers";

function completedTurn(options: {
  timestamp: string;
  model: string;
  input: number;
  cached?: number;
  cacheWrite?: number;
  output?: number;
  reasoning?: number;
  costUsdTicks?: number;
  eventID?: string;
  agentTimestampMs?: number;
  numericTimestamp?: boolean;
  nested?: boolean;
  includePerModelCost?: boolean;
  additionalModels?: Record<string, Record<string, number>>;
  sessionUpdate?: string;
}): string {
  const cached = options.cached ?? 0;
  const cacheWrite = options.cacheWrite ?? 0;
  const output = options.output ?? 0;
  const reasoning = options.reasoning ?? 0;
  const nested = options.nested ?? true;
  const includePerModelCost = options.includePerModelCost ?? true;
  const sessionUpdate = options.sessionUpdate ?? "turn_completed";
  const modelValues: Record<string, number> = {
    inputTokens: options.input,
    cachedReadTokens: cached,
    cacheCreationTokens: cacheWrite,
    outputTokens: output,
    reasoningTokens: reasoning,
  };
  if (options.costUsdTicks !== undefined && includePerModelCost) {
    modelValues.costUsdTicks = options.costUsdTicks;
  }
  const models = { ...(options.additionalModels ?? {}), [options.model]: modelValues };
  const usage: Record<string, unknown> = {
    inputTokens: options.input,
    outputTokens: output,
    modelUsage: models,
  };
  if (options.costUsdTicks !== undefined) usage.costUsdTicks = options.costUsdTicks;
  const update = { sessionUpdate, usage };
  const metadata: Record<string, unknown> = {};
  if (options.eventID) metadata.eventId = options.eventID;
  if (options.agentTimestampMs !== undefined) metadata.agentTimestampMs = options.agentTimestampMs;

  const object: Record<string, unknown> = {
    timestamp: options.numericTimestamp
      ? Math.floor(Date.parse(options.timestamp) / 1000)
      : options.timestamp,
  };
  if (nested) {
    const params: Record<string, unknown> = { sessionId: "session-1", update };
    if (Object.keys(metadata).length > 0) params._meta = metadata;
    object.params = params;
    object.method = "session/update";
  } else {
    object.update = update;
    if (Object.keys(metadata).length > 0) object._meta = metadata;
  }
  return JSON.stringify(object);
}

async function spendSnapshot(now: Date, files: string[]) {
  return withIsolatedHome(async (home) => {
    const grokHome = join(home, "custom-grok");
    for (const [index, text] of files.entries()) {
      const file = join(grokHome, "sessions/work", String(index), "updates.jsonl");
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, text);
    }
    const provider = new OpenUsagePluginProvider({
      providerId: "grok",
      name: "Grok Build",
      pluginId: "grok",
      homeDir: home,
      env: { HOME: home, GROK_HOME: grokHome },
      now: () => now.toISOString(),
      scriptText: 'globalThis.__openusage_plugin = { id: "grok", probe: () => ({ lines: [] }) };',
    });
    const records = await provider.refresh();
    const lines = (records[0]?.raw as { lines: unknown[] }).lines;
    return { lines, records: records.slice(1) };
  });
}

describe("Grok session transcript parsing", () => {
  test.each([
    {},
    { numericTimestamp: true },
    { agentTimestampMs: new Date(2026, 5, 10, 0, 30).getTime() },
    { nested: false, agentTimestampMs: new Date(2026, 5, 10, 0, 30).getTime() },
  ])("preserves the turn timestamp alongside its UTC day: %j", (options) => {
    const timestamp = new Date(2026, 5, 10, 0, 30);
    const [entry] = parseGrokSessionFile(completedTurn({
      timestamp: timestamp.toISOString(),
      model: "grok-4.7-build",
      input: 100,
      ...options,
    }));

    expect(entry).toMatchObject({
      timestampMs: timestamp.getTime(),
      startedAt: `${timestamp.toISOString().slice(0, 10)}T00:00:00.000Z`,
    });
  });

  test("uses recorded per-model cost and does not count reasoning twice", () => {
    const [entry] = parseGrokSessionFile(completedTurn({
      timestamp: "2026-06-10T10:00:00.000Z",
      model: "grok-4.6-build",
      input: 1_000_000,
      cached: 700_000,
      output: 50_000,
      reasoning: 20_000,
      costUsdTicks: 2_357_158_800,
      eventID: "turn-1",
    }));

    expect(entry).toMatchObject({
      model: "grok-4.6-build",
      totalTokens: 1_050_000,
      inputTokens: 300_000,
      cacheReadTokens: 700_000,
      outputTokens: 50_000,
      costUsd: 0.23571588,
    });
  });

  test("splits a completed turn across models without duplicating the event", () => {
    const entries = parseGrokSessionFile(completedTurn({
      timestamp: "2026-06-10T10:00:00.000Z",
      model: "grok-4.5-build",
      input: 100,
      output: 20,
      costUsdTicks: 1_000_000_000,
      eventID: "shared-turn",
      additionalModels: {
        "grok-4.6-build": {
          inputTokens: 200,
          outputTokens: 30,
          costUsdTicks: 2_000_000_000,
        },
      },
    }));
    const records = aggregateGrokSessionRecords("grok", entries);

    expect(records.reduce((sum, record) => sum + (record.totalTokens ?? 0), 0)).toBe(350);
    expect(new Set(records.map((record) => record.model))).toEqual(
      new Set(["grok-4.5-build", "grok-4.6-build"]),
    );
  });

  test("counts a copied event once per model", () => {
    const line = completedTurn({
      timestamp: "2026-06-10T10:00:00.000Z",
      model: "grok-4.6-build",
      input: 1000,
      output: 0,
      eventID: "copied",
    });
    const records = aggregateGrokSessionRecords("grok", [
      ...parseGrokSessionFile(line),
      ...parseGrokSessionFile(line),
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]?.totalTokens).toBe(1000);
  });

  test("includes child-session turns with a different event id", () => {
    const parent = completedTurn({
      timestamp: "2026-06-10T10:00:00.000Z",
      model: "grok-4.6-build",
      input: 400,
      eventID: "parent",
    });
    const child = completedTurn({
      timestamp: "2026-06-10T11:00:00.000Z",
      model: "grok-4.6-build",
      input: 200,
      eventID: "child",
    });
    const records = aggregateGrokSessionRecords("grok", [
      ...parseGrokSessionFile(parent),
      ...parseGrokSessionFile(child),
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]?.totalTokens).toBe(600);
  });

  test("ignores turns that are not completed", () => {
    const entries = parseGrokSessionFile(completedTurn({
      timestamp: "2026-06-10T10:00:00.000Z",
      model: "grok-4.6-build",
      input: 1000,
      sessionUpdate: "turn_started",
    }));
    expect(entries).toEqual([]);
  });

  test("caps implausible token counts before aggregation", () => {
    const [entry] = parseGrokSessionFile(completedTurn({
      timestamp: "2026-06-10T10:00:00.000Z",
      model: "grok-4.6-build",
      input: 1,
      cached: 1,
      cacheWrite: 1,
      output: 1,
    }).replaceAll(":1", ":1e300"));

    expect(entry?.cacheReadTokens).toBe(1_000_000_000_000);
    expect(entry?.outputTokens).toBe(1_000_000_000_000);
    expect(entry?.totalTokens).toBe(2_000_000_000_000);
  });
});

describe("Grok session spend tiles", () => {
  const now = new Date(2026, 5, 10, 12);
  const today = new Date(2026, 5, 10, 10).toISOString();

  test("uses recorded cost and input plus output without adding reasoning again", async () => {
    const { lines } = await spendSnapshot(now, [completedTurn({
      timestamp: today,
      model: "grok-4.7-build",
      input: 1_000_000,
      cached: 700_000,
      output: 50_000,
      reasoning: 20_000,
      costUsdTicks: 2_357_158_800,
    })]);

    expect(lines).toEqual([
      { type: "text", label: "Today", value: "$0.24 · 1.1M tokens" },
      { type: "text", label: "Last 30 Days", value: "$0.24 · 1.1M tokens" },
    ]);
  });

  test("splits local 23:30 yesterday and 00:30 today at local midnight", async () => {
    const { lines } = await spendSnapshot(now, [[
      completedTurn({
        timestamp: new Date(2026, 5, 9, 23, 30).toISOString(),
        model: "grok-4.7-build",
        input: 100,
        costUsdTicks: 10_000_000_000,
      }),
      completedTurn({
        timestamp: new Date(2026, 5, 10, 0, 30).toISOString(),
        model: "grok-4.7-build",
        input: 200,
        costUsdTicks: 20_000_000_000,
      }),
    ].join("\n")]);

    expect(lines).toEqual([
      { type: "text", label: "Today", value: "$2.00 · 200 tokens" },
      { type: "text", label: "Yesterday", value: "$1.00 · 100 tokens" },
      { type: "text", label: "Last 30 Days", value: "$3.00 · 300 tokens" },
    ]);
  });

  test("adds uncosted tokens to mixed periods and shows uncosted periods as tokens only", async () => {
    const { lines } = await spendSnapshot(now, [[
      completedTurn({ timestamp: today, model: "grok-4.7-build", input: 100 }),
      completedTurn({
        timestamp: today,
        model: "grok-4.7-build",
        input: 200,
        costUsdTicks: 10_000_000_000,
      }),
      completedTurn({
        timestamp: new Date(2026, 5, 9, 12).toISOString(),
        model: "grok-4.7-build",
        input: 400,
      }),
    ].join("\n")]);

    expect(lines).toEqual([
      { type: "text", label: "Today", value: "$1.00 · 300 tokens" },
      { type: "text", label: "Yesterday", value: "400 tokens" },
      { type: "text", label: "Last 30 Days", value: "$1.00 · 700 tokens" },
    ]);
  });

  test("shows tokens only when every entry has no recorded cost", async () => {
    const { lines } = await spendSnapshot(now, [completedTurn({
      timestamp: today, model: "grok-4.7-build", input: 2_100_000_000,
    })]);
    expect(lines).toEqual([
      { type: "text", label: "Today", value: "2.1B tokens" },
      { type: "text", label: "Last 30 Days", value: "2.1B tokens" },
    ]);
  });

  test("keeps a recorded zero cost in the dollar label", async () => {
    const { lines } = await spendSnapshot(now, [completedTurn({
      timestamp: today, model: "grok-4.7-build", input: 100, costUsdTicks: 0,
    })]);
    expect(lines).toEqual([
      { type: "text", label: "Today", value: "$0.00 · 100 tokens" },
      { type: "text", label: "Last 30 Days", value: "$0.00 · 100 tokens" },
    ]);
  });

  test("uses the exact rolling 30-day window ending at now", async () => {
    const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    const { lines } = await spendSnapshot(now, [[
      completedTurn({ timestamp: new Date(cutoff).toISOString(), model: "grok-4.7-build", input: 100 }),
      completedTurn({ timestamp: new Date(cutoff - 1).toISOString(), model: "grok-4.7-build", input: 200 }),
      completedTurn({ timestamp: now.toISOString(), model: "grok-4.7-build", input: 300 }),
      completedTurn({ timestamp: new Date(now.getTime() + 1).toISOString(), model: "grok-4.7-build", input: 400 }),
    ].join("\n")]);
    expect(lines).toEqual([
      { type: "text", label: "Today", value: "300 tokens" },
      { type: "text", label: "Last 30 Days", value: "400 tokens" },
    ]);
  });

  test("omits periods with no tokens", async () => {
    const { lines } = await spendSnapshot(now, [completedTurn({
      timestamp: today, model: "grok-4.7-build", input: 0, costUsdTicks: 10_000_000_000,
    })]);
    expect(lines).toEqual([]);
  });

  test("counts copied events once per model in both tiles and token records", async () => {
    const line = completedTurn({
      timestamp: today,
      model: "grok-4.7-build",
      input: 400,
      costUsdTicks: 10_000_000_000,
      eventID: "copied",
      additionalModels: {
        "grok-4.6-build": { inputTokens: 100, costUsdTicks: 20_000_000_000 },
      },
    });
    const { lines, records } = await spendSnapshot(now, [line, line]);
    expect(lines).toEqual([
      { type: "text", label: "Today", value: "$3.00 · 500 tokens" },
      { type: "text", label: "Last 30 Days", value: "$3.00 · 500 tokens" },
    ]);
    for (const hourly of [false, true]) {
      const rows = records.filter((record) => Boolean(record.endedAt) === hourly);
      expect(rows.reduce((sum, record) => sum + (record.totalTokens ?? 0), 0)).toBe(500);
      expect(rows.reduce((sum, record) => sum + (record.costUsd ?? 0), 0)).toBe(3);
    }
  });
});

describe("Grok session filesystem scan", () => {
  test("reads nested updates.jsonl files and respects GROK_HOME", async () => {
    await withIsolatedHome(async (home) => {
      const grokHome = join(home, "custom-grok");
      const file = join(grokHome, "sessions/work/s1/updates.jsonl");
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(
        file,
        completedTurn({
          timestamp: "2026-06-10T10:00:00.000Z",
          model: "grok-4.6-build",
          input: 80,
          output: 20,
        }) + "\n",
      );

      const records = scanGrokSessionUsage({
        providerId: "grok",
        homeDir: home,
        env: { GROK_HOME: grokHome },
      }).filter((record) => record.endedAt === undefined);

      expect(records).toEqual([
        expect.objectContaining({
          providerId: "grok",
          tool: "Grok Session",
          model: "grok-4.6-build",
          totalTokens: 100,
          startedAt: "2026-06-10T00:00:00.000Z",
          source: "local-log",
        }),
      ]);
    });
  });

  test("reads nested subagent transcripts and dedups a copied event id across files", async () => {
    await withIsolatedHome(async (home) => {
      const parent = join(home, ".grok/sessions/work/parent/updates.jsonl");
      const child = join(home, ".grok/sessions/work/parent/subagents/worker/updates.jsonl");
      const copy = join(home, ".grok/sessions/work/fork/updates.jsonl");
      mkdirSync(join(parent, ".."), { recursive: true });
      mkdirSync(join(child, ".."), { recursive: true });
      mkdirSync(join(copy, ".."), { recursive: true });
      writeFileSync(
        parent,
        completedTurn({
          timestamp: "2026-06-10T10:00:00.000Z",
          model: "grok-4.6-build",
          input: 400,
          eventID: "parent-turn",
        }) + "\n",
      );
      writeFileSync(
        child,
        completedTurn({
          timestamp: "2026-06-10T11:00:00.000Z",
          model: "grok-4.6-build",
          input: 200,
          eventID: "child-turn",
        }) + "\n",
      );
      writeFileSync(
        copy,
        completedTurn({
          timestamp: "2026-06-10T10:00:00.000Z",
          model: "grok-4.6-build",
          input: 400,
          eventID: "parent-turn",
        }) + "\n",
      );

      const records = scanGrokSessionUsage({ providerId: "grok", homeDir: home })
        .filter((record) => record.endedAt === undefined);
      expect(records).toHaveLength(1);
      expect(records[0]?.totalTokens).toBe(600);
    });
  });

  test("returns no records when the sessions directory is missing", async () => {
    await withIsolatedHome(async (home) => {
      expect(scanGrokSessionUsage({ providerId: "grok", homeDir: home })).toEqual([]);
    });
  });
});
