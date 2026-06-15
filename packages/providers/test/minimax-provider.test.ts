import { describe, expect, test } from "bun:test";
import { getProviders, MiniMaxProvider } from "../src/index";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("MiniMaxProvider", () => {
  test("detects missing API keys and fails refresh without network calls", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new MiniMaxProvider({
      env: {},
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return response({});
      },
    });

    await expect(provider.detect()).resolves.toBe(false);
    await expect(provider.refresh()).rejects.toThrow(
      "MiniMax API key missing. Set MINIMAX_API_KEY, MINIMAX_API_TOKEN, or MINIMAX_CN_API_KEY.",
    );
    expect(calls).toEqual([]);
  });

  test("queries global token plan remains with bearer auth", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new MiniMaxProvider({
      env: { MINIMAX_API_KEY: "global-key" },
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return response({
          data: {
            current_subscribe_title: "MiniMax Coding Plan: Pro",
            model_remains: [
              {
                model_name: "MiniMax-M2",
                current_interval_total_count: 100,
                current_interval_usage_count: 70,
                start_time: 1771747200,
                end_time: 1771765200,
              },
            ],
          },
          base_resp: { status_code: 0 },
        });
      },
    });

    const records = await provider.refresh();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://www.minimax.io/v1/token_plan/remains",
    });
    expect(calls[0]?.init?.headers).toEqual({
      Authorization: "Bearer global-key",
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      providerId: "minimax",
      tool: "MiniMax Token Plan",
      model: "MiniMax-M2",
      source: "api",
      startedAt: "2026-02-22T08:00:00.000Z",
      endedAt: "2026-02-22T13:00:00.000Z",
      raw: {
        region: "GLOBAL",
        planName: "Pro (GLOBAL)",
        quota: {
          format: "count",
          used: 30,
          limit: 100,
          remaining: 70,
          suffix: "prompts",
        },
      },
    });
    expect(records[0]?.totalTokens).toBeUndefined();
    expect(records[0]?.costUsd).toBeUndefined();
  });

  test("tries CN first and converts model-call counts to prompts", async () => {
    const calls: string[] = [];
    const provider = new MiniMaxProvider({
      env: { MINIMAX_CN_API_KEY: "cn-key", MINIMAX_API_KEY: "global-key" },
      fetch: async (url) => {
        calls.push(String(url));
        return response({
          data: {
            model_remains: [
              {
                model_name: "MiniMax-M2",
                current_interval_total_count: 1500,
                current_interval_usage_count: 1200,
                start_time: 1771747200,
                end_time: 1771765200,
              },
            ],
          },
          base_resp: { status_code: 0 },
        });
      },
    });

    const records = await provider.refresh();

    expect(calls[0]).toBe("https://api.minimaxi.com/v1/token_plan/remains");
    expect(records[0]?.raw).toMatchObject({
      region: "CN",
      planName: "Plus (CN)",
      quota: {
        used: 20,
        limit: 100,
        remaining: 80,
        suffix: "prompts",
      },
    });
  });

  test("uses percent fallback when count totals are not displayable", async () => {
    const provider = new MiniMaxProvider({
      env: { MINIMAX_API_TOKEN: "token-key" },
      fetch: async () =>
        response({
          data: {
            model_remains: [
              {
                model_name: "general",
                current_interval_total_count: 0,
                current_interval_remaining_percent: 42,
                end_time: 1771765200,
              },
            ],
          },
          base_resp: { status_code: 0 },
        }),
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({
      region: "GLOBAL",
      quota: {
        format: "percent",
        used: 58,
        limit: 100,
        remaining: 42,
      },
    });
  });

  test("does not scale CN percent fallback values", async () => {
    const provider = new MiniMaxProvider({
      env: { MINIMAX_CN_API_KEY: "cn-key" },
      fetch: async () =>
        response({
          data: {
            model_remains: [
              {
                model_name: "general",
                current_interval_total_count: 0,
                current_interval_remaining_percent: 87,
                end_time: 1771765200,
              },
            ],
          },
          base_resp: { status_code: 0 },
        }),
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({
      region: "CN",
      quota: {
        format: "percent",
        used: 13,
        limit: 100,
        remaining: 87,
      },
    });
  });

  test("keeps snapshot ids stable when start time is omitted", async () => {
    const provider = new MiniMaxProvider({
      env: { MINIMAX_API_KEY: "global-key" },
      fetch: async () =>
        response({
          data: {
            model_remains: [
              {
                model_name: "general",
                current_interval_total_count: 0,
                current_interval_remaining_percent: 42,
                end_time: 1771765200,
              },
            ],
          },
          base_resp: { status_code: 0 },
        }),
    });

    const first = await provider.refresh();
    const second = await provider.refresh();

    expect(second[0]?.id).toBe(first[0]?.id);
    expect(first[0]?.startedAt).toBe("2026-02-22T08:00:00.000Z");
    expect(first[0]?.endedAt).toBe("2026-02-22T13:00:00.000Z");
  });

  test("uses remains time from now as reset fallback when end time is omitted", async () => {
    const provider = new MiniMaxProvider({
      env: { MINIMAX_API_KEY: "global-key" },
      now: () => 1771761600000,
      fetch: async () =>
        response({
          data: {
            model_remains: [
              {
                model_name: "MiniMax-M2",
                current_interval_total_count: 100,
                current_interval_usage_count: 70,
                start_time: 1771747200,
                remains_time: 3600,
              },
            ],
          },
          base_resp: { status_code: 0 },
        }),
    });

    const records = await provider.refresh();

    expect(records[0]).toMatchObject({
      startedAt: "2026-02-22T08:00:00.000Z",
      endedAt: "2026-02-22T13:00:00.000Z",
    });
    expect(records[0]?.raw).toMatchObject({
      quota: {
        resetsAt: "2026-02-22T13:00:00.000Z",
      },
    });
    const raw = records[0]?.raw as { quota?: { periodDurationMs?: number } };
    expect(raw.quota?.periodDurationMs).toBeUndefined();
  });

  test("keeps snapshot ids stable when only remains time is available", async () => {
    let now = 1771761600000;
    const provider = new MiniMaxProvider({
      env: { MINIMAX_API_KEY: "global-key" },
      now: () => {
        const value = now;
        now += 60000;
        return value;
      },
      fetch: async () =>
        response({
          data: {
            model_remains: [
              {
                model_name: "MiniMax-M2",
                current_interval_total_count: 100,
                current_interval_usage_count: 70,
                remains_time: 3600,
              },
            ],
          },
          base_resp: { status_code: 0 },
        }),
    });

    const first = await provider.refresh();
    const second = await provider.refresh();

    expect(second[0]?.id).toBe(first[0]?.id);
    expect(first[0]?.startedAt).toBe("2026-02-22T00:00:00.000Z");
    expect(second[0]?.startedAt).toBe("2026-02-22T00:00:00.000Z");
  });

  test("interprets plausible remains time values as milliseconds", async () => {
    const provider = new MiniMaxProvider({
      env: { MINIMAX_API_KEY: "global-key" },
      now: () => 1771761600000,
      fetch: async () =>
        response({
          data: {
            model_remains: [
              {
                model_name: "MiniMax-M2",
                current_interval_total_count: 100,
                current_interval_usage_count: 70,
                remains_time: 300000,
              },
            ],
          },
          base_resp: { status_code: 0 },
        }),
    });

    const records = await provider.refresh();

    expect(records[0]?.endedAt).toBe("2026-02-22T12:05:00.000Z");
  });

  test("prefers explicit remaining count over MiniMax usage count field", async () => {
    const provider = new MiniMaxProvider({
      env: { MINIMAX_API_KEY: "global-key" },
      fetch: async () =>
        response({
          data: {
            model_remains: [
              {
                model_name: "MiniMax-M2",
                current_interval_total_count: 100,
                current_interval_remaining_count: 20,
                current_interval_usage_count: 70,
                start_time: 1771747200,
                end_time: 1771765200,
              },
            ],
          },
          base_resp: { status_code: 0 },
        }),
    });

    const records = await provider.refresh();

    expect(records[0]?.raw).toMatchObject({
      quota: {
        used: 80,
        limit: 100,
        remaining: 20,
      },
    });
  });

  test("does not send a global API key to the CN endpoint after global failure", async () => {
    const calls: string[] = [];
    const provider = new MiniMaxProvider({
      env: { MINIMAX_API_KEY: "global-key" },
      fetch: async (url) => {
        calls.push(String(url));
        return response({ error: "unauthorized" }, 401);
      },
    });

    await expect(provider.refresh()).rejects.toThrow("Session expired. Check your MiniMax API key.");
    expect(calls).toEqual(["https://www.minimax.io/v1/token_plan/remains"]);
  });

  test("falls back to global when a configured CN key is expired", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const provider = new MiniMaxProvider({
      env: { MINIMAX_CN_API_KEY: "cn-key", MINIMAX_API_KEY: "global-key" },
      fetch: async (url, init) => {
        calls.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string>).Authorization,
        });
        if (String(url).includes("api.minimaxi.com")) {
          return response({ error: "unauthorized" }, 401);
        }
        return response({
          data: {
            model_remains: [
              {
                model_name: "MiniMax-M2",
                current_interval_total_count: 100,
                current_interval_usage_count: 70,
                start_time: 1771747200,
                end_time: 1771765200,
              },
            ],
          },
          base_resp: { status_code: 0 },
        });
      },
    });

    const records = await provider.refresh();

    expect(calls).toEqual([
      {
        url: "https://api.minimaxi.com/v1/token_plan/remains",
        authorization: "Bearer cn-key",
      },
      {
        url: "https://www.minimax.io/v1/token_plan/remains",
        authorization: "Bearer global-key",
      },
    ]);
    expect(records[0]?.raw).toMatchObject({ region: "GLOBAL" });
  });

  test("reports MiniMax API status errors from base_resp", async () => {
    const provider = new MiniMaxProvider({
      env: { MINIMAX_API_TOKEN: "token-key" },
      fetch: async () =>
        response({
          data: {
            model_remains: [
              {
                model_name: "MiniMax-M2",
                current_interval_total_count: 100,
                current_interval_usage_count: 70,
              },
            ],
            base_resp: { status_code: 2001, status_msg: "plan unavailable" },
          },
        }),
    });

    await expect(provider.refresh()).rejects.toThrow("MiniMax API error: plan unavailable");
  });

  test("reports MiniMax HTTP failures without parsing response bodies", async () => {
    const provider = new MiniMaxProvider({
      env: { MINIMAX_API_KEY: "global-key" },
      fetch: async () => response({ error: "unavailable" }, 500),
    });

    await expect(provider.refresh()).rejects.toThrow("Request failed (HTTP 500). Try again later.");
  });

  test("reports MiniMax aborts as connection failures", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const provider = new MiniMaxProvider({
      env: { MINIMAX_API_KEY: "global-key" },
      fetch: async () => {
        throw abortError;
      },
    });

    await expect(provider.refresh()).rejects.toThrow("Request failed. Check your connection.");
  });

  test("registry uses the automatic MiniMax provider", () => {
    const minimax = getProviders().find((provider) => provider.id === "minimax");

    expect(minimax).toBeInstanceOf(MiniMaxProvider);
  });
});
