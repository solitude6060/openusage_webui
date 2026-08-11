import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestHandler } from "../src/index";
import { SqliteStorage } from "../../../packages/storage/src/index";
import {
  CcusageProvider,
  MiniMaxProvider,
  OpenUsagePluginProvider,
  type UsageProvider,
} from "../../../packages/providers/src/index";

let dataDir: string;
let previousDataDir: string | undefined;
let previousAllowedHosts: string | undefined;
let storage: SqliteStorage;
let handleRequest: (request: Request) => Promise<Response>;

beforeEach(async () => {
  previousDataDir = process.env.OPENUSAGE_WEBUI_DIR;
  previousAllowedHosts = process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS;
  dataDir = mkdtempSync(join(tmpdir(), "openusage-webui-api-test-"));
  process.env.OPENUSAGE_WEBUI_DIR = dataDir;
  delete process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS;
  storage = new SqliteStorage();
  await storage.init();
  const providers: UsageProvider[] = [
    {
      id: "ccusage",
      name: "ccusage",
      detect: async () => true,
      refresh: async () => [],
    },
    {
      id: "manual",
      name: "Manual",
      detect: async () => true,
      refresh: async () => [],
    },
    {
      id: "minimax",
      name: "MiniMax",
      detect: async () => true,
      refresh: async () => [],
    },
  ];
  handleRequest = createRequestHandler(storage, {
    host: "127.0.0.1",
    port: 6736,
  }, undefined, providers);
});

afterEach(() => {
  storage.close();
  if (previousDataDir === undefined) {
    delete process.env.OPENUSAGE_WEBUI_DIR;
  } else {
    process.env.OPENUSAGE_WEBUI_DIR = previousDataDir;
  }
  if (previousAllowedHosts === undefined) {
    delete process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS;
  } else {
    process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS = previousAllowedHosts;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("WebUI API", () => {
  test("proxies dev frontend requests with the frontend host header", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("host")).toBe("127.0.0.1:6737");
      return new Response("<!doctype html><title>Vite</title>", {
        headers: { "content-type": "text/html" },
      });
    });
    const devHandler = createRequestHandler(
      storage,
      { host: "127.0.0.1", port: 6736 },
      "http://127.0.0.1:6737",
      [],
    );

    const response = await devHandler(new Request("http://127.0.0.1:6736/", {
      headers: { host: "127.0.0.1:6736" },
    }));

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("http://127.0.0.1:6737/");
    fetchSpy.mockRestore();
  });

  test("reports the actual bind port in health", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      host: "127.0.0.1",
      port: 6736,
    });
  });

  test("rejects unexpected Host headers", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/health", {
      headers: {
        host: "evil.test",
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN_HOST");
  });

  test("allows configured Tailscale Host headers without disabling localhost", async () => {
    process.env.OPENUSAGE_WEBUI_ALLOWED_HOSTS = "100.96.97.122,ma.tailnet.example";

    const tailscaleResponse = await handleRequest(new Request("http://100.96.97.122:6736/api/health", {
      headers: {
        host: "100.96.97.122:6736",
      },
    }));
    const localhostResponse = await handleRequest(new Request("http://127.0.0.1:6736/api/health", {
      headers: {
        host: "localhost:6736",
      },
    }));

    expect(tailscaleResponse.status).toBe(200);
    expect(localhostResponse.status).toBe(200);
  });

  test("returns bad request for unknown provider ids", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/providers/unknown/refresh", {
      method: "POST",
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  test("returns bad request for malformed JSON", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/manual/usage", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "not json",
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  test("rejects MiniMax provider settings writes", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/settings/minimax", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ api_key: "should-not-persist" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(405);
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
    expect(await storage.getProviderSettings("minimax")).toEqual({});
  });

  test("refresh all returns per-provider results", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/providers/refresh", {
      method: "POST",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toEqual([
      { providerId: "ccusage", ok: true, records: 0 },
      { providerId: "manual", ok: true, records: 0 },
      { providerId: "minimax", ok: true, records: 0 },
    ]);
  });

  test("refresh all isolates provider-level failures", async () => {
    handleRequest = createRequestHandler(storage, {
      host: "127.0.0.1",
      port: 6736,
    }, undefined, [
      {
        id: "ccusage",
        name: "ccusage",
        detect: async () => false,
        refresh: async () => {
          throw new Error("ccusage unavailable");
        },
      },
      {
        id: "manual",
        name: "Manual",
        detect: async () => true,
        refresh: async () => [],
      },
    ]);

    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/providers/refresh", {
      method: "POST",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      results: [
        { providerId: "ccusage", ok: false, error: "ccusage unavailable" },
        { providerId: "manual", ok: true, records: 0 },
      ],
    });
  });

  test("keeps provider detected when refresh fails after successful detection", async () => {
    handleRequest = createRequestHandler(storage, {
      host: "127.0.0.1",
      port: 6736,
    }, undefined, [
      {
        id: "github-copilot",
        name: "GitHub Copilot",
        detect: async () => true,
        refresh: async () => {
          throw new Error("Not logged in. Run `gh auth login` first.");
        },
      },
    ]);

    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/providers/github-copilot/refresh", {
      method: "POST",
    }));

    expect(response.status).toBe(200);
    expect(await storage.listProviderStatus()).toEqual([
      {
        providerId: "github-copilot",
        name: "GitHub Copilot",
        enabled: true,
        detected: true,
        lastRefreshAt: expect.any(String),
        lastError: "Not logged in. Run `gh auth login` first.",
      },
    ]);
  });

  test("minimax refresh reports missing API key as a provider-level error", async () => {
    const calls: string[] = [];
    handleRequest = createRequestHandler(storage, {
      host: "127.0.0.1",
      port: 6736,
    }, undefined, [
      new MiniMaxProvider({
        env: {},
        fetch: async (url) => {
          calls.push(String(url));
          throw new Error("network should not be called without an API key");
        },
      }),
    ]);

    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/providers/minimax/refresh", {
      method: "POST",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      results: [
        {
          providerId: "minimax",
          ok: false,
          error: "MiniMax API key missing. Set MINIMAX_API_KEY, MINIMAX_API_TOKEN, or MINIMAX_CN_API_KEY.",
        },
      ],
    });
    expect(calls).toEqual([]);
    expect(await storage.listProviderStatus()).toEqual([
      {
        providerId: "minimax",
        name: "MiniMax",
        enabled: true,
        detected: false,
        lastRefreshAt: expect.any(String),
        lastError: "MiniMax API key missing. Set MINIMAX_API_KEY, MINIMAX_API_TOKEN, or MINIMAX_CN_API_KEY.",
      },
    ]);
  });

  test("serves built frontend index for production SPA routes", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "openusage-webui-dist-test-"));
    try {
      writeFileSync(join(distDir, "index.html"), "<!doctype html><title>OpenUsage Phase 3</title>");
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const response = await productionHandler(new Request("http://127.0.0.1:6736/dashboard"));
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
      expect(body).toContain("OpenUsage Phase 3");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  test("serves built frontend assets with content types", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "openusage-webui-dist-test-"));
    try {
      mkdirSync(join(distDir, "assets"));
      writeFileSync(join(distDir, "index.html"), "<!doctype html>");
      writeFileSync(join(distDir, "assets", "app.css"), "body { color: black; }");
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const response = await productionHandler(new Request("http://127.0.0.1:6736/assets/app.css"));
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/css");
      expect(body).toContain("color: black");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  test("serves built frontend index for the root route", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "openusage-webui-dist-test-"));
    try {
      writeFileSync(join(distDir, "index.html"), "<!doctype html><title>Root App</title>");
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const response = await productionHandler(new Request("http://127.0.0.1:6736/"));
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("Root App");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  test("keeps static asset requests inside the frontend dist directory", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "openusage-webui-parent-test-"));
    const distDir = join(parentDir, "dist");
    try {
      mkdirSync(distDir);
      writeFileSync(join(parentDir, "outside.txt"), "outside secret");
      writeFileSync(join(distDir, "index.html"), "<!doctype html><title>Safe App</title>");
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const response = await productionHandler(
        new Request("http://127.0.0.1:6736/..%2foutside.txt"),
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("Safe App");
      expect(body).not.toContain("outside secret");
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });

  test("serves common production asset types with strict content types", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "openusage-webui-dist-test-"));
    try {
      mkdirSync(join(distDir, "assets"));
      writeFileSync(join(distDir, "index.html"), "<!doctype html>");
      writeFileSync(join(distDir, "manifest.json"), "{\"name\":\"OpenUsage\"}");
      writeFileSync(join(distDir, "assets", "font.woff2"), "fake font");
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const manifest = await productionHandler(new Request("http://127.0.0.1:6736/manifest.json"));
      const font = await productionHandler(new Request("http://127.0.0.1:6736/assets/font.woff2"));

      expect(manifest.headers.get("content-type")).toBe("application/json");
      expect(font.headers.get("content-type")).toBe("font/woff2");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  test("returns a clear error when built frontend is missing", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "openusage-webui-dist-test-"));
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const productionHandler = createRequestHandler(
        storage,
        { host: "127.0.0.1", port: 6736 },
        undefined,
        [],
        distDir,
      );

      const response = await productionHandler(new Request("http://127.0.0.1:6736/dashboard"));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error.code).toBe("FRONTEND_BUILD_MISSING");
      expect(log).toHaveBeenCalledWith(expect.stringContaining("frontend_build_missing"));
    } finally {
      log.mockRestore();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  test("aggregates token usage by provider and model", async () => {
    const now = Date.now();
    const from = new Date(now - 5 * 60 * 1000).toISOString();
    await storage.upsertUsageRecords([
      {
        id: "token-a",
        providerId: "codex",
        model: "gpt-5.5",
        totalTokens: 100,
        startedAt: new Date(now - 60 * 1000).toISOString(),
        source: "plugin",
      },
      {
        id: "token-b",
        providerId: "codex",
        totalTokens: 40,
        startedAt: new Date(now - 30 * 1000).toISOString(),
        source: "plugin",
      },
    ]);

    const response = await handleRequest(
      new Request(`http://127.0.0.1:6736/api/usage/tokens?from=${encodeURIComponent(from)}`),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    const codex = body.providers.find((row: { providerId: string }) => row.providerId === "codex");
    expect(codex).toMatchObject({
      providerId: "codex",
      totalTokens: 140,
    });
    expect(codex.models).toEqual(
      expect.arrayContaining([
        { model: "gpt-5.5", totalTokens: 100, records: 1 },
        { model: "Unknown", totalTokens: 40, records: 1 },
      ]),
    );
  });

  test("provider refresh persists structured daily token usage without double counting", async () => {
    const refreshTimes = ["2026-08-09T10:00:00.000Z", "2026-08-09T10:20:00.000Z"];
    const provider = new OpenUsagePluginProvider({
      providerId: "codex:family",
      name: "Codex Family",
      pluginId: "codex",
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "codex",
          probe(ctx) {
            const usage = ctx.host.ccusage.query({ provider: "codex", since: "20260808" });
            return {
              plan: "Plus",
              lines: [ctx.line.text({ label: "Days", value: String(usage.data.daily.length) })],
            };
          },
        };
      `,
      ccusageQuery: () => ({
        status: "ok",
        data: {
          daily: [
            {
              date: "2026-08-08",
              totalTokens: 120,
              models: {
                "gpt-5.6-sol": { totalTokens: 100 },
                "gpt-5.6-luna": { inputTokens: 10, outputTokens: 10 },
              },
            },
          ],
        },
      }),
      now: () => refreshTimes.shift() ?? "2026-08-09T10:20:00.000Z",
    });
    handleRequest = createRequestHandler(
      storage,
      { host: "127.0.0.1", port: 6736 },
      undefined,
      [provider],
    );
    await storage.upsertUsageRecords([{
      id: "legacy-codex-daily",
      providerId: "codex",
      tool: "Codex",
      totalTokens: 120,
      costUsd: 0.5,
      startedAt: "2026-08-08T00:00:00.000Z",
      source: "cli",
      raw: { command: "daily" },
    }]);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const refresh = await handleRequest(new Request(
        "http://127.0.0.1:6736/api/providers/codex%3Afamily/refresh",
        { method: "POST" },
      ));
      expect(refresh.status).toBe(200);
    }

    const response = await handleRequest(new Request(
      "http://127.0.0.1:6736/api/usage/tokens?from=2026-08-08T00%3A00%3A00.000Z",
    ));
    const body = await response.json();

    expect(body).toMatchObject({ totalTokens: 120, records: 2 });
    expect(body.providers).toEqual([
      {
        providerId: "codex:family",
        totalTokens: 120,
        records: 2,
        models: [
          { model: "gpt-5.6-sol", totalTokens: 100, records: 1 },
          { model: "gpt-5.6-luna", totalTokens: 20, records: 1 },
        ],
      },
    ]);
    const legacy = (await storage.listUsageRecords({ providerId: "codex" }))
      .find((record) => record.id === "legacy-codex-daily");
    expect(legacy).toMatchObject({ costUsd: 0.5, raw: { command: "daily" } });
    expect(legacy?.totalTokens).toBeUndefined();
  });

  test("refresh all does not count Claude usage from both ccusage and its plugin", async () => {
    const ccusage = new CcusageProvider(async (_command, args) => ({
      ok: true,
      stderr: "",
      stdout: args.includes("--help")
        ? "Usage: ccusage"
        : JSON.stringify({
            daily: [
              { date: "2026-08-08", tool: "Claude Code", totalTokens: 120 },
              { date: "2026-08-08", tool: "Gemini CLI", totalTokens: 20 },
            ],
          }),
    }));
    const claude = new OpenUsagePluginProvider({
      providerId: "claude-code",
      name: "Claude Code",
      pluginId: "claude",
      scriptText: `
        globalThis.__openusage_plugin = {
          id: "claude",
          probe(ctx) {
            ctx.host.ccusage.query({ provider: "claude" });
            return { lines: [] };
          },
        };
      `,
      ccusageQuery: () => ({
        status: "ok",
        data: {
          daily: [{
            date: "2026-08-08",
            totalTokens: 120,
            models: { "claude-sonnet-4": { totalTokens: 120 } },
          }],
        },
      }),
      now: () => "2026-08-09T10:00:00.000Z",
    });
    handleRequest = createRequestHandler(
      storage,
      { host: "127.0.0.1", port: 6736 },
      undefined,
      [ccusage, claude],
    );

    const refresh = await handleRequest(new Request(
      "http://127.0.0.1:6736/api/providers/refresh",
      { method: "POST" },
    ));
    expect(refresh.status).toBe(200);

    const response = await handleRequest(new Request(
      "http://127.0.0.1:6736/api/usage/tokens?from=2026-08-08T00%3A00%3A00.000Z",
    ));
    const body = await response.json();
    expect(body.totalTokens).toBe(140);
    expect(body.providers.map((provider: { providerId: string }) => provider.providerId)).toEqual([
      "claude-code",
      "gemini-cli",
    ]);
  });

  test("refresh all keeps local Claude usage when its plugin refresh fails", async () => {
    const ccusage = new CcusageProvider(async (_command, args) => ({
      ok: true,
      stderr: "",
      stdout: args.includes("--help")
        ? "Usage: ccusage"
        : JSON.stringify({
            daily: [
              { date: "2026-08-08", tool: "Claude Code", totalTokens: 120 },
              { date: "2026-08-08", tool: "Gemini CLI", totalTokens: 20 },
            ],
          }),
    }));
    const claude: UsageProvider = {
      id: "claude-code",
      name: "Claude Code",
      detect: async () => true,
      refresh: async () => {
        throw new Error("Claude usage API unavailable");
      },
    };
    handleRequest = createRequestHandler(
      storage,
      { host: "127.0.0.1", port: 6736 },
      undefined,
      [ccusage, claude],
    );

    const refresh = await handleRequest(new Request(
      "http://127.0.0.1:6736/api/providers/refresh",
      { method: "POST" },
    ));
    const refreshBody = await refresh.json();
    expect(refreshBody.results).toEqual([
      { providerId: "ccusage", ok: true, records: 2 },
      { providerId: "claude-code", ok: false, error: "Claude usage API unavailable" },
    ]);

    const response = await handleRequest(new Request(
      "http://127.0.0.1:6736/api/usage/tokens?from=2026-08-08T00%3A00%3A00.000Z",
    ));
    const body = await response.json();
    expect(body.totalTokens).toBe(140);
    expect(body.providers.map((provider: { providerId: string }) => provider.providerId)).toEqual([
      "claude-code",
      "gemini-cli",
    ]);
  });

  test("creates and lists provider accounts for selected providers", async () => {
    const homeA = mkdtempSync(join(tmpdir(), "openusage-codex-a-"));
    const homeB = mkdtempSync(join(tmpdir(), "openusage-claude-b-"));
    try {
      const createA = await handleRequest(new Request("http://127.0.0.1:6736/api/provider-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "codex",
          label: "Codex · Local",
          homePath: homeA,
        }),
      }));
      const bodyA = await createA.json();
      expect(createA.status).toBe(201);
      expect(bodyA.account).toMatchObject({
        id: "codex:local",
        providerId: "codex",
        label: "Codex · Local",
        homePath: homeA,
        enabled: true,
      });

      const createB = await handleRequest(new Request("http://127.0.0.1:6736/api/provider-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "claude-code",
          label: "Claude · Work",
          homePath: homeB,
        }),
      }));
      expect(createB.status).toBe(201);

      const caps = await handleRequest(
        new Request("http://127.0.0.1:6736/api/provider-accounts/capabilities"),
      );
      expect(caps.status).toBe(200);
      expect(await caps.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ providerId: "codex" }),
          expect.objectContaining({ providerId: "claude-code" }),
        ]),
      );

      const list = await handleRequest(
        new Request("http://127.0.0.1:6736/api/provider-accounts?providerId=codex"),
      );
      const listed = await list.json();
      expect(list.status).toBe(200);
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe("codex:local");
    } finally {
      rmSync(homeA, { recursive: true, force: true });
      rmSync(homeB, { recursive: true, force: true });
    }
  });

  test("accepts provider account ids for refresh routing", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/providers/codex%3Alocal/refresh", {
      method: "POST",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toEqual([
      { providerId: "codex:local", ok: false, error: "Provider is not refreshable yet" },
    ]);
  });

  test("rejects non-Codex ids on compat Codex instance routes", async () => {
    const response = await handleRequest(
      new Request("http://127.0.0.1:6736/api/codex/instances/claude-code%3Awork", {
        method: "DELETE",
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error.message).toContain("Unknown Codex instance");
  });

  test("rejects duplicate homes even when one path uses a tilde form", async () => {
    await storage.upsertProviderAccount({
      id: "codex:legacy",
      providerId: "codex",
      label: "Codex · Legacy",
      homePath: "~/.codex",
      enabled: true,
      sortOrder: 0,
    });

    const response = await handleRequest(new Request("http://127.0.0.1:6736/api/provider-accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "codex",
        label: "Codex · Dup",
        homePath: "~/.codex",
      }),
    }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.message).toContain("home path already exists");
  });
});
