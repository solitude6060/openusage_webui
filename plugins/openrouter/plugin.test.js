import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx } from "../test-helpers.js";

const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const KEY_URL = "https://openrouter.ai/api/v1/key";
const PRIMARY = "~/.config/openusage/openrouter.json";
const ALTERNATE = "~/.config/openrouter/key.json";
const MISSING_KEY =
  "No OpenRouter API key. Set OPENROUTER_API_KEY or add it to ~/.config/openusage/openrouter.json.";
const INVALID_KEY = "OpenRouter API key invalid. Check your key at openrouter.ai/keys.";
const CONNECTION = "Couldn't reach OpenRouter. Check your connection.";
const UNAVAILABLE = "OpenRouter usage data unavailable. Try again later.";

// Fake credentials only; shaped like OpenRouter keys (sk-or-v1-...).
const KEY = "sk-or-v1-0123456789abcdef0123456789abcdef";

const loadPlugin = async () => {
  await import("./plugin.js");
  return globalThis.__openusage_plugin;
};

function setEnv(ctx, values) {
  ctx.host.env.get.mockImplementation((name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null
  );
}

// Each route is a payload object (HTTP 200), { status, body }, or a function that throws/returns.
function mockRoutes(ctx, routes) {
  ctx.host.http.request.mockImplementation((opts) => {
    const route = routes[opts.url];
    if (route === undefined) throw new Error("unexpected url " + opts.url);
    if (typeof route === "function") return route(opts);
    if (route && route.__status !== undefined) {
      return { status: route.__status, headers: {}, bodyText: route.__body ?? "{}" };
    }
    return { status: 200, headers: {}, bodyText: JSON.stringify(route) };
  });
}

const status = (code, body) => ({ __status: code, __body: body });
const data = (obj) => ({ data: obj });

function ctxWithKey(routes) {
  const ctx = makeCtx();
  setEnv(ctx, { OPENROUTER_API_KEY: KEY });
  if (routes) mockRoutes(ctx, routes);
  return ctx;
}

const line = (result, label) => result.lines.find((l) => l.label === label);

describe("openrouter plugin", () => {
  let plugin;

  beforeEach(async () => {
    delete globalThis.__openusage_plugin;
    vi.resetModules();
    plugin = await loadPlugin();
  });

  it("registers with correct id", () => {
    expect(plugin.id).toBe("openrouter");
    expect(typeof plugin.probe).toBe("function");
  });

  describe("authentication", () => {
    it("throws the setup hint and makes no request without a key", () => {
      const ctx = makeCtx();
      expect(() => plugin.probe(ctx)).toThrow(MISSING_KEY);
      expect(ctx.host.http.request).not.toHaveBeenCalled();
    });

    const bearer = (ctx) => ctx.host.http.request.mock.calls[0][0].headers.Authorization;
    const healthy = { [CREDITS_URL]: data({ total_credits: 1, total_usage: 0 }), [KEY_URL]: data({}) };

    it.each([
      ["saved override beats env", { [PRIMARY]: '{"apiKey":"sk-or-file"}' }, { OPENROUTER_API_KEY: "sk-or-env" }, "sk-or-file"],
      ["environment fallback", {}, { OPENROUTER_API_KEY: "sk-or-env" }, "sk-or-env"],
      ["second environment name", {}, { OPENROUTER_KEY: "sk-or-env2" }, "sk-or-env2"],
      ["first environment name wins", {}, { OPENROUTER_KEY: "b", OPENROUTER_API_KEY: "a" }, "a"],
      ["api_key JSON field", { [PRIMARY]: '{"api_key":"sk-or-json"}' }, {}, "sk-or-json"],
      ["key JSON field", { [PRIMARY]: '{"key":"sk-or-k"}' }, {}, "sk-or-k"],
      ["apiKey beats api_key", { [PRIMARY]: '{"api_key":"two","apiKey":"one"}' }, {}, "one"],
      ["trimmed plain text", { [ALTERNATE]: "  sk-or-plain\n" }, {}, "sk-or-plain"],
      ["primary file beats alternate", { [PRIMARY]: "sk-or-p", [ALTERNATE]: "sk-or-a" }, {}, "sk-or-p"],
      ["blank config falls through to env", { [PRIMARY]: "   " }, { OPENROUTER_API_KEY: "sk-or-env" }, "sk-or-env"],
      ["blank env value is skipped", {}, { OPENROUTER_API_KEY: "  ", OPENROUTER_KEY: " sk-or-k2 " }, "sk-or-k2"],
      ["JSON object without a key field falls to the next file", { [PRIMARY]: '{"foo":"bar"}', [ALTERNATE]: "sk-or-alt" }, {}, "sk-or-alt"],
      ["empty key field is skipped for the next field", { [PRIMARY]: '{"apiKey":"  ","key":"sk-or-k"}' }, {}, "sk-or-k"],
    ])("%s", (_name, files, env, expected) => {
      const ctx = makeCtx();
      for (const [path, text] of Object.entries(files)) ctx.host.fs.writeText(path, text);
      setEnv(ctx, env);
      mockRoutes(ctx, healthy);
      plugin.probe(ctx);
      expect(bearer(ctx)).toBe("Bearer " + expected);
    });

    it("rejects plain text that contains a brace (broken JSON)", () => {
      const ctx = makeCtx();
      ctx.host.fs.writeText(PRIMARY, '{"apiKey": "sk-or-x"');
      expect(() => plugin.probe(ctx)).toThrow(MISSING_KEY);
      expect(ctx.host.http.request).not.toHaveBeenCalled();
    });

    it("does not fall back to plain text for a JSON object without a key", () => {
      const ctx = makeCtx();
      ctx.host.fs.writeText(PRIMARY, '{"apiKey": ""}');
      expect(() => plugin.probe(ctx)).toThrow(MISSING_KEY);
    });

    it("skips an unreadable config file and logs a warning without the key", () => {
      const ctx = makeCtx();
      ctx.host.fs.writeText(PRIMARY, "ignored");
      ctx.host.fs.writeText(ALTERNATE, "sk-or-alt");
      const original = ctx.host.fs.readText;
      ctx.host.fs.readText = (path) => {
        if (path === PRIMARY) throw new Error("EACCES");
        return original(path);
      };
      mockRoutes(ctx, healthy);
      plugin.probe(ctx);
      expect(bearer(ctx)).toBe("Bearer sk-or-alt");
      expect(ctx.host.log.warn).toHaveBeenCalledTimes(1);
      expect(String(ctx.host.log.warn.mock.calls[0][0])).not.toContain("sk-or-alt");
    });
  });

  describe("requests", () => {
    it("sends both authenticated GET requests with a 15 s timeout", () => {
      const ctx = ctxWithKey({ [CREDITS_URL]: data({ total_usage: 1 }), [KEY_URL]: data({}) });
      plugin.probe(ctx);
      const calls = ctx.host.http.request.mock.calls.map((c) => c[0]);
      expect(calls.map((c) => c.url)).toEqual([CREDITS_URL, KEY_URL]);
      for (const call of calls) {
        expect(call.method).toBe("GET");
        expect(call.headers).toEqual({ Authorization: "Bearer " + KEY, Accept: "application/json" });
        expect(call.timeoutMs).toBe(15000);
      }
    });
  });

  describe("credits mapping", () => {
    it("shows a Credits meter and the remaining Balance", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: data({ total_credits: 277.47, total_usage: 178.2 }),
        [KEY_URL]: data({}),
      });
      const result = plugin.probe(ctx);
      expect(line(result, "Credits")).toEqual({
        type: "progress",
        label: "Credits",
        used: 178.2,
        limit: 277.47,
        format: { kind: "dollars" },
      });
      expect(line(result, "Balance")).toEqual({ type: "text", label: "Balance", value: "$99.27" });
    });

    it("shows only a zero Balance for an account that never bought credits", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: data({ total_credits: 0, total_usage: 0 }),
        [KEY_URL]: status(500),
      });
      const result = plugin.probe(ctx);
      expect(line(result, "Credits")).toBeUndefined();
      expect(line(result, "Balance")).toEqual({ type: "text", label: "Balance", value: "$0.00" });
    });

    it("clamps negative usage to zero and never reports a negative Balance", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: data({ total_credits: 10, total_usage: -3 }),
        [KEY_URL]: status(500),
      });
      expect(line(plugin.probe(ctx), "Credits").used).toBe(0);

      const overspent = ctxWithKey({
        [CREDITS_URL]: data({ total_credits: 10, total_usage: 12.5 }),
        [KEY_URL]: status(500),
      });
      expect(line(plugin.probe(overspent), "Balance").value).toBe("$0.00");
    });

    it("treats a missing total_credits as zero", () => {
      const ctx = ctxWithKey({ [CREDITS_URL]: data({ total_usage: 4 }), [KEY_URL]: status(500) });
      const result = plugin.probe(ctx);
      expect(line(result, "Credits")).toBeUndefined();
      expect(line(result, "Balance").value).toBe("$0.00");
    });

    it("accepts numeric strings and rejects booleans, blanks and non-numbers", () => {
      const ok = ctxWithKey({
        [CREDITS_URL]: data({ total_credits: " 50 ", total_usage: "20.5" }),
        [KEY_URL]: status(500),
      });
      const result = plugin.probe(ok);
      expect(line(result, "Credits")).toMatchObject({ used: 20.5, limit: 50 });
      expect(line(result, "Balance").value).toBe("$29.50");

      for (const bad of [true, "", "   ", "abc", null, {}, []]) {
        const ctx = ctxWithKey({
          [CREDITS_URL]: data({ total_credits: 10, total_usage: bad }),
          [KEY_URL]: data({ usage_daily: 1 }),
        });
        const lines = plugin.probe(ctx).lines.map((l) => l.label);
        expect(lines).toEqual(["Today"]);
      }
    });
  });

  describe("key mapping", () => {
    it("maps period spend, the per-key cap and the plan", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: status(403),
        [KEY_URL]: data({
          is_free_tier: false,
          usage_daily: 0,
          usage_weekly: 1.25,
          usage_monthly: 4.5,
          usage: 2,
          limit: 5,
          limit_remaining: 3,
        }),
      });
      const result = plugin.probe(ctx);
      expect(result.plan).toBe("Pay as you go");
      expect(result.lines).toEqual([
        { type: "text", label: "Today", value: "$0.00" },
        { type: "text", label: "This Week", value: "$1.25" },
        { type: "text", label: "This Month", value: "$4.50" },
        { type: "progress", label: "Key Limit", used: 2, limit: 5, format: { kind: "dollars" } },
      ]);
    });

    it("measures Key Limit from the current window, not lifetime usage", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: status(403),
        [KEY_URL]: data({ usage: 12, limit: 5, limit_remaining: 3 }),
      });
      expect(line(plugin.probe(ctx), "Key Limit")).toMatchObject({ used: 2, limit: 5 });
    });

    it("treats a missing limit_remaining as zero remaining and clamps overshoot", () => {
      const empty = ctxWithKey({ [CREDITS_URL]: status(403), [KEY_URL]: data({ limit: 5 }) });
      expect(line(plugin.probe(empty), "Key Limit")).toMatchObject({ used: 5, limit: 5 });

      const over = ctxWithKey({
        [CREDITS_URL]: status(403),
        [KEY_URL]: data({ limit: 5, limit_remaining: 9 }),
      });
      expect(line(plugin.probe(over), "Key Limit")).toMatchObject({ used: 0, limit: 5 });

      const negative = ctxWithKey({
        [CREDITS_URL]: status(403),
        [KEY_URL]: data({ limit: 5, limit_remaining: -2 }),
      });
      expect(line(plugin.probe(negative), "Key Limit")).toMatchObject({ used: 5, limit: 5 });
    });

    it.each([[null], [0], [-1], [undefined]])("omits Key Limit when limit is %s", (limit) => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: status(403),
        [KEY_URL]: data({ limit, usage_daily: 1 }),
      });
      expect(line(plugin.probe(ctx), "Key Limit")).toBeUndefined();
    });

    it("clamps negative period spend to zero", () => {
      const ctx = ctxWithKey({ [CREDITS_URL]: status(403), [KEY_URL]: data({ usage_daily: -4 }) });
      expect(line(plugin.probe(ctx), "Today").value).toBe("$0.00");
    });

    it.each([
      [true, "Free tier"],
      [false, "Pay as you go"],
    ])("labels is_free_tier=%s as %s", (flag, plan) => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: status(403),
        [KEY_URL]: data({ is_free_tier: flag, usage_daily: 0 }),
      });
      expect(plugin.probe(ctx).plan).toBe(plan);
    });

    it.each([["true"], [1], [null]])("sets no plan for non-boolean is_free_tier %s", (flag) => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: status(403),
        [KEY_URL]: data({ is_free_tier: flag, usage_daily: 0 }),
      });
      expect(plugin.probe(ctx).plan).toBeUndefined();
    });
  });

  describe("combined refresh", () => {
    it("merges both endpoints in Credits, Balance, Today ... Key Limit order", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: data({ total_credits: 100, total_usage: 40 }),
        [KEY_URL]: data({ is_free_tier: false, usage_daily: 0.5, limit: 20, limit_remaining: 15 }),
      });
      const result = plugin.probe(ctx);
      expect(result.plan).toBe("Pay as you go");
      expect(result.lines.map((l) => l.label)).toEqual(["Credits", "Balance", "Today", "Key Limit"]);
      expect(line(result, "Balance").value).toBe("$60.00");
    });

    it("keeps credits lines when the key endpoint cannot be reached", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: data({ total_credits: 100, total_usage: 40 }),
        [KEY_URL]: () => {
          throw new Error("ECONNRESET");
        },
      });
      const result = plugin.probe(ctx);
      expect(result.lines.map((l) => l.label)).toEqual(["Credits", "Balance"]);
      expect(result.plan).toBeUndefined();
    });

    it("keeps key lines when credits is forbidden for this key type", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: status(403),
        [KEY_URL]: data({ is_free_tier: false, usage_daily: 0.5, usage_weekly: 2 }),
      });
      const result = plugin.probe(ctx);
      expect(line(result, "Today")).toBeDefined();
      expect(line(result, "Balance")).toBeUndefined();
    });
  });

  describe("errors", () => {
    it.each([
      [401, 401],
      [403, 403],
      [401, 403],
    ])("reports an invalid key when both endpoints answer %s and %s", (a, b) => {
      const ctx = ctxWithKey({ [CREDITS_URL]: status(a), [KEY_URL]: status(b) });
      expect(() => plugin.probe(ctx)).toThrow(INVALID_KEY);
    });

    it("does not call the key invalid when only credits is forbidden", () => {
      const ctx = ctxWithKey({ [CREDITS_URL]: status(403), [KEY_URL]: data({}) });
      expect(() => plugin.probe(ctx)).toThrow(UNAVAILABLE);
    });

    it("does not call the key invalid when only /key rejects it", () => {
      const ctx = ctxWithKey({ [CREDITS_URL]: data({}), [KEY_URL]: status(401) });
      expect(() => plugin.probe(ctx)).toThrow(UNAVAILABLE);
    });

    it("reports a connection failure when no endpoint can be reached", () => {
      const down = () => {
        throw new Error("getaddrinfo ENOTFOUND");
      };
      const ctx = ctxWithKey({ [CREDITS_URL]: down, [KEY_URL]: down });
      expect(() => plugin.probe(ctx)).toThrow(CONNECTION);
    });

    it("reports the HTTP status of a non-2xx answer", () => {
      const ctx = ctxWithKey({ [CREDITS_URL]: status(500), [KEY_URL]: status(502) });
      expect(() => plugin.probe(ctx)).toThrow("OpenRouter request failed (HTTP 500).");
    });

    it("reports the key endpoint failure when credits only had an auth failure", () => {
      const ctx = ctxWithKey({ [CREDITS_URL]: status(401), [KEY_URL]: status(503) });
      expect(() => plugin.probe(ctx)).toThrow("OpenRouter request failed (HTTP 503).");
    });

    it("prefers the credits failure over the key failure", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: status(500),
        [KEY_URL]: () => {
          throw new Error("ECONNRESET");
        },
      });
      expect(() => plugin.probe(ctx)).toThrow("OpenRouter request failed (HTTP 500).");
    });

    it.each([
      ["non-JSON body", { __status: 200, __body: "<html>oops</html>" }],
      ["empty body", { __status: 200, __body: "" }],
      ["missing data", {}],
      ["null data", { data: null }],
      ["array data", { data: [] }],
      ["scalar data", { data: 7 }],
      ["top-level array", { __status: 200, __body: "[]" }],
    ])("treats a 200 with %s as unavailable data", (_name, body) => {
      const ctx = ctxWithKey({ [CREDITS_URL]: body, [KEY_URL]: body });
      expect(() => plugin.probe(ctx)).toThrow(UNAVAILABLE);
    });
  });

  describe("parse failure logging", () => {
    const BODY = "<html>secret-body-text</html>";

    it("warns with the endpoint name and size, never the body, for an invalid JSON 200", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: { __status: 200, __body: BODY },
        [KEY_URL]: data({ usage_daily: 1 }),
      });
      plugin.probe(ctx);
      expect(ctx.host.log.warn).toHaveBeenCalledTimes(1);
      const message = String(ctx.host.log.warn.mock.calls[0][0]);
      expect(message).toContain("/api/v1/credits");
      expect(message).toContain(String(BODY.length));
      expect(message).not.toContain("secret-body-text");
      expect(message).not.toContain(KEY);
    });

    it("warns for each endpoint whose body is not valid JSON", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: { __status: 200, __body: BODY },
        [KEY_URL]: { __status: 200, __body: BODY },
      });
      expect(() => plugin.probe(ctx)).toThrow(UNAVAILABLE);
      const messages = ctx.host.log.warn.mock.calls.map((c) => String(c[0]));
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain("/api/v1/credits");
      expect(messages[1]).toContain("/api/v1/key");
    });

    it.each([
      ["an empty body", { __status: 200, __body: "" }],
      ["a valid JSON array", { __status: 200, __body: "[]" }],
      ["a valid JSON object without data", {}],
    ])("does not warn for %s (upstream logs only unparsable non-empty bodies)", (_name, body) => {
      const ctx = ctxWithKey({ [CREDITS_URL]: body, [KEY_URL]: data({ usage_daily: 1 }) });
      plugin.probe(ctx);
      expect(ctx.host.log.warn).not.toHaveBeenCalled();
    });

    it("does not parse or log non-2xx bodies", () => {
      const ctx = ctxWithKey({
        [CREDITS_URL]: status(500, BODY),
        [KEY_URL]: data({ usage_daily: 1 }),
      });
      plugin.probe(ctx);
      expect(ctx.host.log.warn).not.toHaveBeenCalled();
    });
  });

  describe("sensitive data", () => {
    const LABEL = "my-laptop-key-label";
    const payloads = {
      [CREDITS_URL]: data({ total_credits: 10, total_usage: 1 }),
      [KEY_URL]: data({
        label: LABEL,
        name: "Secret Key Name",
        usage_daily: 0.1,
        limit: 5,
        limit_remaining: 4,
        is_free_tier: false,
      }),
    };

    const logged = (ctx) =>
      JSON.stringify(Object.values(ctx.host.log).flatMap((fn) => fn.mock.calls));

    it("never logs the key or response bodies, even for fields like the key label", () => {
      const ctx = ctxWithKey(payloads);
      plugin.probe(ctx);
      expect(logged(ctx)).toBe("[]");
    });

    it("keeps the key label and key out of the returned lines", () => {
      const ctx = ctxWithKey(payloads);
      const text = JSON.stringify(plugin.probe(ctx));
      expect(text).not.toContain(LABEL);
      expect(text).not.toContain("Secret Key Name");
      expect(text).not.toContain(KEY);
    });

    it("keeps the key out of logs and thrown messages on every failure path", () => {
      const down = () => {
        throw new Error("connect ECONNREFUSED");
      };
      const scenarios = [
        [{ [CREDITS_URL]: status(401), [KEY_URL]: status(403) }, INVALID_KEY],
        [{ [CREDITS_URL]: status(500), [KEY_URL]: down }, "OpenRouter request failed (HTTP 500)."],
        [{ [CREDITS_URL]: down, [KEY_URL]: down }, CONNECTION],
        [{ [CREDITS_URL]: { __status: 200, __body: "not json " + LABEL }, [KEY_URL]: status(404) }, UNAVAILABLE],
      ];
      for (const [routes, message] of scenarios) {
        const ctx = ctxWithKey(routes);
        let thrown;
        try {
          plugin.probe(ctx);
        } catch (e) {
          thrown = String(e);
        }
        expect(thrown).toBe(message);
        expect(thrown).not.toContain(KEY);
        expect(thrown).not.toContain(LABEL);
        expect(logged(ctx)).not.toContain(KEY);
        expect(logged(ctx)).not.toContain(LABEL);
      }
    });
  });
});
