import { describe, expect, test } from "bun:test";
import { openAiTokenCostUsd } from "../src/openai-token-rates";
import { normalizeCcusageDailyRecords } from "../src/providers/structured-usage";

describe("OpenAI token rates", () => {
  test("prices one million tokens at the published standard short-context rate", () => {
    expect(openAiTokenCostUsd("gpt-6-astra", { inputTokens: 1_000_000 })).toBe(10);
    expect(openAiTokenCostUsd("gpt-6-astra", { cacheReadTokens: 1_000_000 })).toBe(1);
    expect(openAiTokenCostUsd("gpt-6-astra", { cacheCreationTokens: 1_000_000 })).toBe(12.5);
    expect(openAiTokenCostUsd("gpt-6-astra", { outputTokens: 1_000_000 })).toBe(50);
    expect(openAiTokenCostUsd("gpt-6-sol", { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 1_000_000 }))
      .toBe(12.2);
    expect(openAiTokenCostUsd("gpt-6.1-sol", { cacheReadTokens: 1_000_000 })).toBe(0.1);
    expect(openAiTokenCostUsd("gpt-6-luna", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0.6);
    expect(openAiTokenCostUsd("gpt-5.6-luna", { outputTokens: 1_000_000 })).toBe(1.2);
    expect(openAiTokenCostUsd("gpt-5.6-sol", { inputTokens: 1_000_000 })).toBe(4);
    expect(openAiTokenCostUsd("gpt-5.6-terra", { outputTokens: 1_000_000 })).toBe(12);
    expect(openAiTokenCostUsd("gpt-unknown", { inputTokens: 1_000_000 })).toBeUndefined();
  });

  test("splits a ccusage day total across models with the rate table", () => {
    const records = normalizeCcusageDailyRecords("codex:codex", [
      {
        date: "2026-09-23",
        costUSD: 82.75361146,
        totalTokens: 90_518_097,
        models: {
          "gpt-5.6-luna": { inputTokens: 838203, outputTokens: 17257, cacheReadTokens: 3721472, totalTokens: 4576932 },
          "gpt-6-astra": { inputTokens: 1921672, outputTokens: 161438, cacheReadTokens: 42733056, totalTokens: 44816166 },
          "gpt-6-luna": { inputTokens: 64599, outputTokens: 9096, cacheReadTokens: 552192, totalTokens: 625887 },
          "gpt-6-sol": { inputTokens: 1611478, outputTokens: 148178, cacheReadTokens: 38739456, totalTokens: 40499112 },
        },
      },
    ]);

    const cost = Object.fromEntries(records.map((record) => [record.model, record.costUsd]));
    expect(cost["gpt-5.6-luna"]).toBeCloseTo(0.26277844, 8);
    expect(cost["gpt-6-astra"]).toBeCloseTo(70.021676, 8);
    expect(cost["gpt-6-luna"]).toBeCloseTo(0.01652982, 8);
    expect(cost["gpt-6-sol"]).toBeCloseTo(12.4526272, 8);
    expect(Object.values(cost).reduce((sum, value) => sum + (value ?? 0), 0)).toBeCloseTo(82.75361146, 8);
  });

  test("keeps a model price that ccusage already split", () => {
    const records = normalizeCcusageDailyRecords("codex:codex", [
      {
        date: "2026-09-10",
        costUSD: 99,
        models: {
          "gpt-6-astra": { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000, costUSD: 3 },
        },
      },
    ]);

    expect(records.map((record) => record.costUsd)).toEqual([3]);
  });

  test("does not park a shared day total on the first unpriced model", () => {
    const records = normalizeCcusageDailyRecords("codex:codex", [
      {
        date: "2026-09-10",
        costUSD: 9,
        models: {
          "custom-a": { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          "custom-b": { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        },
      },
    ]);

    expect(records.map((record) => record.costUsd)).toEqual([undefined, undefined]);
  });
});

describe("ccusage reported cost precedence", () => {
  test("keeps a single model's reported day total before estimating", () => {
    const [record] = normalizeCcusageDailyRecords("codex:codex", [{
      date: "2026-09-30", costUSD: 20,
      models: { "gpt-6-astra": { inputTokens: 1_000_000 } },
    }]);
    expect(record!.costUsd).toBe(20);
    expect(record!.raw).toMatchObject({ costSource: "reported-day" });
  });

  test("does not assign a residual based on estimated model costs", () => {
    const records = normalizeCcusageDailyRecords("codex:codex", [{
      date: "2026-09-30", costUSD: 25,
      models: { "gpt-6-astra": { inputTokens: 1_000_000 }, custom: { inputTokens: 100 } },
    }]);
    expect(records.map((record) => record.costUsd)).toEqual([10, undefined]);
    expect(records[0]!.raw).toMatchObject({ costSource: "standard-rate" });
    expect((records[1]!.raw as Record<string, unknown> | undefined)?.costSource).toBeUndefined();
  });

  test("assigns a residual from explicitly reported model costs", () => {
    const records = normalizeCcusageDailyRecords("codex:codex", [{
      date: "2026-09-30", costUSD: 25,
      models: { "gpt-6-astra": { inputTokens: 1_000_000, costUSD: 10 }, custom: { inputTokens: 100 } },
    }]);
    expect(records.map((record) => record.costUsd)).toEqual([10, 15]);
    expect(records[0]!.raw).toMatchObject({ costSource: "reported-model" });
    expect(records[1]!.raw).toMatchObject({ costSource: "reported-day" });
  });

  test("keeps an explicitly reported zero", () => {
    const [record] = normalizeCcusageDailyRecords("codex:codex", [{
      date: "2026-09-30", costUSD: 20,
      models: { "gpt-6-astra": { inputTokens: 1_000_000, costUSD: 0 } },
    }]);
    expect(record!.costUsd).toBe(0);
    expect(record!.raw).toMatchObject({ costSource: "reported-model" });
  });

  test("does not apply OpenAI rates to another provider's model names", () => {
    const [record] = normalizeCcusageDailyRecords("claude-code:work", [{
      date: "2026-09-30", models: { "gpt-6-astra": { inputTokens: 1_000_000 } },
    }]);
    expect(record!.costUsd).toBeUndefined();
  });
});
